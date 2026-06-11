from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from typing import Any, Dict


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
        output_dir = f"runtime/artifacts/pending/{forge_run['id']}"
        return {
            "contractVersion": "foundry.forge.training.v1",
            "forgeRunId": forge_run["id"],
            "workshopId": forge_run["workshopId"],
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
