#!/usr/bin/env python3
"""Exercise the MVP catalog workflow against isolated runtime storage."""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
import tempfile
from io import BytesIO
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from EMA.backend.services import forge_training_service as forge_module
from EMA.backend.services import foundry_catalog_service as catalog_module
from EMA.backend.services.forge_training_service import ForgeTrainingService
from EMA.backend.services.foundry_catalog_service import FoundryCatalogService


def tiny_pdf_bytes(text: str) -> bytes:
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    safe_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream.set_data(f"BT /F1 12 Tf 72 720 Td ({safe_text}) Tj ET".encode("utf-8"))
    page[NameObject("/Contents")] = stream
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


async def exercise_material_ingestion_formats(
    catalog: FoundryCatalogService,
    workshop_id: str,
) -> None:
    imports = [
        {
            "name": "Markdown Notes",
            "kind": "text",
            "filename": "notes.md",
            "content": b"Marshall markdown notes explain water rescue teamwork.",
            "expected": "markdown notes explain water rescue",
        },
        {
            "name": "CSV Episodes",
            "kind": "csv",
            "filename": "episodes.csv",
            "content": (
                b"episode,summary\n"
                b"Pups Save the Bay,Marshall coordinates a ladder rescue.\n"
            ),
            "expected": "episode: Pups Save the Bay",
        },
        {
            "name": "JSONL QA",
            "kind": "jsonl",
            "filename": "qa.jsonl",
            "content": (
                b'{"instruction":"Who drives the fire truck?","output":"Marshall drives the fire truck."}\n'
            ),
            "expected": "Instruction: Who drives the fire truck",
        },
        {
            "name": "PDF Guide",
            "kind": "pdf",
            "filename": "guide.pdf",
            "content": tiny_pdf_bytes("Marshall PDF rescue notes mention ladder safety."),
            "expected": "Marshall PDF rescue notes mention ladder safety",
        },
    ]
    materials = []
    for item in imports:
        material = await catalog.import_material_file(
            workshop_id=workshop_id,
            name=item["name"],
            kind=item["kind"],
            filename=item["filename"],
            content=item["content"],
        )
        assert material["status"] == "staged"
        assert (catalog_module.BASE_DIR / material["sourceUri"]).exists()
        materials.append({**item, "id": material["id"]})

    assembly = await catalog.start_assembly_line(
        workshop_id=workshop_id,
        material_source_ids=[material["id"] for material in materials],
        chunk_size_tokens=128,
        chunk_overlap_tokens=0,
        qa_pairs_per_source=1,
    )
    chunks = await catalog.list_material_chunks(workshop_id, assembly["id"])
    chunk_text = "\n".join(chunk["text"] for chunk in chunks)
    for material in materials:
        assert material["expected"] in chunk_text


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

    qa_runtime = catalog.qa_generator.runtime_payload()
    assert qa_runtime["contractVersion"] == "foundry.qa-generator.runtime.v1"
    assert qa_runtime["mode"] == "deterministic"
    configured_runtime = catalog.qa_generator.configure(
        mode="deterministic",
        model_id="sshleifer/tiny-gpt2",
        max_new_tokens=128,
        temperature=0.1,
    )
    assert configured_runtime["ready"] is True
    qa_smoke = catalog.qa_generator.smoke_proof()
    assert qa_smoke["contractVersion"] == "foundry.qa-generator.smoke-proof.v1"
    assert qa_smoke["rows"][0]["generationMetadata"]["contractVersion"] == "foundry.qa-generation.v1"
    qa_quality = catalog.qa_generator.quality_proof()
    assert qa_quality["contractVersion"] == "foundry.qa-generator.quality-proof.v1"
    assert len(qa_quality["results"]) == 2
    assert qa_quality["results"][0]["label"] == "Deterministic smoke"
    assert qa_quality["results"][0]["quality"]["score"] > 0

    workshop = await catalog.create_workshop(
        name="MVP Contract Workshop",
        subject="Foundry",
        voice_target="Engineer",
        base_model="sshleifer/tiny-gpt2",
    )
    await exercise_material_ingestion_formats(catalog, workshop["id"])

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
    assert qa_pairs[0]["qualityGate"]["status"] == "blocked"
    assert qa_pairs[0]["qualityGate"]["metrics"]["score"] > 0
    assert qa_pairs[0]["qualityGate"]["metrics"]["sourceOverlap"] > 0

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

    try:
        await catalog.export_qa_pairs_to_material(
            workshop_id=workshop["id"],
            assembly_line_run_id=assembly["id"],
            name="Accepted Rows",
        )
    except ValueError as error:
        assert "QA quality gate blocked export" in str(error)
    else:
        raise AssertionError("Low-quality QA export should be blocked without override.")

    exported = await catalog.export_qa_pairs_to_material(
        workshop_id=workshop["id"],
        assembly_line_run_id=assembly["id"],
        include_low_quality=True,
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
    assert rows[0]["metadata"]["lowQualityOverride"] is True
    assert rows[0]["metadata"]["qualityGate"]["status"] == "blocked"
    assert rows[0]["metadata"]["qualityGate"]["metrics"]["score"] > 0
    assert exported["qualityGate"]["status"] == "override"

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

    completed_forge = forge_run
    worker_state = state
    for _ in range(10):
        completed_forge = await catalog.advance_forge_simulation(forge_run["id"])
        worker_state = forge.reconcile_worker_state(
            forge_run=completed_forge,
            material=exported["material"],
        )
        if completed_forge["status"] == "completed":
            break

    assert completed_forge["status"] == "completed"
    assert completed_forge["progress"] == 100
    assert completed_forge["artifactId"]
    assert worker_state["metrics"]["status"] == "completed"
    assert worker_state["metrics"]["lastEvent"] == "completed"

    artifacts = await catalog.list_artifacts(workshop["id"])
    artifact = next(
        item for item in artifacts if item["id"] == completed_forge["artifactId"]
    )
    assert artifact["status"] == "ready"
    assert artifact["forgeRunId"] == forge_run["id"]
    assert artifact["baseModel"] == "sshleifer/tiny-gpt2"
    assert artifact["adapterPath"].startswith("runtime/artifacts/")

    construct = await catalog.load_artifact_into_construct(
        workshop_id=workshop["id"],
        artifact_id=artifact["id"],
    )
    assert construct["artifactId"] == artifact["id"]
    assert construct["status"] == "warming"
    assert construct["streamingEnabled"] is True

    prompt = "What should a new engineer learn from this Forge?"
    chat = await catalog.chat_with_construct(
        construct_id=construct["id"],
        conversation_id="mvp-rehearsal",
        message=prompt,
        include_library_context=False,
        max_new_tokens=64,
        temperature=0.2,
    )
    assert chat["artifact"]["id"] == artifact["id"]
    assert chat["message"]["sender"] == "assistant"
    assert "Simulated response" in chat["message"]["text"]
    assert artifact["name"] in chat["message"]["text"]
    assert chat["generation"]["maxNewTokens"] == 64
    assert chat["generation"]["temperature"] == 0.2

    trial = await catalog.create_trial(
        workshop_id=workshop["id"],
        artifact_id=artifact["id"],
        construct_id=construct["id"],
        message_id=chat["message"]["id"],
        prompt=prompt,
        response=chat["message"]["text"],
        verdict="pass",
        runtime_mode="simulated",
        token_count=chat["message"]["tokenCount"],
        generation_settings=chat["generation"],
    )
    assert trial["artifactId"] == artifact["id"]
    assert trial["constructId"] == construct["id"]
    assert trial["messageId"] == chat["message"]["id"]
    assert trial["runtimeMode"] == "simulated"
    assert trial["verdict"] == "pass"

    trials = await catalog.list_trials(workshop["id"])
    assert len(trials) == 1
    assert trials[0]["id"] == trial["id"]
    scored_artifact = next(
        item for item in await catalog.list_artifacts(workshop["id"])
        if item["id"] == artifact["id"]
    )
    assert scored_artifact["trialScore"] == 100


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        asyncio.run(exercise_workflow(Path(tmp_dir)))
    print("OK: Foundry MVP workflow rehearsal passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
