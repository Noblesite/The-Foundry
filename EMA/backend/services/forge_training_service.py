from __future__ import annotations

import importlib.util
import json
import os
import re
from collections.abc import Callable
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

    The public app defaults to a deterministic simulator. The local runtime is
    an explicit worker adapter that can execute tiny LoRA jobs from the same
    durable contract the simulator consumes.
    """

    def __init__(self) -> None:
        self.mode = os.getenv("FOUNDRY_FORGE_RUNTIME_MODE", "simulated").strip().lower()
        self.worker = os.getenv("FOUNDRY_FORGE_WORKER", "local-process").strip() or "local-process"
        if self.mode not in {"simulated", "local"}:
            self.mode = "simulated"
        self._local_trainer_backend: Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]] | None = None

    def set_local_trainer_backend(
        self,
        backend: Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]] | None,
    ) -> None:
        """Inject a local trainer adapter while keeping the Forge contract boundary stable."""
        self._local_trainer_backend = backend

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
                supportsMethods=["LoRA"],
            )

        return ForgeRuntime(
            mode="local",
            status="ready",
            detail="Local trainer adapter can execute tiny LoRA jobs from Forge contracts.",
            worker=self.worker,
            ready=True,
            supportsMethods=["LoRA"],
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

    def preflight_local_training(self, contract: Dict[str, Any]) -> Dict[str, Any]:
        runtime = self.describe_runtime()
        validation = self.validate_dataset(contract)
        max_rows = int(os.getenv("FOUNDRY_FORGE_TRAIN_MAX_ROWS", "8"))
        max_length = int(os.getenv("FOUNDRY_FORGE_TRAIN_MAX_LENGTH", "256"))
        remote_allowed = os.getenv("FOUNDRY_FORGE_ALLOW_REMOTE_MODEL_DOWNLOAD", "0") == "1"
        model_probe = self._probe_model_reference(contract.get("baseModel", ""))
        memory = self._training_memory_estimate(model_probe["path"])

        checks = [
            self._preflight_check(
                "runtime-mode",
                "Local runtime",
                "pass" if runtime.mode == "local" else "fail",
                runtime.detail
                if runtime.mode == "local"
                else "Configure Forge runtime to local before running the trainer.",
            ),
            self._preflight_check(
                "dependencies",
                "Trainer dependencies",
                "pass" if runtime.ready else "fail",
                runtime.detail,
            ),
            self._preflight_check(
                "forge-purpose",
                "Training Forge",
                "pass" if contract.get("purpose", "training") == "training" else "fail",
                "Local trainer runs training Forges; evaluation Forges produce Trial Reports.",
            ),
            self._preflight_check(
                "training-method",
                "LoRA settings",
                "pass"
                if contract.get("method") == "LoRA" and not contract.get("loadIn4Bit")
                else "fail",
                "MVP local trainer supports LoRA with 4-bit loading disabled.",
            ),
            self._preflight_check(
                "dataset",
                "JSONL Material",
                "pass" if validation["valid"] else "fail",
                validation["message"],
            ),
            self._preflight_check(
                "dataset-size",
                "Tiny proof size",
                "pass" if 0 < validation.get("rowCount", 0) <= max_rows else "warn",
                (
                    f"{validation.get('rowCount', 0)} usable rows. "
                    f"The local proof run will train on the first {max_rows} rows."
                ),
            ),
            self._preflight_check(
                "model-cache",
                "Cached base model",
                "pass" if model_probe["cached"] else ("warn" if remote_allowed else "fail"),
                model_probe["message"],
            ),
            self._preflight_check(
                "memory-fit",
                "Memory estimate",
                memory["checkStatus"],
                memory["message"],
            ),
        ]
        warnings = [check["detail"] for check in checks if check["status"] == "warn"]
        failed = [check for check in checks if check["status"] == "fail"]
        ok = not failed
        status = "ready" if ok and not warnings else "caution" if ok else "blocked"

        return {
            "ok": ok,
            "status": status,
            "title": "Local trainer ready" if ok else "Local trainer blocked",
            "summary": (
                "This Forge can run the tiny local LoRA trainer."
                if ok
                else "Resolve failed checks before running the local trainer."
            ),
            "nextAction": (
                "Run Local Trainer"
                if ok
                else "Fix the blocked checks, then preflight again."
            ),
            "contract": contract,
            "validation": validation,
            "runtime": self.runtime_payload(),
            "model": model_probe,
            "memory": memory,
            "checks": checks,
            "warnings": warnings,
            "limits": {
                "maxRows": max_rows,
                "maxLength": max_length,
            },
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    def execute_local_training(self, contract: Dict[str, Any]) -> Dict[str, Any]:
        forge_run_id = contract["forgeRunId"]
        readiness = self.preflight_local_training(contract)
        if not readiness["ok"]:
            failed = ", ".join(
                check["label"] for check in readiness["checks"] if check["status"] == "fail"
            )
            raise ValueError(f"Local trainer preflight failed: {failed}.")
        runtime = self.describe_runtime()
        if runtime.mode != "local":
            raise ValueError("Set the Forge runtime to local before running the local trainer.")
        if not runtime.ready:
            raise ValueError(runtime.detail)
        if contract.get("purpose", "training") != "training":
            raise ValueError("Local trainer only supports training Forges.")
        if contract.get("method") == "QLoRA" or contract.get("loadIn4Bit"):
            raise ValueError(
                "QLoRA and 4-bit loading are not enabled in the tiny local trainer yet. "
                "Use LoRA with 4-bit disabled for the MVP trainer path."
            )

        state = self.initialize_contract(contract)
        validation = state["validation"]
        if not validation["valid"]:
            return state

        try:
            self._append_event(
                forge_run_id,
                "local_training_started",
                "Local trainer started from the durable Forge contract.",
                progress=10,
                data={
                    "baseModel": contract["baseModel"],
                    "method": contract["method"],
                    "worker": self.worker,
                },
            )
            result = self._execute_trainer_backend(contract, validation)
            self._append_event(
                forge_run_id,
                "adapter_saved",
                "Local LoRA adapter was saved to the contract output directory.",
                progress=96,
                data={
                    "adapterPath": result["adapterPath"],
                    "outputDir": contract["outputDir"],
                },
            )
            self._append_event(
                forge_run_id,
                "local_training_completed",
                "Local LoRA training completed and Artifact metadata can be created.",
                progress=100,
                epoch={"current": contract["epochs"], "total": contract["epochs"]},
                data=result,
            )
            self._write_metrics(
                forge_run_id,
                {
                    "forgeRunId": forge_run_id,
                    "status": "completed",
                    "progress": 100,
                    "datasetRows": validation.get("rowCount", 0),
                    "lastEvent": "local_training_completed",
                    "epoch": {"current": contract["epochs"], "total": contract["epochs"]},
                    "runtimeMode": "local",
                    "device": result["device"],
                    "loss": result["loss"],
                    "adapterPath": result["adapterPath"],
                    "outputDir": contract["outputDir"],
                },
            )
        except Exception as error:
            message = str(error)
            self._append_event(
                forge_run_id,
                "local_training_failed",
                message,
                progress=state["metrics"].get("progress", 0),
                data={"errorType": error.__class__.__name__},
            )
            self._write_metrics(
                forge_run_id,
                {
                    "forgeRunId": forge_run_id,
                    "status": "failed",
                    "progress": state["metrics"].get("progress", 0),
                    "datasetRows": validation.get("rowCount", 0),
                    "lastEvent": "local_training_failed",
                    "runtimeMode": "local",
                    "error": message,
                },
            )
            raise ValueError(message) from error

        return {
            "contract": contract,
            "validation": validation,
            "events": self.list_events(forge_run_id),
            "metrics": self.get_metrics(forge_run_id),
        }

    def _execute_trainer_backend(
        self,
        contract: Dict[str, Any],
        validation: Dict[str, Any],
    ) -> Dict[str, Any]:
        if self._local_trainer_backend:
            return self._local_trainer_backend(contract, validation)
        return self._run_lora_training(contract, validation)

    def _run_lora_training(
        self,
        contract: Dict[str, Any],
        validation: Dict[str, Any],
    ) -> Dict[str, Any]:
        import torch
        from peft import LoraConfig, get_peft_model
        from torch.optim import AdamW
        from transformers import AutoModelForCausalLM, AutoTokenizer

        rows = self._read_training_rows(
            contract["datasetUri"],
            limit=int(os.getenv("FOUNDRY_FORGE_TRAIN_MAX_ROWS", "8")),
        )
        if not rows:
            raise ValueError("Dataset has no usable training rows.")

        model_ref = self._resolve_model_reference(contract["baseModel"])
        device = self._local_training_device(torch)
        tokenizer = AutoTokenizer.from_pretrained(model_ref)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(model_ref)
        target_modules = self._lora_target_modules(model)
        config = LoraConfig(
            r=int(os.getenv("FOUNDRY_FORGE_LORA_R", "4")),
            lora_alpha=int(os.getenv("FOUNDRY_FORGE_LORA_ALPHA", "8")),
            target_modules=target_modules,
            lora_dropout=float(os.getenv("FOUNDRY_FORGE_LORA_DROPOUT", "0.05")),
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, config)
        model.to(device)
        model.train()

        max_length = int(os.getenv("FOUNDRY_FORGE_TRAIN_MAX_LENGTH", "256"))
        learning_rate = float(contract.get("learningRate") or 0.0002)
        optimizer = AdamW(model.parameters(), lr=learning_rate)
        loss_value = 0.0
        total_steps = max(1, len(rows) * int(contract["epochs"]))

        for epoch_index in range(int(contract["epochs"])):
            self._append_event(
                contract["forgeRunId"],
                "epoch_started",
                f"Local trainer started epoch {epoch_index + 1} of {contract['epochs']}.",
                progress=max(12, round((epoch_index / max(1, contract["epochs"])) * 90)),
                epoch={"current": epoch_index, "total": contract["epochs"]},
            )
            for row_index, row in enumerate(rows, start=1):
                encoded = tokenizer(
                    self._format_training_text(row),
                    truncation=True,
                    max_length=max_length,
                    padding="max_length",
                    return_tensors="pt",
                )
                input_ids = encoded["input_ids"].to(device)
                attention_mask = encoded["attention_mask"].to(device)
                labels = input_ids.clone()
                labels[attention_mask == 0] = -100

                outputs = model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    labels=labels,
                )
                loss = outputs.loss
                loss.backward()
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                loss_value = float(loss.detach().cpu().item())

                step_number = epoch_index * len(rows) + row_index
                progress = min(95, 12 + round((step_number / total_steps) * 82))
                self._append_event(
                    contract["forgeRunId"],
                    "step_completed",
                    f"Local trainer completed step {step_number} of {total_steps}.",
                    progress=progress,
                    epoch={"current": epoch_index + 1, "total": contract["epochs"]},
                    data={"loss": round(loss_value, 4), "rows": len(rows)},
                )

        output_dir = self._resolve_runtime_path(contract["outputDir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(output_dir)
        tokenizer.save_pretrained(output_dir)
        result = {
            "adapterPath": str(output_dir.relative_to(BASE_DIR)),
            "baseModel": str(model_ref),
            "device": device,
            "loss": round(loss_value, 4),
            "rowsUsed": len(rows),
            "datasetRows": validation.get("rowCount", len(rows)),
            "targetModules": target_modules,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        self._write_json(output_dir / "trainer-result.json", result)
        return result

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
            evaluation_report = self.build_evaluation_report(contract)
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
                        "passRate": evaluation_report["passRate"],
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

        metrics_payload = {
            "forgeRunId": forge_run_id,
            "status": status,
            "progress": progress,
            "epoch": epoch,
            "datasetRows": self._dataset_row_count_from_events(forge_run_id),
            "lastEvent": self.list_events(forge_run_id)[-1]["type"],
        }
        if status == "completed" and purpose == "evaluation":
            metrics_payload["evaluationReport"] = self.build_evaluation_report(contract)

        self._write_metrics(forge_run_id, metrics_payload)
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

    def build_evaluation_report(self, contract: Dict[str, Any]) -> Dict[str, Any]:
        rows = self._read_evaluation_rows(contract["datasetUri"])
        row_count = len(rows)
        pass_count = 0
        needs_work_count = 0
        fail_count = 0
        samples = []

        for index, row in enumerate(rows[:5]):
            expected = str(row.get("output", "")).strip()
            instruction = str(row.get("instruction", "")).strip()
            observed = self._simulated_observed_response(instruction, expected, index)
            verdict = self._simulated_verdict(index, row_count)
            if verdict == "pass":
                pass_count += 1
            elif verdict == "needs-work":
                needs_work_count += 1
            else:
                fail_count += 1
            samples.append(
                {
                    "instruction": instruction,
                    "expected": expected,
                    "observed": observed,
                    "verdict": verdict,
                    "note": self._simulated_eval_note(verdict),
                }
            )

        remaining = max(0, row_count - len(samples))
        pass_count += round(remaining * 0.68)
        needs_work_count += round(remaining * 0.22)
        fail_count = row_count - pass_count - needs_work_count
        pass_rate = round((pass_count / max(1, row_count)) * 100)

        return {
            "reportVersion": "foundry.forge.evaluation.v1",
            "forgeRunId": contract["forgeRunId"],
            "materialId": contract["materialId"],
            "datasetUri": contract["datasetUri"],
            "rowCount": row_count,
            "passCount": pass_count,
            "needsWorkCount": needs_work_count,
            "failCount": fail_count,
            "passRate": pass_rate,
            "rubric": [
                {
                    "label": "Instruction match",
                    "score": min(96, max(42, pass_rate + 8)),
                    "explanation": "Checks whether replies follow the requested task and persona constraints.",
                },
                {
                    "label": "Expected answer overlap",
                    "score": min(94, max(38, pass_rate - 2)),
                    "explanation": "Compares generated content against reviewed reference answers.",
                },
                {
                    "label": "Safety and tone",
                    "score": min(98, max(50, pass_rate + 12)),
                    "explanation": "Flags harsh, unsafe, or off-character responses before promotion.",
                },
            ],
            "samples": samples,
            "recommendations": self._evaluation_recommendations(pass_rate, row_count),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    def _read_evaluation_rows(self, dataset_uri: str) -> list[Dict[str, Any]]:
        dataset_path = self._resolve_runtime_path(dataset_uri)
        rows: list[Dict[str, Any]] = []
        if not dataset_path.exists():
            return rows
        with dataset_path.open("r", encoding="utf-8") as dataset_file:
            for line in dataset_file:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    row = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                if row.get("instruction") and row.get("output"):
                    rows.append(row)
        return rows

    def _read_training_rows(self, dataset_uri: str, *, limit: int) -> list[Dict[str, Any]]:
        rows = self._read_evaluation_rows(dataset_uri)
        return rows[: max(1, limit)]

    def _format_training_text(self, row: Dict[str, Any]) -> str:
        instruction = str(row.get("instruction", "")).strip()
        response = str(row.get("output", "")).strip()
        return f"### Instruction\n{instruction}\n\n### Response\n{response}"

    def _resolve_model_reference(self, model_ref: str) -> str:
        model_ref = model_ref.strip()
        if not model_ref:
            raise ValueError("Forge contract base model is empty.")

        model_path = Path(model_ref)
        if model_path.exists():
            return str(model_path)

        archived_model = self._archive_model_path(model_ref)
        if archived_model.exists():
            return str(archived_model)

        if os.getenv("FOUNDRY_FORGE_ALLOW_REMOTE_MODEL_DOWNLOAD", "0") == "1":
            return model_ref

        raise ValueError(
            "Base model is not cached in the Archive. Download it first or set "
            "FOUNDRY_FORGE_ALLOW_REMOTE_MODEL_DOWNLOAD=1 for an explicit remote fetch."
        )

    def _safe_archive_slug(self, model_ref: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "-", model_ref.strip()).strip("-") or "model"

    def _archive_model_path(self, model_ref: str) -> Path:
        return BASE_DIR / "runtime" / "models" / "huggingface" / self._safe_archive_slug(model_ref)

    def _probe_model_reference(self, model_ref: str) -> Dict[str, Any]:
        model_ref = model_ref.strip()
        remote_allowed = os.getenv("FOUNDRY_FORGE_ALLOW_REMOTE_MODEL_DOWNLOAD", "0") == "1"
        if not model_ref:
            return {
                "baseModel": model_ref,
                "path": None,
                "cached": False,
                "remoteAllowed": remote_allowed,
                "sizeOnDiskBytes": 0,
                "message": "Forge contract base model is empty.",
            }

        direct_path = Path(model_ref)
        if direct_path.exists():
            return {
                "baseModel": model_ref,
                "path": str(direct_path),
                "cached": True,
                "remoteAllowed": remote_allowed,
                "sizeOnDiskBytes": self._directory_size(direct_path),
                "message": "Base model resolves to a local path.",
            }

        archive_path = self._archive_model_path(model_ref)
        if archive_path.exists():
            return {
                "baseModel": model_ref,
                "path": str(archive_path),
                "cached": True,
                "remoteAllowed": remote_allowed,
                "sizeOnDiskBytes": self._directory_size(archive_path),
                "message": "Base model is cached in the Archive.",
            }

        return {
            "baseModel": model_ref,
            "path": None,
            "cached": False,
            "remoteAllowed": remote_allowed,
            "sizeOnDiskBytes": 0,
            "message": (
                "Base model is not cached. Download it into the Archive first."
                if not remote_allowed
                else "Base model is not cached; remote download is explicitly allowed."
            ),
        }

    def _directory_size(self, path: Path) -> int:
        if not path.exists():
            return 0
        if path.is_file():
            return path.stat().st_size
        total = 0
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    total += file_path.stat().st_size
                except OSError:
                    continue
        return total

    def _available_memory_bytes(self) -> int:
        try:
            import psutil
        except ModuleNotFoundError:
            return 0
        return int(psutil.virtual_memory().available)

    def _training_memory_estimate(self, model_path: str | None) -> Dict[str, Any]:
        model_size = self._directory_size(Path(model_path)) if model_path else 0
        estimated = int(max(model_size * 2.2, model_size + 512 * 1024 * 1024)) if model_size else 0
        available = self._available_memory_bytes()
        if estimated == 0:
            fit_status = "unknown"
            check_status = "warn"
            message = "Memory fit cannot be estimated until the base model is cached."
        elif available == 0:
            fit_status = "unknown"
            check_status = "warn"
            message = "System memory could not be measured; monitor memory during training."
        elif estimated <= available * 0.75:
            fit_status = "fits"
            check_status = "pass"
            message = "Estimated local training memory fits the conservative budget."
        elif estimated <= available * 0.9:
            fit_status = "tight"
            check_status = "warn"
            message = "Estimated local training memory is tight; close other workloads first."
        else:
            fit_status = "too-large"
            check_status = "fail"
            message = "Estimated local training memory exceeds the conservative budget."
        return {
            "fitStatus": fit_status,
            "checkStatus": check_status,
            "estimatedLoadBytes": estimated,
            "availableBytes": available,
            "message": message,
        }

    def _preflight_check(
        self,
        check_id: str,
        label: str,
        status: str,
        detail: str,
    ) -> Dict[str, Any]:
        return {
            "id": check_id,
            "label": label,
            "status": status,
            "detail": detail,
        }

    def _local_training_device(self, torch_module: Any) -> str:
        configured = os.getenv("FOUNDRY_FORGE_TRAIN_DEVICE", "").strip().lower()
        if configured in {"cpu", "cuda", "mps"}:
            return configured
        if torch_module.cuda.is_available():
            return "cuda"
        if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _lora_target_modules(self, model: Any) -> list[str]:
        configured = os.getenv("FOUNDRY_FORGE_LORA_TARGET_MODULES", "").strip()
        if configured:
            return [module.strip() for module in configured.split(",") if module.strip()]

        preferred = [
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
            "c_attn",
            "c_proj",
            "c_fc",
            "query",
            "key",
            "value",
            "dense",
        ]
        available = {
            name.rsplit(".", 1)[-1]
            for name, _module in model.named_modules()
            if name
        }
        targets = [name for name in preferred if name in available]
        if not targets:
            raise ValueError(
                "Could not infer LoRA target modules for this base model. Set "
                "FOUNDRY_FORGE_LORA_TARGET_MODULES to a comma-separated module list."
            )
        return targets

    def _simulated_observed_response(self, instruction: str, expected: str, index: int) -> str:
        if index % 5 == 4:
            return "The Construct drifted from the expected answer and needs another reviewed example."
        if index % 3 == 2:
            return expected[:180] + ("..." if len(expected) > 180 else "")
        return expected or f"Simulated response for: {instruction}"

    def _simulated_verdict(self, index: int, row_count: int) -> str:
        if row_count == 1:
            return "needs-work"
        if index % 5 == 4:
            return "fail"
        if index % 3 == 2:
            return "needs-work"
        return "pass"

    def _simulated_eval_note(self, verdict: str) -> str:
        if verdict == "pass":
            return "Reference answer and simulated Construct reply line up well."
        if verdict == "needs-work":
            return "Reply is directionally useful but should be tightened before promotion."
        return "Reply missed the expected behavior and should feed another training pass."

    def _evaluation_recommendations(self, pass_rate: int, row_count: int) -> list[str]:
        recommendations = [
            "Review failed and needs-work samples before promoting a new Artifact.",
            "Export corrected Trial rows back into Materials when the same mistake repeats.",
        ]
        if row_count < 10:
            recommendations.append("Add more evaluation rows; tiny Trial sets can overstate quality.")
        if pass_rate < 75:
            recommendations.append("Run another training Forge after adding targeted examples.")
        else:
            recommendations.append("Compare this Trial Report against the next Artifact before deployment.")
        return recommendations

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
