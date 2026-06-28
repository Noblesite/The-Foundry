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
from EMA.backend.services import qa_generation_service as qa_module
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


async def exercise_website_material_snapshot(
    catalog: FoundryCatalogService,
    workshop_id: str,
) -> None:
    original_validate = catalog._validate_website_url
    original_fetch = catalog._fetch_website_html
    try:
        catalog._validate_website_url = lambda source_url: source_url
        catalog._fetch_website_html = lambda _source_url: """
            <html>
              <head>
                <title>Marshall Rescue Wiki</title>
                <meta name="description" content="Rescue notes for Marshall." />
                <script>window.noisy = true;</script>
              </head>
              <body>
                <nav>Ignore navigation chrome</nav>
                <main>
                  <h1>Marshall Rescue Profile</h1>
                  <p>Marshall uses a water cannon during rescue practice.</p>
                  <p>He helps Adventure Bay with ladder safety.</p>
                </main>
              </body>
            </html>
        """
        preview = await catalog.preview_website_material(
            source_url="https://example.test/marshall"
        )
        assert preview["contractVersion"] == "foundry.material.website-preview.v1"
        assert preview["sourceUrl"] == "https://example.test/marshall"
        assert preview["title"] == "Marshall Rescue Wiki"
        assert "Marshall uses a water cannon" in preview["textPreview"]
        assert preview["estimatedTokenCount"] > 0

        material = await catalog.register_material(
            workshop_id=workshop_id,
            name="Marshall Wiki Snapshot",
            kind="website",
            source_uri="https://example.test/marshall",
        )
        assert material["kind"] == "website"
        assert material["sourceUri"].startswith("runtime/")
        assert material["sourceUri"].endswith(".txt")
        scrape = material["metadata"]["scrape"]
        assert scrape["contractVersion"] == "foundry.material.scrape-metadata.v1"
        assert scrape["status"] == "snapshot-ready"
        assert scrape["sourceUrl"] == "https://example.test/marshall"
        assert scrape["storedSourceUri"] == material["sourceUri"]
        assert scrape["title"] == "Marshall Rescue Wiki"
        assert scrape["estimatedTokenCount"] > 0
        snapshot_path = catalog_module.BASE_DIR / material["sourceUri"]
        assert snapshot_path.exists()
        snapshot_text = snapshot_path.read_text(encoding="utf-8")
        assert "Source URL: https://example.test/marshall" in snapshot_text
        assert "Marshall uses a water cannon" in snapshot_text
        assert "window.noisy" not in snapshot_text

        assembly = await catalog.start_assembly_line(
            workshop_id=workshop_id,
            material_source_ids=[material["id"]],
            chunk_size_tokens=128,
            chunk_overlap_tokens=0,
            qa_pairs_per_source=1,
        )
        chunks = await catalog.list_material_chunks(workshop_id, assembly["id"])
        chunk_text = "\n".join(chunk["text"] for chunk in chunks)
        assert "Marshall Rescue Profile" in chunk_text
        assert "ladder safety" in chunk_text
    finally:
        catalog._validate_website_url = original_validate
        catalog._fetch_website_html = original_fetch


async def exercise_missing_material_source_blocks_assembly(
    catalog: FoundryCatalogService,
    workshop_id: str,
) -> None:
    material = await catalog.register_material(
        workshop_id=workshop_id,
        name="Missing Source Notes",
        kind="text",
        source_uri="runtime/materials/sources/does-not-exist.txt",
    )

    try:
        await catalog.start_assembly_line(
            workshop_id=workshop_id,
            material_source_ids=[material["id"]],
            chunk_size_tokens=128,
            chunk_overlap_tokens=0,
            qa_pairs_per_source=1,
        )
    except ValueError as error:
        assert "Could not read source text" in str(error)
    else:
        raise AssertionError("Unreadable Material source should not produce estimated chunks.")


