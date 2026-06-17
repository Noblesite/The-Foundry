#!/usr/bin/env python3
"""Prepare and optionally run a tiny local Forge LoRA proof.

This script writes a deterministic one-row JSONL Material, queues a LoRA Forge
against the smoke model, and runs the local trainer preflight. Use --run only
after the preflight passes and the model is cached in the Archive.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from EMA.backend.services import foundry_catalog_service as catalog_module
from EMA.backend.services.forge_training_service import ForgeTrainingService
from EMA.backend.services.foundry_catalog_service import FoundryCatalogService


SMOKE_MODEL_ID = "sshleifer/tiny-gpt2"
SMOKE_MATERIAL_NAME = "Local Forge Smoke JSONL"


def _write_smoke_jsonl() -> Path:
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


def _relative_to_base(path: Path) -> str:
    return str(path.relative_to(catalog_module.BASE_DIR))


async def _mark_material_ready(
    catalog: FoundryCatalogService,
    *,
    material_id: str,
    workshop_id: str,
) -> dict[str, Any]:
    def update() -> dict[str, Any]:
        with catalog._connect() as connection:
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
            return catalog._material_from_row(row)

    return await catalog._run_query(update)


async def prepare_smoke_forge(*, run_training: bool) -> dict[str, Any]:
    os.environ["FOUNDRY_FORGE_RUNTIME_MODE"] = "local"
    catalog = FoundryCatalogService()
    forge_service = ForgeTrainingService()

    workshop = await catalog.create_workshop(
        name="Local Forge Smoke",
        subject="Foundry runtime smoke test",
        voice_target="Foundry Mentor",
        base_model=SMOKE_MODEL_ID,
    )
    material_path = _write_smoke_jsonl()
    material = await catalog.register_material(
        workshop_id=workshop["id"],
        name=SMOKE_MATERIAL_NAME,
        kind="jsonl",
        source_uri=_relative_to_base(material_path),
    )
    material = await _mark_material_ready(
        catalog,
        material_id=material["id"],
        workshop_id=workshop["id"],
    )
    forge_run = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=material["id"],
        base_model=SMOKE_MODEL_ID,
        method="LoRA",
        purpose="training",
        epochs=1,
        learning_rate="0.0002",
        load_in_4bit=False,
    )
    contract = forge_service.build_training_contract(
        forge_run=forge_run,
        material=material,
    )
    state = forge_service.initialize_contract(contract)
    preflight = forge_service.preflight_local_training(contract)

    result: dict[str, Any] = {
        "workshop": workshop,
        "material": material,
        "forgeRun": forge_run,
        "contract": contract,
        "workerState": state,
        "preflight": preflight,
        "ranTraining": False,
    }

    if run_training:
        if not preflight["ok"]:
            failed = [
                {
                    "id": check["id"],
                    "label": check["label"],
                    "detail": check["detail"],
                }
                for check in preflight["checks"]
                if check["status"] == "fail"
            ]
            result["blocked"] = failed
            return result

        worker_state = forge_service.execute_local_training(contract)
        completed = await catalog.complete_forge_from_worker(
            forge_run["id"],
            adapter_path=worker_state["metrics"].get("adapterPath"),
        )
        artifacts = await catalog.list_artifacts(workshop["id"])
        result["ranTraining"] = True
        result["workerState"] = worker_state
        result["forgeRun"] = completed
        result["artifact"] = next(
            (artifact for artifact in artifacts if artifact["id"] == completed.get("artifactId")),
            None,
        )

    return result


def _print_summary(result: dict[str, Any]) -> None:
    preflight = result["preflight"]
    print("Local Forge smoke fixture")
    print(f"  Workshop: {result['workshop']['id']} ({result['workshop']['name']})")
    print(f"  Material: {result['material']['id']} -> {result['material']['sourceUri']}")
    print(f"  Forge:    {result['forgeRun']['id']} ({result['forgeRun']['status']})")
    print(f"  Model:    {preflight['model']['baseModel']}")
    print(f"  Preflight: {preflight['status']} / ok={preflight['ok']}")
    for check in preflight["checks"]:
        print(f"    [{check['status']}] {check['label']}: {check['detail']}")

    if result.get("blocked"):
        print("  Training not run. Blocked checks:")
        for check in result["blocked"]:
            print(f"    - {check['label']}: {check['detail']}")
    elif result["ranTraining"]:
        metrics = result["workerState"]["metrics"]
        print(f"  Training completed: loss={metrics.get('loss')} adapter={metrics.get('adapterPath')}")
        if result.get("artifact"):
            artifact = result["artifact"]
            print(f"  Artifact: {artifact['id']} adapter={artifact.get('adapterPath')}")
    else:
        print("  Training not run. Re-run with --run after preflight passes.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run",
        action="store_true",
        help="Run the local LoRA trainer after preflight passes.",
    )
    args = parser.parse_args()

    result = asyncio.run(prepare_smoke_forge(run_training=args.run))
    _print_summary(result)
    return 1 if result.get("blocked") else 0


if __name__ == "__main__":
    raise SystemExit(main())
