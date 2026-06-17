from __future__ import annotations

import json
import os
import asyncio
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

from backend.services import foundry_catalog_service as catalog_module
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService


SMOKE_MODEL_ID = "sshleifer/tiny-gpt2"
SMOKE_MATERIAL_NAME = "Local Forge Smoke JSONL"


class LocalForgeSmokeService:
    """Builds a deterministic tiny Forge proof for local LoRA training."""

    def __init__(
        self,
        catalog_service: FoundryCatalogService,
        forge_training_service: ForgeTrainingService,
    ) -> None:
        self.catalog_service = catalog_service
        self.forge_training_service = forge_training_service

    async def prepare(self, *, run_training: bool) -> Dict[str, Any]:
        os.environ["FOUNDRY_FORGE_RUNTIME_MODE"] = "local"
        os.environ["FOUNDRY_FORGE_TRAIN_DEVICE"] = "cpu"
        self.forge_training_service.mode = "local"

        workshop = await self.catalog_service.create_workshop(
            name="Local Forge Smoke",
            subject="Foundry runtime smoke test",
            voice_target="Foundry Mentor",
            base_model=SMOKE_MODEL_ID,
        )
        material_path = self._write_smoke_jsonl()
        material = await self.catalog_service.register_material(
            workshop_id=workshop["id"],
            name=SMOKE_MATERIAL_NAME,
            kind="jsonl",
            source_uri=self._relative_to_base(material_path),
        )
        material = await self._mark_material_ready(
            material_id=material["id"],
            workshop_id=workshop["id"],
        )
        forge_run = await self.catalog_service.start_forge(
            workshop_id=workshop["id"],
            material_id=material["id"],
            base_model=SMOKE_MODEL_ID,
            method="LoRA",
            purpose="training",
            epochs=1,
            learning_rate="0.0002",
            load_in_4bit=False,
        )
        contract = self.forge_training_service.build_training_contract(
            forge_run=forge_run,
            material=material,
        )
        state = self.forge_training_service.initialize_contract(contract)
        preflight = self.forge_training_service.preflight_local_training(contract)

        result: Dict[str, Any] = {
            "workshop": workshop,
            "material": material,
            "forgeRun": forge_run,
            "contract": contract,
            "workerState": state,
            "preflight": preflight,
            "ranTraining": False,
            "artifact": None,
            "blocked": [],
        }

        if run_training:
            if not preflight["ok"]:
                result["blocked"] = [
                    {
                        "id": check["id"],
                        "label": check["label"],
                        "detail": check["detail"],
                    }
                    for check in preflight["checks"]
                    if check["status"] == "fail"
                ]
                return result

            worker_state = await asyncio.to_thread(
                self._execute_training_worker,
                contract["forgeRunId"],
            )
            completed = await self.catalog_service.complete_forge_from_worker(
                forge_run["id"],
                adapter_path=worker_state["metrics"].get("adapterPath"),
            )
            artifacts = await self.catalog_service.list_artifacts(workshop["id"])
            result["ranTraining"] = True
            result["workerState"] = worker_state
            result["forgeRun"] = completed
            result["artifact"] = next(
                (artifact for artifact in artifacts if artifact["id"] == completed.get("artifactId")),
                None,
            )

        return result

    def _execute_training_worker(self, forge_run_id: str) -> Dict[str, Any]:
        script_path = catalog_module.BASE_DIR.parent / "scripts" / "run_forge_contract_worker.py"
        env = {
            **os.environ,
            "FOUNDRY_FORGE_RUNTIME_MODE": "local",
            "FOUNDRY_FORGE_TRAIN_DEVICE": "cpu",
        }
        completed = subprocess.run(
            [sys.executable, str(script_path), forge_run_id],
            cwd=str(catalog_module.BASE_DIR.parent),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        metrics = self.forge_training_service.get_metrics(forge_run_id)
        events = self.forge_training_service.list_events(forge_run_id)
        if metrics.get("status") == "completed":
            return {
                "events": events,
                "metrics": metrics,
                "worker": {
                    "exitCode": completed.returncode,
                    "stdout": completed.stdout[-2000:],
                    "stderr": completed.stderr[-2000:],
                },
            }
        if completed.returncode != 0:
            raise ValueError(
                "Local Forge worker failed before completion: "
                + (completed.stderr.strip() or completed.stdout.strip() or f"exit {completed.returncode}")
            )
        return {
            "events": events,
            "metrics": metrics,
            "worker": {
                "exitCode": completed.returncode,
                "stdout": completed.stdout[-2000:],
                "stderr": completed.stderr[-2000:],
            },
        }

    def _write_smoke_jsonl(self) -> Path:
        export_dir = catalog_module.DEFAULT_EXPORT_DIR / "smoke"
        export_dir.mkdir(parents=True, exist_ok=True)
        export_path = export_dir / "local-forge-smoke.jsonl"
        row = {
            "id": "smoke-row-1",
            "instruction": "Reply as a concise Foundry mentor. What does a Forge do?",
            "input": "",
            "output": (
                "A Forge trains a model adapter from reviewed Materials, turning raw examples "
                "into an Artifact that can be tested and loaded into a Construct."
            ),
            "metadata": {
                "format": "foundry.smoke.local-forge.v1",
                "reviewStatus": "accepted",
            },
        }
        export_path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
        return export_path

    def _relative_to_base(self, path: Path) -> str:
        return str(path.relative_to(catalog_module.BASE_DIR))

    async def _mark_material_ready(
        self,
        *,
        material_id: str,
        workshop_id: str,
    ) -> Dict[str, Any]:
        def update() -> Dict[str, Any]:
            with self.catalog_service._connect() as connection:
                connection.execute(
                    """
                    UPDATE materials
                    SET status = 'qa-ready',
                        chunk_count = 1,
                        qa_pair_count = 1
                    WHERE id = ? AND workshop_id = ?
                    """,
                    (material_id, workshop_id),
                )
                row = connection.execute(
                    "SELECT * FROM materials WHERE id = ?",
                    (material_id,),
                ).fetchone()
                return self.catalog_service._material_from_row(row)

        return await self.catalog_service._run_query(update)