async def exercise_model_backed_qa_generation(
    catalog: FoundryCatalogService,
    workshop_id: str,
) -> None:
    captured_prompts = []

    def tiny_model_backend(prompt: str, local_files_only: bool) -> str:
        captured_prompts.append(
            {
                "prompt": prompt,
                "localFilesOnly": local_files_only,
            }
        )
        return json.dumps(
            [
                {
                    "question": "What rescue tool does Marshall use?",
                    "answer": "Marshall uses a water cannon during rescues.",
                    "confidence": 0.93,
                    "qaType": "behavior",
                }
            ]
        )

    cached_generator_dir = catalog.db_path.parent / "cached-qa-generator"
    cached_generator_dir.mkdir(parents=True, exist_ok=True)
    (cached_generator_dir / "config.json").write_text("{}", encoding="utf-8")
    generator_model_id = str(cached_generator_dir)

    catalog.qa_generator.set_model_text_backend(tiny_model_backend)
    catalog.qa_generator.configure(
        mode="transformers",
        model_id=generator_model_id,
        max_new_tokens=96,
        temperature=0.0,
    )
    qa_preflight = catalog.qa_generator.preflight(
        mode="transformers",
        model_id=generator_model_id,
        max_new_tokens=96,
        temperature=0.0,
    )
    assert qa_preflight["status"] == "ready"
    assert qa_preflight["model"]["cached"] is True
    qa_quality = catalog.qa_generator.quality_proof()
    assert qa_quality["proofMode"]["source"] == "backend"
    assert qa_quality["proofMode"]["modelId"] == generator_model_id
    assert qa_quality["proofMode"]["localFilesOnly"] is True
    assert qa_quality["proofMode"]["simulated"] is False
    assert qa_quality["proofMode"]["modelCached"] is True
    model_proof = next(
        result for result in qa_quality["results"] if result["label"] == "Cached local model"
    )
    assert model_proof["status"] == "passed"
    assert model_proof["proofSource"] == "backend-local-model"
    assert model_proof["localFilesOnly"] is True
    assert model_proof["preflightStatus"] == "ready"

    material = await catalog.import_material_file(
        workshop_id=workshop_id,
        name="Model Backed Notes",
        kind="text",
        filename="model-backed-notes.txt",
        content=(
            b"Marshall uses a water cannon during rescues. "
            b"He helps Adventure Bay stay safe."
        ),
    )
    assembly = await catalog.start_assembly_line(
        workshop_id=workshop_id,
        material_source_ids=[material["id"]],
        chunk_size_tokens=128,
        chunk_overlap_tokens=0,
        qa_pairs_per_source=1,
    )
    qa_pairs = await catalog.list_qa_pairs(workshop_id, assembly["id"])
    assert qa_pairs and qa_pairs[0]["generatorModel"] == generator_model_id
    assert qa_pairs[0]["confidence"] == 0.93
    metadata = qa_pairs[0]["generationMetadata"]
    assert metadata["contractVersion"] == "foundry.qa-generation.v1"
    assert metadata["mode"] == "transformers"
    assert metadata["strategy"] == "model-json"
    assert metadata["prompt"]["templateVersion"] == "foundry.qa-prompt.source-context.v3"
    assert metadata["prompt"]["qualityTargets"]["groundedOnly"] is True
    assert "factual" in metadata["prompt"]["requestedQaTypes"]
    assert metadata["qaTypeGuidance"]
    assert metadata["qaType"] == "behavior"
    assert metadata["prompt"]["fingerprint"]
    assert metadata["source"]["chunkId"] == qa_pairs[0]["chunkId"]
    assert metadata["source"]["workshopSubject"] == "Foundry"
    assert metadata["source"]["voiceTarget"] == "Engineer"
    assert qa_pairs[0]["qualityGate"]["metrics"]["sourceOverlap"] > 0
    assert qa_pairs[0]["qualityGate"]["metrics"]["answerInSource"] is True
    assert qa_pairs[0]["qualityGate"]["metrics"]["hallucinationRisk"] is False
    assert qa_pairs[0]["qualityGate"]["metrics"]["qaTypeValid"] is True
    assert qa_pairs[0]["qualityGate"]["metrics"]["qaType"] == "behavior"
    assert captured_prompts
    assert (
        "Prompt template: foundry.qa-prompt.source-context.v3"
        in captured_prompts[0]["prompt"]
    )
    prompt_text = "\n".join(item["prompt"] for item in captured_prompts)
    assert "Workshop subject: Foundry" in prompt_text
    assert "Target voice/persona: Engineer" in prompt_text
    assert "QA type guidance:" in prompt_text
    assert "Quality checklist:" in prompt_text
    assert "Marshall uses a water cannon" in prompt_text
    assert any(item["localFilesOnly"] is True for item in captured_prompts)
    accepted = await catalog.update_qa_pair_review(
        workshop_id=workshop_id,
        qa_pair_id=qa_pairs[0]["id"],
        question=qa_pairs[0]["question"],
        answer=qa_pairs[0]["answer"],
        review_status="accepted",
    )
    assert accepted["qualityGate"]["status"] == "passed"
    preview = await catalog.preview_qa_pairs_export(
        workshop_id=workshop_id,
        assembly_line_run_id=assembly["id"],
    )
    assert preview["trainingReadiness"]["contractVersion"] == "foundry.qa-training-readiness.v1"
    assert preview["trainingReadiness"]["status"] == "ready"
    assert preview["trainingReadiness"]["forgeReady"] is True
    assert preview["trainingReadiness"]["defaultTrainingSafe"] is True
    assert preview["trainingReadiness"]["reviewedRows"] == 1
    assert preview["trainingReadiness"]["sourceReferencedRows"] == 1
    assert preview["trainingReadiness"]["qualityPassedRows"] == 1
    assert preview["trainingReadiness"]["qualityBlockedRows"] == 0
    assert preview["trainingReadiness"]["deterministicRows"] == 0
    assert preview["trainingReadiness"]["fallbackRows"] == 0
    assert preview["trainingReadiness"]["generatorModels"] == [generator_model_id]
    assert preview["trainingReadiness"]["generatorModes"] == ["transformers"]
    assert preview["trainingReadiness"]["promptVersions"] == ["foundry.qa-prompt.source-context.v3"]
    assert all(check["status"] == "pass" for check in preview["trainingReadiness"]["checks"])


