from __future__ import annotations

import importlib.util
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4


BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_FORGE_RUNTIME_DIR = BASE_DIR / "runtime" / "forges"


@dataclass(frozen=True)
class ForgeRuntime:
    mode: str
    status: str
    detail: str
    worker: str
    ready: bool
    supportsMethods: list[str]


class ForgeTrainingService:
    """
    Owns the Forge runtime boundary.

    The public app defaults to a deterministic simulator. The local runtime is a
    contract probe for the future LoRA/QLoRA worker; it reports dependency
    readiness without launching expensive model training inside FastAPI.
    """

    def __init__(self) -> None:
        self.mode = os.getenv("FOUNDRY_FORGE_RUNTIME_MODE", "simulated").strip().lower()
        self.worker = os.getenv("FOUNDRY_FORGE_WORKER", "local-process").strip() or "local-process"
        if self.mode not in {"simulated", "local"}:
            self.mode = "simulated"

    def describe_runtime(self) -> ForgeRuntime:
        if self.mode == "simulated":
            return ForgeRuntime(
                mode="simulated",
                status="ready",
                detail="Using deterministic Forge progress simulation.",
                worker="in-process-simulator",
                ready=True,
                supportsMethods=["LoRA", "QLoRA"],
            )

        missing = self._missing_training_dependencies()
        if missing:
            return ForgeRuntime(
                mode="local",
                status="blocked",
                detail=(
                    "Local trainer adapter is configured, but dependencies are missing: "
                    + ", ".join(missing)
                    + "."
                ),
                worker=self.worker,
                ready=False,
                supportsMethods=["LoRA", "QLoRA"],
            )

        return ForgeRuntime(
            mode="local",
            status="ready",
            detail="Local trainer adapter dependencies are importable.",
            worker=self.worker,
            ready=True,
            supportsMethods=["LoRA", "QLoRA"],
        )

    def runtime_payload(self) -> Dict[str, Any]:
        runtime = self.describe_runtime()
        return {
            "mode": runtime.mode,
            "status": runtime.status,
            "detail": runtime.detail,
            "worker": runtime.worker,
            "ready": runtime.ready,
            "supportsMethods": runtime.supportsMethods,
        }

    async def configure(self, mode: str, worker: str | None = None) -> Dict[str, Any]:
        normalized_mode = mode.strip().lower()
        if normalized_mode not in {"simulated", "local"}:
            raise ValueError("Forge runtime mode must be simulated or local.")

        self.mode = normalized_mode
        if worker is not None and worker.strip():
            self.worker = worker.strip()
        return self.runtime_payload()

    def build_training_contract(
        self,
        *,
        forge_run: Dict[str, Any],
        material: Dict[str, Any],
    ) -> Dict[str, Any]:
        purpose = forge_run.get("purpose") or "training"
        output_dir = (
            f"runtime/evaluations/pending/{forge_run['id']}"
            if purpose == "evaluation"
            else f"runtime/artifacts/pending/{forge_run['id']}"
        )
        return {
            "contractVersion": "foundry.forge.training.v1",
            "forgeRunId": forge_run["id"],
            "workshopId": forge_run["workshopId"],
            "purpose": purpose,
            "materialId": material["id"],
            "datasetUri": material["sourceUri"],
            "baseModel": forge_run.get("baseModel") or "unknown",
            "method": forge_run["method"],
            "epochs": forge_run.get("epoch", {}).get("total") or 1,
            "learningRate": forge_run.get("learningRate") or "0.0002",
            "loadIn4Bit": bool(forge_run.get("loadIn4Bit")),
            "outputDir": output_dir,
            "runtime": self.runtime_payload(),
        }

    def initialize_contract(self, contract: Dict[str, Any]) -> Dict[str, Any]:
        forge_run_id = contract["forgeRunId"]
        run_dir = self._run_dir(forge_run_id)
        run_dir.mkdir(parents=True, exist_ok=True)

        self._write_json(self._contract_path(forge_run_id), contract)
        if not self._has_event(forge_run_id, "queued"):
            self._append_event(
                forge_run_id,
                "queued",
                "Forge contract accepted and written to runtime storage.",
                progress=0,
                data={
                    "contractVersion": contract["contractVersion"],
                    "purpose": contract.get("purpose", "training"),
                    "method": contract["method"],
                    "datasetUri": contract["datasetUri"],
                },
            )

        validation = self.validate_dataset(contract)
        if validation["valid"]:
            if not self._has_event(forge_run_id, "dataset_validated"):
                self._append_event(
                    forge_run_id,
                    "dataset_validated",
                    f"Dataset validated with {validation['rowCount']} {contract.get('purpose', 'training')} rows.",
                    progress=6,
                    data=validation,
                )
        else:
            if not self._has_event(forge_run_id, "dataset_validation_failed"):
                self._append_event(
                    forge_run_id,
                    "dataset_validation_failed",
                    validation["message"],
                    progress=0,
                    data=validation,
                )

        self._write_metrics(
            forge_run_id,
            {
                "forgeRunId": forge_run_id,
                "status": "queued" if validation["valid"] else "blocked",
                "progress": 0,
                "datasetRows": validation.get("rowCount", 0),
                "lastEvent": "dataset_validated"
                if validation["valid"]
                else "dataset_validation_failed",
            },
        )
        return {
            "contract": contract,
            "validation": validation,
            "events": self.list_events(forge_run_id),
            "metrics": self.get_metrics(forge_run_id),
        }

    def reconcile_worker_state(
        self,
        *,
        forge_run: Dict[str, Any],
        material: Dict[str, Any],
    ) -> Dict[str, Any]:
        contract = self.get_contract(forge_run["id"]) or self.build_training_contract(
            forge_run=forge_run,
            material=material,
        )
        state = self.initialize_contract(contract)
        if state["validation"]["valid"] and forge_run["status"] in {"running", "completed"}:
            metrics = self.record_simulation_step(forge_run)
            state["events"] = self.list_events(forge_run["id"])
            state["metrics"] = metrics
        return state

    def record_simulation_step(self, forge_run: Dict[str, Any]) -> Dict[str, Any]:
        forge_run_id = forge_run["id"]
        contract = self.get_contract(forge_run_id)
        if contract is None:
            self._append_event(
                forge_run_id,
                "contract_missing",
                "Forge runtime has no contract file for this run.",
                progress=forge_run.get("progress", 0),
            )
            self._write_metrics(
                forge_run_id,
                {
                    "forgeRunId": forge_run_id,
                    "status": "blocked",
                    "progress": forge_run.get("progress", 0),
                    "datasetRows": 0,
                    "lastEvent": "contract_missing",
                },
            )
            return self.get_metrics(forge_run_id)

        status = forge_run["status"]
        progress = forge_run["progress"]
        epoch = forge_run.get("epoch")

        purpose = contract.get("purpose", "training")

        if purpose == "evaluation" and status == "running" and not self._has_event(forge_run_id, "evaluation_started"):
            self._append_event(
                forge_run_id,
                "evaluation_started",
                "Simulator started evaluating the selected Artifact examples.",
                progress=progress,
                epoch=epoch,
            )

        if purpose != "evaluation" and status == "running" and not self._has_event(forge_run_id, "epoch_started"):
            self._append_event(
                forge_run_id,
                "epoch_started",
                "Simulator started the first training epoch.",
                progress=progress,
                epoch=epoch,
            )

        if status == "running":
            self._append_event(
                forge_run_id,
                "step_completed",
                f"Simulator advanced Forge progress to {progress}%.",
                progress=progress,
                epoch=epoch,
                data={
                    "method": forge_run["method"],
                    "learningRate": forge_run.get("learningRate"),
                    "loadIn4Bit": forge_run.get("loadIn4Bit"),
                },
            )

        if status == "completed" and purpose == "evaluation":
            if not self._has_event(forge_run_id, "evaluation_completed"):
                self._append_event(
                    forge_run_id,
                    "evaluation_completed",
                    "Forge evaluation completed. Review metrics before promoting an Artifact.",
                    progress=100,
                    epoch=epoch,
                    data={
                        "datasetRows": self._dataset_row_count_from_events(forge_run_id),
                        "materialId": contract["materialId"],
                    },
                )

        if status == "completed" and purpose != "evaluation":
            if not self._has_event(forge_run_id, "artifact_planned"):
                self._append_event(
                    forge_run_id,
                    "artifact_planned",
                    "Simulator planned the Artifact output directory.",
                    progress=98,
                    epoch=epoch,
                    data={
                        "outputDir": contract["outputDir"],
                        "artifactId": forge_run.get("artifactId"),
                    },
                )
            if not self._has_event(forge_run_id, "completed"):
                self._append_event(
                    forge_run_id,
                    "completed",
                    "Forge simulation completed and Artifact metadata is ready.",
                    progress=100,
                    epoch=epoch,
                    data={"artifactId": forge_run.get("artifactId")},
                )

        self._write_metrics(
            forge_run_id,
            {
                "forgeRunId": forge_run_id,
                "status": status,
                "progress": progress,
                "epoch": epoch,
                "datasetRows": self._dataset_row_count_from_events(forge_run_id),
                "lastEvent": self.list_events(forge_run_id)[-1]["type"],
            },
        )
        return self.get_metrics(forge_run_id)

    def get_contract(self, forge_run_id: str) -> Dict[str, Any] | None:
        contract_path = self._contract_path(forge_run_id)
        if not contract_path.exists():
            return None
        return json.loads(contract_path.read_text(encoding="utf-8"))

    def list_events(self, forge_run_id: str) -> list[Dict[str, Any]]:
        events_path = self._events_path(forge_run_id)
        if not events_path.exists():
            return []
        events = []
        with events_path.open("r", encoding="utf-8") as event_file:
            for line in event_file:
                stripped = line.strip()
                if stripped:
                    events.append(json.loads(stripped))
        return events

    def get_metrics(self, forge_run_id: str) -> Dict[str, Any]:
        metrics_path = self._metrics_path(forge_run_id)
        if not metrics_path.exists():
            return {
                "forgeRunId": forge_run_id,
                "status": "unknown",
                "progress": 0,
                "datasetRows": 0,
                "lastEvent": None,
            }
        return json.loads(metrics_path.read_text(encoding="utf-8"))

    def validate_dataset(self, contract: Dict[str, Any]) -> Dict[str, Any]:
        dataset_path = self._resolve_runtime_path(contract["datasetUri"])
        if not dataset_path.exists():
            return {
                "valid": False,
                "rowCount": 0,
                "datasetPath": str(dataset_path),
                "message": f"Dataset file was not found: {contract['datasetUri']}",
            }

        row_count = 0
        with dataset_path.open("r", encoding="utf-8") as dataset_file:
            for line_number, line in enumerate(dataset_file, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    row = json.loads(stripped)
                except json.JSONDecodeError as error:
                    return {
                        "valid": False,
                        "rowCount": row_count,
                        "datasetPath": str(dataset_path),
                        "message": f"Invalid JSONL at line {line_number}: {error}",
                    }
                if not row.get("instruction") or not row.get("output"):
                    return {
                        "valid": False,
                        "rowCount": row_count,
                        "datasetPath": str(dataset_path),
                        "message": (
                            "Dataset rows must include instruction and output "
                            f"fields. Missing at line {line_number}."
                        ),
                    }
                row_count += 1

        if row_count < 1:
            return {
                "valid": False,
                "rowCount": 0,
                "datasetPath": str(dataset_path),
                "message": "Dataset file has no training rows.",
            }

        return {
            "valid": True,
            "rowCount": row_count,
            "datasetPath": str(dataset_path),
            "message": "Dataset is training-contract ready.",
        }

    def can_execute_contract(self) -> bool:
        return self.describe_runtime().ready

    def _missing_training_dependencies(self) -> list[str]:
        required_modules = ("torch", "transformers", "peft")
        if os.getenv("FOUNDRY_FORGE_REQUIRE_ACCELERATE", "1") != "0":
            required_modules += ("accelerate",)
        return [
            module_name
            for module_name in required_modules
            if importlib.util.find_spec(module_name) is None
        ]

    def _run_dir(self, forge_run_id: str) -> Path:
        return DEFAULT_FORGE_RUNTIME_DIR / forge_run_id

    def _contract_path(self, forge_run_id: str) -> Path:
        return self._run_dir(forge_run_id) / "contract.json"

    def _events_path(self, forge_run_id: str) -> Path:
        return self._run_dir(forge_run_id) / "events.jsonl"

    def _metrics_path(self, forge_run_id: str) -> Path:
        return self._run_dir(forge_run_id) / "metrics.json"

    def _resolve_runtime_path(self, value: str) -> Path:
        path = Path(value)
        return path if path.is_absolute() else BASE_DIR / path

    def _write_json(self, path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def _write_metrics(self, forge_run_id: str, payload: Dict[str, Any]) -> None:
        self._write_json(self._metrics_path(forge_run_id), payload)

    def _append_event(
        self,
        forge_run_id: str,
        event_type: str,
        message: str,
        *,
        progress: int | None = None,
        epoch: Dict[str, Any] | None = None,
        data: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        event = {
            "id": f"evt-{uuid4().hex[:12]}",
            "forgeRunId": forge_run_id,
            "type": event_type,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if progress is not None:
            event["progress"] = progress
        if epoch is not None:
            event["epoch"] = epoch
        if data is not None:
            event["data"] = data

        events_path = self._events_path(forge_run_id)
        events_path.parent.mkdir(parents=True, exist_ok=True)
        with events_path.open("a", encoding="utf-8") as event_file:
            event_file.write(json.dumps(event, sort_keys=True) + "\n")
        return event

    def _has_event(self, forge_run_id: str, event_type: str) -> bool:
        return any(event["type"] == event_type for event in self.list_events(forge_run_id))

    def _dataset_row_count_from_events(self, forge_run_id: str) -> int:
        for event in self.list_events(forge_run_id):
            if event["type"] == "dataset_validated":
                return int(event.get("data", {}).get("rowCount", 0))
        return 0
