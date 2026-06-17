#!/usr/bin/env python3
"""Exercise the MVP catalog workflow against isolated runtime storage."""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from EMA.backend.services import forge_training_service as forge_module
from EMA.backend.services import foundry_catalog_service as catalog_module
from EMA.backend.services.forge_training_service import ForgeTrainingService
from EMA.backend.services.foundry_catalog_service import FoundryCatalogService


async def exercise_workflow(tmp_path: Path) -> None:
    runtime_root = catalog_module.BASE_DIR / "runtime" / "test-workflow" / tmp_path.name
    catalog_module.DEFAULT_SOURCE_DIR = runtime_root / "sources"
    catalog_module.DEFAULT_EXPORT_DIR = runtime_root / "exports"
    forge_module.DEFAULT_FORGE_RUNTIME_DIR = runtime_root / "forges"

    try:
        await _exercise_workflow(tmp_path)
    finally:
        shutil.rmtree(runtime_root, ignore_errors=True)


async def _exercise_workflow(tmp_path: Path) -> None:
    catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    forge = ForgeTrainingService()

    workshop = await catalog.create_workshop(
        name="MVP Contract Workshop",
        subject="Foundry",
        voice_target="Engineer",
        base_model="sshleifer/tiny-gpt2",
    )
    material = await catalog.import_material_file(
        workshop_id=workshop["id"],
        name="Local Notes",
        kind="text",
        filename="notes.txt",
        content=(
            b"Marshall helps the team during rescues. "
            b"Rubble brings tools when repairs are needed."
        ),
    )
    assert material["status"] == "staged"
    assert (catalog_module.BASE_DIR / material["sourceUri"]).exists()

    assembly = await catalog.start_assembly_line(
        workshop_id=workshop["id"],
        material_source_ids=[material["id"]],
        chunk_size_tokens=128,
        chunk_overlap_tokens=0,
        qa_pairs_per_source=1,
    )
    chunks = await catalog.list_material_chunks(workshop["id"], assembly["id"])
    qa_pairs = await catalog.list_qa_pairs(workshop["id"], assembly["id"])
    assert chunks and "Marshall helps the team" in chunks[0]["text"]
    assert qa_pairs and qa_pairs[0]["reviewStatus"] == "draft"
    assert qa_pairs[0]["generatorModel"] == "deterministic-context-generator"
    assert qa_pairs[0]["confidence"] > 0
    assert qa_pairs[0]["generationMetadata"]["contractVersion"] == "foundry.qa-generation.v1"

    try:
        await catalog.export_qa_pairs_to_material(workshop["id"], assembly["id"])
    except ValueError as error:
        assert "no accepted QA pairs" in str(error)
    else:
        raise AssertionError("Draft-only QA export should be blocked by default.")

    accepted = await catalog.update_qa_pair_review(
        workshop_id=workshop["id"],
        qa_pair_id=qa_pairs[0]["id"],
        question=qa_pairs[0]["question"] + " Reviewed?",
        answer=qa_pairs[0]["answer"] + " Reviewed.",
        review_status="accepted",
    )
    assert accepted["reviewStatus"] == "accepted"
    assert accepted["reviewedAt"]

    exported = await catalog.export_qa_pairs_to_material(
        workshop_id=workshop["id"],
        assembly_line_run_id=assembly["id"],
        name="Accepted Rows",
    )
    exported_path = catalog_module.BASE_DIR / exported["exportUri"]
    assert exported_path.exists()
    rows = [
        json.loads(line)
        for line in exported_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(rows) == 1
    assert rows[0]["metadata"]["reviewStatus"] == "accepted"
    assert rows[0]["metadata"]["generatorModel"] == "deterministic-context-generator"
    assert rows[0]["metadata"]["confidence"] > 0
    assert rows[0]["metadata"]["generation"]["contractVersion"] == "foundry.qa-generation.v1"

    forge_run = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=exported["material"]["id"],
        base_model="sshleifer/tiny-gpt2",
        method="LoRA",
        purpose="training",
        epochs=1,
        learning_rate="0.0002",
        load_in_4bit=False,
    )
    contract = forge.build_training_contract(
        forge_run=forge_run,
        material=exported["material"],
    )
    state = forge.initialize_contract(contract)
    assert contract["contractVersion"] == "foundry.forge.training.v1"
    assert state["validation"]["valid"] is True
    assert state["validation"]["rowCount"] == 1
    assert (forge_module.DEFAULT_FORGE_RUNTIME_DIR / forge_run["id"] / "contract.json").exists()
    readiness = forge.preflight_local_training(contract)
    assert readiness["ok"] is False
    assert any(check["id"] == "runtime-mode" for check in readiness["checks"])
    assert any(check["id"] == "model-cache" for check in readiness["checks"])

    try:
        forge.execute_local_training(contract)
    except ValueError as error:
        assert "Local trainer preflight failed" in str(error)
    else:
        raise AssertionError("Local trainer should be gated behind local runtime mode.")


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        asyncio.run(exercise_workflow(Path(tmp_dir)))
    print("OK: Foundry MVP workflow contract test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