async def exercise_workshop_cleanup(catalog: FoundryCatalogService) -> None:
    workshop = await catalog.create_workshop(
        name="Cleanup Target Workshop",
        subject="Cleanup",
        voice_target="Archivist",
        base_model="sshleifer/tiny-gpt2",
    )
    material = await catalog.import_material_file(
        workshop_id=workshop["id"],
        name="Cleanup Notes",
        kind="text",
        filename="cleanup-notes.txt",
        content=b"Cleanup notes should disappear with their Workshop.",
    )
    source_path = catalog_module.BASE_DIR / material["sourceUri"]
    assert source_path.exists()

    assembly = await catalog.start_assembly_line(
        workshop_id=workshop["id"],
        material_source_ids=[material["id"]],
        chunk_size_tokens=128,
        chunk_overlap_tokens=0,
        qa_pairs_per_source=1,
    )
    assert assembly["chunkCount"] == 1
    with catalog._connect() as connection:
        connection.execute(
            """
            INSERT INTO construct_runtime_validations (
                id, construct_id, artifact_id, model_id, device, status,
                total_tokens, duration_seconds, cleanup_status, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "val-cleanup-target",
                workshop["activeConstructId"],
                workshop["activeArtifactId"],
                "sshleifer/tiny-gpt2",
                "cpu",
                "passed",
                3,
                0.1,
                "ok",
                "{}",
            ),
        )

    try:
        await catalog.delete_workshop(
            workshop_id=workshop["id"],
            confirmation_name="Wrong Workshop",
        )
    except ValueError as error:
        assert "exact Workshop name" in str(error)
    else:
        raise AssertionError("Workshop deletion should require exact-name confirmation.")

    result = await catalog.delete_workshop(
        workshop_id=workshop["id"],
        confirmation_name=workshop["name"],
    )
    assert result["deletedWorkshopId"] == workshop["id"]
    assert result["deletedWorkshopName"] == workshop["name"]
    assert result["deletedCounts"]["workshops"] == 1
    assert result["deletedCounts"]["materials"] == 1
    assert result["deletedCounts"]["assemblyLineRuns"] == 1
    assert result["deletedCounts"]["materialChunks"] == 1
    assert result["deletedCounts"]["qaPairs"] >= 1
    assert result["deletedCounts"]["artifacts"] == 1
    assert result["deletedCounts"]["constructs"] == 1
    assert result["deletedCounts"]["constructRuntimeValidations"] == 1
    assert result["nextWorkshop"]["id"] != workshop["id"]
    assert not source_path.exists()
    remaining_ids = {item["id"] for item in await catalog.list_workshops()}
    assert workshop["id"] not in remaining_ids


async def exercise_workflow(tmp_path: Path) -> None:
    runtime_root = catalog_module.BASE_DIR / "runtime" / "test-workflow" / tmp_path.name
    catalog_module.DEFAULT_SOURCE_DIR = runtime_root / "sources"
    catalog_module.DEFAULT_EXPORT_DIR = runtime_root / "exports"
    forge_module.DEFAULT_FORGE_RUNTIME_DIR = runtime_root / "forges"
    qa_module.DEFAULT_QA_MODEL_ARCHIVE_DIR = runtime_root / "models" / "huggingface"

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
    assert qa_runtime["selection"]["contractVersion"] == "foundry.qa-generator.selection.v1"
    assert qa_runtime["selection"]["selectedTier"] == 0
    assert qa_runtime["platform"]["accelerator"] in {"cpu", "cuda", "mps"}
    configured_runtime = catalog.qa_generator.configure(
        mode="deterministic",
        model_id="sshleifer/tiny-gpt2",
        max_new_tokens=128,
        temperature=0.1,
    )
    assert configured_runtime["ready"] is True
    qa_preflight = catalog.qa_generator.preflight(
        mode="deterministic",
        model_id="sshleifer/tiny-gpt2",
        max_new_tokens=128,
        temperature=0.1,
    )
    assert qa_preflight["contractVersion"] == "foundry.qa-generator.preflight.v1"
    assert qa_preflight["status"] == "ready"
    assert qa_preflight["selection"]["tiers"][0]["provider"] == "deterministic"
    assert qa_preflight["selection"]["fallbackPolicy"]
    blocked_preflight = catalog.qa_generator.preflight(
        mode="transformers",
        model_id="missing-foundry-generator-model",
        max_new_tokens=96,
        temperature=0.0,
    )
    assert blocked_preflight["contractVersion"] == "foundry.qa-generator.preflight.v1"
    assert blocked_preflight["status"] == "blocked"
    assert blocked_preflight["selection"]["selectedTier"] == 0
    assert any(tier["tier"] == 1 for tier in blocked_preflight["selection"]["tiers"])
    assert any(check["id"] == "archive-cache" for check in blocked_preflight["checks"])
    revisioned_model_id = "hf-internal-testing/tiny-random-GPT2LMHeadModel"
    revisioned_model_dir = (
        qa_module.DEFAULT_QA_MODEL_ARCHIVE_DIR
        / f"{catalog.qa_generator._safe_archive_slug(revisioned_model_id)}-af80da83"
    )
    revisioned_model_dir.mkdir(parents=True, exist_ok=True)
    (revisioned_model_dir / "config.json").write_text("{}", encoding="utf-8")
    revisioned_preflight = catalog.qa_generator.preflight(
        mode="transformers",
        model_id=revisioned_model_id,
        max_new_tokens=96,
        temperature=0.0,
    )
    assert revisioned_preflight["model"]["cached"] is True
    assert revisioned_preflight["model"]["path"] == str(revisioned_model_dir)
    assert "pinned revision" in revisioned_preflight["model"]["message"]
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
    await exercise_website_material_snapshot(catalog, workshop["id"])
    await exercise_missing_material_source_blocks_assembly(catalog, workshop["id"])
    await exercise_model_backed_qa_generation(catalog, workshop["id"])
    catalog.qa_generator.configure(
        mode="deterministic",
        model_id="sshleifer/tiny-gpt2",
        max_new_tokens=128,
        temperature=0.1,
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
    chunk_metadata = chunks[0]["metadata"]
    assert chunk_metadata["contractVersion"] == "foundry.material-chunk.v1"
    assert chunk_metadata["source"]["materialId"] == material["id"]
    assert chunk_metadata["source"]["sourceTitle"]
    assert chunk_metadata["sourceLocation"]["chunkIndex"] == chunks[0]["chunkIndex"]
    assert chunk_metadata["sourceLocation"]["tokenStart"] == 0
    assert chunk_metadata["fingerprint"]
    assert qa_pairs and qa_pairs[0]["reviewStatus"] == "draft"
    assert qa_pairs[0]["generatorModel"] == "deterministic-context-generator"
    assert qa_pairs[0]["confidence"] > 0
    assert qa_pairs[0]["generationMetadata"]["contractVersion"] == "foundry.qa-generation.v1"
    assert qa_pairs[0]["generationMetadata"]["source"]["materialId"] == material["id"]
    assert qa_pairs[0]["generationMetadata"]["source"]["sourceTitle"]
    assert qa_pairs[0]["generationMetadata"]["source"]["sourceLocation"]["chunkIndex"] == 0
    assert qa_pairs[0]["sourceReference"]["sourceLocation"]["chunkIndex"] == 0
    assert qa_pairs[0]["qualityGate"]["status"] == "blocked"
    assert qa_pairs[0]["qualityGate"]["metrics"]["score"] > 0
    assert qa_pairs[0]["qualityGate"]["metrics"]["sourceOverlap"] > 0
    assert "trivialQuestion" in qa_pairs[0]["qualityGate"]["metrics"]
    assert "hallucinationRisk" in qa_pairs[0]["qualityGate"]["metrics"]

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

    preview = await catalog.preview_qa_pairs_export(
        workshop_id=workshop["id"],
        assembly_line_run_id=assembly["id"],
        include_low_quality=True,
    )
    assert preview["contractVersion"] == "foundry.qa-jsonl.preview.v1"
    assert preview["rowCount"] == 1
    assert preview["validation"]["forgeReady"] is True
    assert preview["validation"]["checks"]
    assert preview["sampleRows"][0]["source"]["sourceLocation"]["chunkIndex"] == 0
    assert preview["jsonlPreview"][0].startswith("{")
    assert preview["trainingReadiness"]["contractVersion"] == "foundry.qa-training-readiness.v1"
    assert preview["trainingReadiness"]["status"] == "caution"
    assert preview["trainingReadiness"]["forgeReady"] is True
    assert preview["trainingReadiness"]["defaultTrainingSafe"] is False
    assert preview["trainingReadiness"]["qualityBlockedRows"] == 1
    assert preview["trainingReadiness"]["deterministicRows"] == 1
    assert any(
        check["id"] == "generator-provenance" and check["status"] == "warn"
        for check in preview["trainingReadiness"]["checks"]
    )

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
    assert rows[0]["source"]["sourceTitle"]
    assert rows[0]["source"]["sourceLocation"]["chunkIndex"] == 0
    assert rows[0]["source"]["chunkFingerprint"]
    assert rows[0]["metadata"]["sourceReference"]["chunkMetadata"]["contractVersion"] == "foundry.material-chunk.v1"
    assert exported["qualityGate"]["status"] == "override"
    assert exported["trainingReadiness"]["status"] == "caution"
    assert exported["trainingReadiness"]["forgeReady"] is True
    assert exported["trainingReadiness"]["defaultTrainingSafe"] is False
    assert (
        exported["material"]["metadata"]["export"]["trainingReadiness"]["qualityBlockedRows"]
        == 1
    )

    exported_again = await catalog.export_qa_pairs_to_material(
        workshop_id=workshop["id"],
        assembly_line_run_id=assembly["id"],
        include_low_quality=True,
        name="Accepted Rows",
    )
    assert exported_again["material"]["id"] == exported["material"]["id"]
    assert exported_again["exportUri"] == exported["exportUri"]

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
    assert contract["datasetMetadata"]["export"]["trainingReadiness"]["status"] == "caution"
    assert state["validation"]["valid"] is True
    assert state["validation"]["rowCount"] == 1
    assert state["validation"]["qualityBlockedRows"] == 1
    assert state["validation"]["lowQualityOverrideRows"] == 1
    assert state["validation"]["warnings"]
    assert (forge_module.DEFAULT_FORGE_RUNTIME_DIR / forge_run["id"] / "contract.json").exists()
    readiness = forge.preflight_local_training(contract)
    assert readiness["ok"] is False
    assert readiness["proofMode"]["baselineSafe"] is True
    assert readiness["proofMode"]["downloadRequired"] is False
    assert readiness["proofMode"]["requiresCachedModel"] is True
    assert any(check["id"] == "runtime-mode" for check in readiness["checks"])
    assert any(check["id"] == "model-cache" for check in readiness["checks"])

    try:
        forge.execute_local_training(contract)
    except ValueError as error:
        assert "Local trainer preflight failed" in str(error)
    else:
        raise AssertionError("Local trainer should be gated behind local runtime mode.")

    cached_model_dir = forge_module.DEFAULT_FORGE_RUNTIME_DIR / "cached-model-proof"
    cached_model_dir.mkdir(parents=True, exist_ok=True)
    (cached_model_dir / "config.json").write_text("{}", encoding="utf-8")

    local_forge_run = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=exported["material"]["id"],
        base_model=str(cached_model_dir),
        method="LoRA",
        purpose="training",
        epochs=1,
        learning_rate="0.0002",
        load_in_4bit=False,
    )
    local_contract = forge.build_training_contract(
        forge_run=local_forge_run,
        material=exported["material"],
    )

    def fake_local_trainer(contract_payload, validation_payload):
        output_dir = catalog_module.BASE_DIR / contract_payload["outputDir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        adapter_file = output_dir / "adapter_model.safetensors"
        adapter_file.write_text("tiny local trainer proof\n", encoding="utf-8")
        result = {
            "adapterPath": str(output_dir.relative_to(catalog_module.BASE_DIR)),
            "baseModel": contract_payload["baseModel"],
            "device": "cpu",
            "loss": 0.1234,
            "rowsUsed": 1,
            "datasetRows": validation_payload["rowCount"],
            "targetModules": ["c_attn"],
            "createdAt": "2026-06-17T00:00:00+00:00",
        }
        forge._write_json(output_dir / "trainer-result.json", result)
        return result

    await forge.configure(mode="local")
    forge._missing_training_dependencies = lambda: []
    forge._training_memory_estimate = lambda _model_path: {
        "fitStatus": "fits",
        "checkStatus": "pass",
        "estimatedLoadBytes": 1024,
        "availableBytes": 4096,
        "message": "Tiny proof model fits the test budget.",
    }
    forge.set_local_trainer_backend(fake_local_trainer)
    local_readiness = forge.preflight_local_training(local_contract)
    assert local_readiness["ok"] is True
    assert local_readiness["proofMode"]["remoteDownloadAllowed"] is False
    local_state = forge.execute_local_training(local_contract)
    assert local_state["metrics"]["status"] == "completed"
    assert local_state["metrics"]["runtimeMode"] == "local"
    assert local_state["metrics"]["adapterPath"] == local_contract["outputDir"]
    assert any(event["type"] == "local_training_completed" for event in local_state["events"])

    local_completed = await catalog.complete_forge_from_worker(
        local_forge_run["id"],
        adapter_path=local_state["metrics"]["adapterPath"],
    )
    local_artifacts = await catalog.list_artifacts(workshop["id"])
    local_artifact = next(
        item for item in local_artifacts if item["id"] == local_completed["artifactId"]
    )
    assert local_completed["status"] == "completed"
    assert local_artifact["status"] == "ready"
    assert local_artifact["adapterPath"] == local_contract["outputDir"]
    assert local_artifact["readiness"]["status"] == "verified"
    assert local_artifact["readiness"]["canLoad"] is True
    assert local_artifact["readiness"]["artifactKind"] == "lora-adapter"
    assert local_artifact["readiness"]["compatibility"]["status"] in {"matched", "mismatch"}
    assert local_artifact["readiness"]["trainerResult"]["rowsUsed"] == 1
    assert "trainer-result.json" in local_artifact["readiness"]["presentFiles"]
    assert any(
        output_file["role"] == "adapter-weights"
        for output_file in local_artifact["readiness"]["outputFiles"]
    )
    assert (
        catalog_module.BASE_DIR / local_artifact["adapterPath"] / "trainer-result.json"
    ).exists()
    local_construct = await catalog.load_artifact_into_construct(
        workshop_id=workshop["id"],
        artifact_id=local_artifact["id"],
    )
    assert local_construct["artifactId"] == local_artifact["id"]

    missing_output_forge = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=exported["material"]["id"],
        base_model=str(cached_model_dir),
        method="LoRA",
        purpose="training",
        epochs=1,
        learning_rate="0.0002",
        load_in_4bit=False,
    )
    missing_output_path = f"runtime/artifacts/pending/{missing_output_forge['id']}"
    missing_completed = await catalog.complete_forge_from_worker(
        missing_output_forge["id"],
        adapter_path=missing_output_path,
    )
    missing_artifact = next(
        item
        for item in await catalog.list_artifacts(workshop["id"])
        if item["id"] == missing_completed["artifactId"]
    )
    assert missing_artifact["readiness"]["status"] == "blocked"
    assert missing_artifact["readiness"]["canLoad"] is False
    assert missing_artifact["readiness"]["artifactKind"] == "metadata-only"
    try:
        await catalog.load_artifact_into_construct(
            workshop_id=workshop["id"],
            artifact_id=missing_artifact["id"],
        )
    except ValueError as error:
        assert "missing adapter files" in str(error)
    else:
        raise AssertionError("Missing real Artifact output should block Construct load.")
    forge.set_local_trainer_backend(None)
    await forge.configure(mode="simulated")

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
    assert artifact["readiness"]["status"] == "simulated"
    assert artifact["readiness"]["canLoad"] is True
    assert artifact["readiness"]["artifactKind"] == "metadata-only"
    assert artifact["readiness"]["compatibility"]["status"] == "simulated"

    construct = await catalog.load_artifact_into_construct(
        workshop_id=workshop["id"],
        artifact_id=artifact["id"],
    )
    assert construct["artifactId"] == artifact["id"]
    assert construct["status"] == "warming"
    assert construct["streamingEnabled"] is True

    prompt = "What should a new engineer learn from this Forge?"
    system_prompt = "Answer as a careful Foundry mentor and cite uncertainty."
    chat = await catalog.chat_with_construct(
        construct_id=construct["id"],
        conversation_id="mvp-rehearsal",
        message=prompt,
        system_prompt=system_prompt,
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
    assert chat["generation"]["promptChain"]["contractVersion"] == "foundry.construct.prompt-chain.v1"
    assert chat["generation"]["promptChain"]["systemPrompt"] == system_prompt
    assert chat["generation"]["promptChain"]["userPrompt"] == prompt
    assert chat["trial"]["messageId"] == chat["message"]["id"]
    assert chat["trial"]["verdict"] == "needs-review"
    assert chat["trial"]["generationSettings"]["autoTrial"]["reviewRequired"] is True
    assert (
        chat["trial"]["generationSettings"]["promptChain"]["contractVersion"]
        == "foundry.construct.prompt-chain.v1"
    )
    unreviewed_trials = await catalog.list_trials(workshop["id"])
    assert len(unreviewed_trials) == 1
    assert unreviewed_trials[0]["id"] == chat["trial"]["id"]
    assert unreviewed_trials[0]["verdict"] == "needs-review"
    unreviewed_artifact = next(
        item for item in await catalog.list_artifacts(workshop["id"])
        if item["id"] == artifact["id"]
    )
    assert unreviewed_artifact["trialScore"] == 0
    try:
        await catalog.export_trials_to_material(
            workshop_id=workshop["id"],
            trial_ids=[chat["trial"]["id"]],
            verdicts=[],
            name="Unreviewed Trial Export",
        )
    except ValueError as error:
        assert "Review auto-captured Trials" in str(error)
    else:
        raise AssertionError("Unreviewed auto Trial export should be blocked.")

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
    assert trial["id"] == chat["trial"]["id"]
    assert trial["runtimeProfile"]["source"] == "simulated"
    assert trial["runtimeProfile"]["artifactKind"] == "metadata-only"
    assert trial["runtimeProfile"]["adapterLoaded"] is False

    trials = await catalog.list_trials(workshop["id"])
    assert len(trials) == 1
    assert trials[0]["id"] == trial["id"]
    assert trials[0]["runtimeProfile"]["source"] == "simulated"
    scored_artifact = next(
        item for item in await catalog.list_artifacts(workshop["id"])
        if item["id"] == artifact["id"]
    )
    assert scored_artifact["trialScore"] == 100

    trial_export = await catalog.export_trials_to_material(
        workshop_id=workshop["id"],
        trial_ids=[trial["id"]],
        verdicts=[],
        name="Reviewed Trial Evaluation Set",
    )
    assert trial_export["material"]["kind"] == "jsonl"
    assert trial_export["trialCount"] == 1

    evaluation_forge = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=trial_export["material"]["id"],
        base_model="sshleifer/tiny-gpt2",
        method="QLoRA",
        purpose="evaluation",
        epochs=3,
        learning_rate="0.0002",
        load_in_4bit=True,
    )
    evaluation_contract = forge.build_training_contract(
        forge_run=evaluation_forge,
        material=trial_export["material"],
    )
    evaluation_state = forge.initialize_contract(evaluation_contract)
    assert evaluation_state["validation"]["valid"] is True
    for _ in range(10):
        evaluation_forge = await catalog.advance_forge_simulation(evaluation_forge["id"])
        evaluation_metrics = forge.record_simulation_step(evaluation_forge)
        if evaluation_forge["status"] == "completed":
            break
    assert evaluation_forge["status"] == "completed"
    assert evaluation_metrics["lastEvent"] == "evaluation_completed"
    evaluation_report = evaluation_metrics["evaluationReport"]
    assert evaluation_report["reportVersion"] == "foundry.forge.evaluation.v1"
    assert evaluation_report["needsWorkCount"] == 1

    weak_sample = evaluation_report["samples"][0]
    weak_export = await catalog.export_evaluation_samples_to_material(
        forge_run=evaluation_forge,
        evaluation_report=evaluation_report,
        name="Corrective Weak Samples",
        reviewed_samples=[
            {
                "instruction": weak_sample["instruction"],
                "expected": weak_sample["expected"] + "\n\nCorrective note: keep the answer concise.",
                "observed": weak_sample["observed"],
                "verdict": weak_sample["verdict"],
                "note": "Reviewed for the corrective Forge loop.",
            }
        ],
    )
    assert weak_export["sampleCount"] == 1
    assert weak_export["material"]["status"] == "qa-ready"
    weak_metadata = weak_export["material"]["metadata"]["export"]
    assert weak_metadata["contractVersion"] == "foundry.evaluation.weak-sample-export.v1"
    assert weak_metadata["reviewed"] is True
    assert weak_metadata["trainingReadiness"]["forgeReady"] is True
    assert weak_metadata["trainingReadiness"]["defaultTrainingSafe"] is False
    weak_rows = [
        json.loads(line)
        for line in (catalog_module.BASE_DIR / weak_export["exportUri"]).read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    assert weak_rows[0]["metadata"]["format"] == "foundry.evaluation.weak-sample.v1"
    assert weak_rows[0]["metadata"]["reviewStatus"] == "edited"
    assert weak_rows[0]["source"]["forgeRunId"] == evaluation_forge["id"]

    corrective_forge = await catalog.start_forge(
        workshop_id=workshop["id"],
        material_id=weak_export["material"]["id"],
        base_model="sshleifer/tiny-gpt2",
        method="LoRA",
        purpose="training",
        epochs=1,
        learning_rate="0.0002",
        load_in_4bit=False,
    )
    corrective_contract = forge.build_training_contract(
        forge_run=corrective_forge,
        material=weak_export["material"],
    )
    corrective_state = forge.initialize_contract(corrective_contract)
    assert corrective_contract["datasetMetadata"]["export"]["source"] == "evaluation-report"
    assert corrective_state["validation"]["valid"] is True
    assert corrective_state["validation"]["rowCount"] == 1

    dashboard = await catalog.get_dashboard()
    assert "loopEvidence" in dashboard
    assert dashboard["loopEvidence"]["updatedAt"]

    evidence = await catalog.get_dashboard_evidence(workshop["id"])
    assert evidence["materialCount"] >= 2
    assert evidence["chunkCount"] >= 1
    assert evidence["qaPairCount"] >= 1
    assert evidence["acceptedQAPairCount"] >= 1
    assert evidence["jsonlMaterialCount"] >= 1
    assert evidence["completedForgeRunCount"] >= 1
    assert evidence["artifactCount"] >= 1
    assert evidence["readyArtifactCount"] >= 1
    assert evidence["trialCount"] == 1
    assert evidence["updatedAt"]
    await exercise_workshop_cleanup(catalog)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        asyncio.run(exercise_workflow(Path(tmp_dir)))
    print("OK: Foundry MVP workflow rehearsal passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
