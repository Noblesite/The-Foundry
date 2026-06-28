#!/usr/bin/env python3
"""Exercise the MVP workflow through FastAPI v1 contracts with isolated storage."""

from __future__ import annotations

import shutil
import sys
import tempfile
import warnings
import json
from io import BytesIO
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPO_ROOT / "EMA"
for path in (REPO_ROOT, PACKAGE_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

warnings.filterwarnings(
    "ignore",
    message="Using `httpx` with `starlette.testclient` is deprecated.*",
)

from fastapi.testclient import TestClient

from backend import api_server
from backend.services import forge_training_service as forge_module
from backend.services import foundry_catalog_service as catalog_module
from backend.services.construct_inference_service import ConstructInferenceService
from backend.services.forge_smoke_service import LocalForgeSmokeService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService
from backend.services.huggingface_model_service import HuggingFaceModelService


def sse_lines(response_text: str) -> list[str]:
    return [line.strip() for line in response_text.splitlines() if line.strip()]


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


def assert_response(response, expected_status: int = 200) -> dict[str, Any]:
    assert response.status_code == expected_status, response.text
    payload = response.json()
    assert "requestId" in payload
    return payload["data"]


def exercise_material_ingestion_formats(client: TestClient, workshop_id: str) -> None:
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
    material_ids = []
    for item in imports:
        material = assert_response(
            client.post(
                f"/api/v1/workshops/{workshop_id}/materials/import-file",
                params={
                    "name": item["name"],
                    "kind": item["kind"],
                    "filename": item["filename"],
                },
                content=item["content"],
            )
        )
        assert material["status"] == "staged"
        material_ids.append(material["id"])

    assembly = assert_response(
        client.post(
            f"/api/v1/workshops/{workshop_id}/assembly-lines",
            json={
                "materialSourceIds": material_ids,
                "chunkSizeTokens": 128,
                "chunkOverlapTokens": 0,
                "qaPairsPerSource": 1,
            },
        )
    )
    chunks = assert_response(
        client.get(
            f"/api/v1/workshops/{workshop_id}/chunks",
            params={"runId": assembly["id"]},
        )
    )
    chunk_text = "\n".join(chunk["text"] for chunk in chunks)
    for item in imports:
        assert item["expected"] in chunk_text


def exercise_workshop_delete_contract(client: TestClient) -> None:
    cleanup_workshop = assert_response(
        client.post(
            "/api/v1/workshops",
            json={
                "name": "API Cleanup Workshop",
                "subject": "Cleanup",
                "voiceTarget": "Archivist",
                "baseModel": "sshleifer/tiny-gpt2",
            },
        )
    )
    material = assert_response(
        client.post(
            f"/api/v1/workshops/{cleanup_workshop['id']}/materials/import-file",
            params={
                "name": "API Cleanup Notes",
                "kind": "text",
                "filename": "api-cleanup.txt",
            },
            content=b"API cleanup notes should be removed with their Workshop.",
        )
    )
    source_path = catalog_module.BASE_DIR / material["sourceUri"]
    assert source_path.exists()

    wrong_confirmation = client.request(
        "DELETE",
        f"/api/v1/workshops/{cleanup_workshop['id']}",
        json={"confirmationName": "Wrong Workshop"},
    )
    assert wrong_confirmation.status_code == 400
    assert "exact Workshop name" in wrong_confirmation.text

    result = assert_response(
        client.request(
            "DELETE",
            f"/api/v1/workshops/{cleanup_workshop['id']}",
            json={"confirmationName": cleanup_workshop["name"]},
        )
    )
    assert result["deletedWorkshopId"] == cleanup_workshop["id"]
    assert result["deletedCounts"]["workshops"] == 1
    assert result["deletedCounts"]["materials"] == 1
    assert result["nextWorkshop"]["id"] != cleanup_workshop["id"]
    assert not source_path.exists()


def exercise_website_material_snapshot(
    client: TestClient,
    catalog: FoundryCatalogService,
    workshop_id: str,
) -> None:
    original_validate = catalog._validate_website_url
    original_fetch = catalog._fetch_website_html
    try:
        catalog._validate_website_url = lambda source_url: source_url
        catalog._fetch_website_html = lambda _source_url: """
            <html>
              <head><title>Marshall Rescue Wiki</title></head>
              <body>
                <script>window.noisy = true;</script>
                <main>
                  <h1>Marshall Rescue Profile</h1>
                  <p>Marshall uses a water cannon during rescue practice.</p>
                  <p>He helps Adventure Bay with ladder safety.</p>
                </main>
              </body>
            </html>
        """
        preview = assert_response(
            client.post(
                f"/api/v1/workshops/{workshop_id}/materials/website-preview",
                json={"sourceUri": "https://example.test/marshall"},
            )
        )
        assert preview["contractVersion"] == "foundry.material.website-preview.v1"
        assert preview["sourceUrl"] == "https://example.test/marshall"
        assert preview["title"] == "Marshall Rescue Wiki"
        assert "Marshall uses a water cannon" in preview["textPreview"]

        material = assert_response(
            client.post(
                f"/api/v1/workshops/{workshop_id}/materials",
                json={
                    "name": "Marshall Wiki Snapshot",
                    "kind": "website",
                    "sourceUri": "https://example.test/marshall",
                },
            )
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
        assert "window.noisy" not in snapshot_text

        assembly = assert_response(
            client.post(
                f"/api/v1/workshops/{workshop_id}/assembly-lines",
                json={
                    "materialSourceIds": [material["id"]],
                    "chunkSizeTokens": 128,
                    "chunkOverlapTokens": 0,
                    "qaPairsPerSource": 1,
                },
            )
        )
        chunks = assert_response(
            client.get(
                f"/api/v1/workshops/{workshop_id}/chunks",
                params={"runId": assembly["id"]},
            )
        )
        chunk_text = "\n".join(chunk["text"] for chunk in chunks)
        assert "Marshall Rescue Profile" in chunk_text
        assert "ladder safety" in chunk_text
    finally:
        catalog._validate_website_url = original_validate
        catalog._fetch_website_html = original_fetch


def exercise_model_backed_qa_generation(
    client: TestClient,
    catalog: FoundryCatalogService,
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

    cached_generator_dir = catalog.db_path.parent / "cached-api-qa-generator"
    cached_generator_dir.mkdir(parents=True, exist_ok=True)
    (cached_generator_dir / "config.json").write_text("{}", encoding="utf-8")
    generator_model_id = str(cached_generator_dir)

    catalog.qa_generator.set_model_text_backend(tiny_model_backend)
    runtime = assert_response(
        client.post(
            "/api/v1/assembly-line/qa-generator/runtime/configure",
            json={
                "mode": "transformers",
                "modelId": generator_model_id,
                "maxNewTokens": 96,
                "temperature": 0.0,
            },
        )
    )
    assert runtime["mode"] == "transformers"
    preflight = assert_response(
        client.post(
            "/api/v1/assembly-line/qa-generator/preflight",
            json={
                "mode": "transformers",
                "modelId": generator_model_id,
                "maxNewTokens": 96,
                "temperature": 0.0,
            },
        )
    )
    assert preflight["status"] == "ready"
    assert preflight["model"]["cached"] is True
    quality_proof = assert_response(
        client.post("/api/v1/assembly-line/qa-generator/quality-proof")
    )
    assert quality_proof["proofMode"]["source"] == "backend"
    assert quality_proof["proofMode"]["modelId"] == generator_model_id
    assert quality_proof["proofMode"]["localFilesOnly"] is True
    assert quality_proof["proofMode"]["simulated"] is False
    assert quality_proof["proofMode"]["modelCached"] is True
    model_proof = next(
        result for result in quality_proof["results"] if result["label"] == "Cached local model"
    )
    assert model_proof["status"] == "passed"
    assert model_proof["proofSource"] == "backend-local-model"
    assert model_proof["localFilesOnly"] is True
    assert model_proof["preflightStatus"] == "ready"

    workshop = assert_response(
        client.post(
            "/api/v1/workshops",
            json={
                "name": "Model Backed API Workshop",
                "subject": "Foundry",
                "voiceTarget": "Engineer",
                "baseModel": generator_model_id,
            },
        )
    )
    material = assert_response(
        client.post(
            f"/api/v1/workshops/{workshop['id']}/materials/import-file",
            params={
                "name": "Model Backed Notes",
                "kind": "text",
                "filename": "model-backed-notes.txt",
            },
            content=(
                b"Marshall uses a water cannon during rescues. "
                b"He helps Adventure Bay stay safe."
            ),
        )
    )
    assembly = assert_response(
        client.post(
            f"/api/v1/workshops/{workshop['id']}/assembly-lines",
            json={
                "materialSourceIds": [material["id"]],
                "chunkSizeTokens": 128,
                "chunkOverlapTokens": 0,
                "qaPairsPerSource": 1,
            },
        )
    )
    qa_pairs = assert_response(
        client.get(
            f"/api/v1/workshops/{workshop['id']}/qa-pairs",
            params={"runId": assembly["id"]},
        )
    )
    assert qa_pairs and qa_pairs[0]["generatorModel"] == generator_model_id
    assert qa_pairs[0]["confidence"] == 0.93
    metadata = qa_pairs[0]["generationMetadata"]
    assert metadata["mode"] == "transformers"
    assert metadata["strategy"] == "model-json"
    assert metadata["prompt"]["templateVersion"] == "foundry.qa-prompt.source-context.v3"
    assert metadata["prompt"]["qualityTargets"]["groundedOnly"] is True
    assert "factual" in metadata["prompt"]["requestedQaTypes"]
    assert metadata["qaTypeGuidance"]
    assert metadata["qaType"] == "behavior"
    assert metadata["source"]["workshopSubject"] == "Foundry"
    assert metadata["source"]["voiceTarget"] == "Engineer"
    assert qa_pairs[0]["qualityGate"]["metrics"]["sourceOverlap"] > 0
    assert qa_pairs[0]["qualityGate"]["metrics"]["answerInSource"] is True
    assert qa_pairs[0]["qualityGate"]["metrics"]["hallucinationRisk"] is False
    assert qa_pairs[0]["qualityGate"]["metrics"]["qaTypeValid"] is True
    assert qa_pairs[0]["qualityGate"]["metrics"]["qaType"] == "behavior"
    assert captured_prompts
    prompt_text = "\n".join(item["prompt"] for item in captured_prompts)
    assert "Workshop subject: Foundry" in prompt_text
    assert "Target voice/persona: Engineer" in prompt_text
    assert "QA type guidance:" in prompt_text
    assert "Quality checklist:" in prompt_text
    assert "Marshall uses a water cannon" in prompt_text
    accepted = assert_response(
        client.patch(
            f"/api/v1/workshops/{workshop['id']}/qa-pairs/{qa_pairs[0]['id']}",
            json={
                "question": qa_pairs[0]["question"],
                "answer": qa_pairs[0]["answer"],
                "reviewStatus": "accepted",
            },
        )
    )
    assert accepted["qualityGate"]["status"] == "passed"
    preview = assert_response(
        client.post(
            f"/api/v1/workshops/{workshop['id']}/qa-pairs/export/preview",
            json={
                "assemblyLineRunId": assembly["id"],
                "name": "Model Backed Rows",
                "includeLowQuality": False,
            },
        )
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
    assert any(item["localFilesOnly"] is True for item in captured_prompts)


def run_api_workflow(tmp_path: Path) -> None:
    runtime_root = catalog_module.BASE_DIR / "runtime" / "test-api-workflow" / tmp_path.name
    original_source_dir = catalog_module.DEFAULT_SOURCE_DIR
    original_export_dir = catalog_module.DEFAULT_EXPORT_DIR
    original_forge_dir = forge_module.DEFAULT_FORGE_RUNTIME_DIR
    original_catalog_service = api_server.foundry_catalog_service
    original_forge_service = api_server.forge_training_service
    original_huggingface_service = api_server.huggingface_model_service
    original_smoke_service = api_server.local_forge_smoke_service
    original_construct_service = api_server.construct_inference_service

    catalog_module.DEFAULT_SOURCE_DIR = runtime_root / "sources"
    catalog_module.DEFAULT_EXPORT_DIR = runtime_root / "exports"
    forge_module.DEFAULT_FORGE_RUNTIME_DIR = runtime_root / "forges"

    isolated_catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    isolated_forge = ForgeTrainingService()
    isolated_construct = ConstructInferenceService()
    isolated_construct.runtime_event_db_path = tmp_path / "construct-runtime-events.db"
    isolated_construct._runtime_events = []
    isolated_construct._initialize_runtime_event_store()
    api_server.foundry_catalog_service = isolated_catalog
    api_server.forge_training_service = isolated_forge
    api_server.construct_inference_service = isolated_construct
    api_server.huggingface_model_service = HuggingFaceModelService(isolated_catalog)
    api_server.local_forge_smoke_service = LocalForgeSmokeService(
        isolated_catalog,
        isolated_forge,
    )

    try:
        with TestClient(api_server.app) as client:
            exercise_model_backed_qa_generation(client, isolated_catalog)

            runtime = assert_response(
                client.post(
                    "/api/v1/assembly-line/qa-generator/runtime/configure",
                    json={
                        "mode": "deterministic",
                        "modelId": "sshleifer/tiny-gpt2",
                        "maxNewTokens": 128,
                        "temperature": 0.1,
                    },
                )
            )
            assert runtime["ready"] is True
            qa_preflight = assert_response(
                client.post(
                    "/api/v1/assembly-line/qa-generator/preflight",
                    json={
                        "mode": "deterministic",
                        "modelId": "sshleifer/tiny-gpt2",
                        "maxNewTokens": 128,
                        "temperature": 0.1,
                    },
                )
            )
            assert qa_preflight["contractVersion"] == "foundry.qa-generator.preflight.v1"
            assert qa_preflight["status"] == "ready"
            assert qa_preflight["selection"]["contractVersion"] == "foundry.qa-generator.selection.v1"
            assert qa_preflight["selection"]["selectedTier"] == 0
            assert qa_preflight["platform"]["accelerator"] in {"cpu", "cuda", "mps"}

            workshop = assert_response(
                client.post(
                    "/api/v1/workshops",
                    json={
                        "name": "MVP API Workshop",
                        "subject": "Foundry",
                        "voiceTarget": "Engineer",
                        "baseModel": "sshleifer/tiny-gpt2",
                    },
                )
            )
            exercise_material_ingestion_formats(client, workshop["id"])
            exercise_website_material_snapshot(client, isolated_catalog, workshop["id"])

            material = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/materials/import-file",
                    params={
                        "name": "Local Notes",
                        "kind": "text",
                        "filename": "notes.txt",
                    },
                    content=(
                        b"Marshall helps the team during rescues. "
                        b"Rubble brings tools when repairs are needed."
                    ),
                )
            )
            assert material["status"] == "staged"

            assembly = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/assembly-lines",
                    json={
                        "materialSourceIds": [material["id"]],
                        "chunkSizeTokens": 128,
                        "chunkOverlapTokens": 0,
                        "qaPairsPerSource": 1,
                    },
                )
            )

            chunks = assert_response(
                client.get(
                    f"/api/v1/workshops/{workshop['id']}/chunks",
                    params={"runId": assembly["id"]},
                )
            )
            assert chunks and "Marshall helps the team" in chunks[0]["text"]
            assert chunks[0]["metadata"]["contractVersion"] == "foundry.material-chunk.v1"
            assert chunks[0]["metadata"]["source"]["materialId"] == material["id"]
            assert chunks[0]["metadata"]["sourceLocation"]["chunkIndex"] == chunks[0]["chunkIndex"]

            qa_pairs = assert_response(
                client.get(
                    f"/api/v1/workshops/{workshop['id']}/qa-pairs",
                    params={"runId": assembly["id"]},
                )
            )
            assert qa_pairs and qa_pairs[0]["reviewStatus"] == "draft"
            assert qa_pairs[0]["qualityGate"]["status"] == "blocked"
            assert "trivialQuestion" in qa_pairs[0]["qualityGate"]["metrics"]
            assert "hallucinationRisk" in qa_pairs[0]["qualityGate"]["metrics"]
            assert qa_pairs[0]["generationMetadata"]["source"]["materialId"] == material["id"]
            assert qa_pairs[0]["sourceReference"]["sourceLocation"]["chunkIndex"] == 0

            accepted = assert_response(
                client.patch(
                    f"/api/v1/workshops/{workshop['id']}/qa-pairs/{qa_pairs[0]['id']}",
                    json={
                        "question": qa_pairs[0]["question"] + " Reviewed?",
                        "answer": qa_pairs[0]["answer"] + " Reviewed.",
                        "reviewStatus": "accepted",
                    },
                )
            )
            assert accepted["reviewStatus"] == "accepted"

            preview = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/qa-pairs/export/preview",
                    json={
                        "assemblyLineRunId": assembly["id"],
                        "name": "Accepted Rows",
                        "includeLowQuality": True,
                    },
                )
            )
            assert preview["contractVersion"] == "foundry.qa-jsonl.preview.v1"
            assert preview["rowCount"] == 1
            assert preview["validation"]["forgeReady"] is True
            assert preview["sampleRows"][0]["source"]["sourceLocation"]["chunkIndex"] == 0
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

            exported = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/qa-pairs/export",
                    json={
                        "assemblyLineRunId": assembly["id"],
                        "name": "Accepted Rows",
                        "includeLowQuality": True,
                    },
                )
            )
            assert exported["format"] == "jsonl"
            assert exported["qualityGate"]["status"] == "override"
            assert exported["trainingReadiness"]["status"] == "caution"
            assert exported["trainingReadiness"]["forgeReady"] is True
            assert exported["trainingReadiness"]["defaultTrainingSafe"] is False
            exported_path = catalog_module.BASE_DIR / exported["exportUri"]
            exported_rows = [
                json.loads(line)
                for line in exported_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            assert exported_rows[0]["source"]["sourceLocation"]["chunkIndex"] == 0
            assert exported_rows[0]["metadata"]["sourceReference"]["chunkMetadata"]["fingerprint"]

            forge = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/forges",
                    json={
                        "materialSetId": exported["material"]["id"],
                        "baseModel": "sshleifer/tiny-gpt2",
                        "method": "LoRA",
                        "purpose": "training",
                        "epochs": 1,
                        "learningRate": "0.0002",
                        "loadIn4Bit": False,
                    },
                )
            )
            assert forge["trainingContract"]["contractVersion"] == "foundry.forge.training.v1"
            assert forge["workerState"]["validation"]["valid"] is True

            preflight = assert_response(
                client.post(f"/api/v1/forges/{forge['id']}/worker/preflight-local")
            )
            assert preflight["ok"] is False
            assert any(check["id"] == "runtime-mode" for check in preflight["checks"])

            cached_model_dir = forge_module.DEFAULT_FORGE_RUNTIME_DIR / "cached-model-proof"
            cached_model_dir.mkdir(parents=True, exist_ok=True)
            (cached_model_dir / "config.json").write_text("{}", encoding="utf-8")

            local_forge = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/forges",
                    json={
                        "materialSetId": exported["material"]["id"],
                        "baseModel": str(cached_model_dir),
                        "method": "LoRA",
                        "purpose": "training",
                        "epochs": 1,
                        "learningRate": "0.0002",
                        "loadIn4Bit": False,
                    },
                )
            )

            def fake_local_trainer(contract_payload, validation_payload):
                output_dir = catalog_module.BASE_DIR / contract_payload["outputDir"]
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / "adapter_model.safetensors").write_text(
                    "tiny local trainer proof\n",
                    encoding="utf-8",
                )
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
                isolated_forge._write_json(output_dir / "trainer-result.json", result)
                return result

            isolated_forge.mode = "local"
            isolated_forge._missing_training_dependencies = lambda: []
            isolated_forge._training_memory_estimate = lambda _model_path: {
                "fitStatus": "fits",
                "checkStatus": "pass",
                "estimatedLoadBytes": 1024,
                "availableBytes": 4096,
                "message": "Tiny proof model fits the test budget.",
            }
            isolated_forge.set_local_trainer_backend(fake_local_trainer)
            local_state = assert_response(
                client.post(f"/api/v1/forges/{local_forge['id']}/worker/run-local")
            )
            assert local_state["metrics"]["status"] == "completed"
            assert local_state["metrics"]["runtimeMode"] == "local"
            assert local_state["forgeRun"]["status"] == "completed"
            local_artifacts = assert_response(
                client.get(f"/api/v1/workshops/{workshop['id']}/artifacts")
            )
            local_artifact = next(
                item
                for item in local_artifacts
                if item["id"] == local_state["forgeRun"]["artifactId"]
            )
            assert local_artifact["adapterPath"] == local_state["metrics"]["adapterPath"]
            assert local_artifact["readiness"]["status"] == "verified"
            assert local_artifact["readiness"]["canLoad"] is True
            assert local_artifact["readiness"]["artifactKind"] == "lora-adapter"
            assert local_artifact["readiness"]["trainerResult"]["rowsUsed"] == 1
            assert local_artifact["readiness"]["compatibility"]["status"] in {"matched", "mismatch"}
            assert "trainer-result.json" in local_artifact["readiness"]["presentFiles"]
            assert any(
                output_file["role"] == "adapter-weights"
                for output_file in local_artifact["readiness"]["outputFiles"]
            )
            assert (
                catalog_module.BASE_DIR / local_artifact["adapterPath"] / "trainer-result.json"
            ).exists()
            local_construct = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/constructs/load-artifact",
                    json={"artifactId": local_artifact["id"]},
                )
            )
            assert local_construct["artifactId"] == local_artifact["id"]

            load_calls = []

            class FakeParameter:
                device = "cpu"

            class FakeConstructModel:
                def parameters(self):
                    return iter([FakeParameter()])

            def fake_construct_loader(model_name: str, adapter_path: str | None = None):
                load_calls.append({"modelName": model_name, "adapterPath": adapter_path})
                return object(), FakeConstructModel()

            isolated_construct._load_transformers_model_sync = fake_construct_loader
            adapter_runtime = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/configure",
                    json={
                        "mode": "transformers",
                        "modelId": local_artifact["baseModel"],
                        "device": "cpu",
                    },
                )
            )
            assert adapter_runtime["mode"] == "transformers"
            loaded_adapter_runtime = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/load",
                    json={
                        "modelId": local_artifact["baseModel"],
                        "adapterPath": local_artifact["adapterPath"],
                        "artifactId": local_artifact["id"],
                    },
                )
            )
            assert load_calls[-1]["adapterPath"].endswith(local_artifact["adapterPath"])
            assert loaded_adapter_runtime["status"] == "loaded"
            assert loaded_adapter_runtime["diagnostics"]["loadedModel"]["adapterLoaded"] is True
            assert (
                loaded_adapter_runtime["diagnostics"]["loadedModel"]["artifactId"]
                == local_artifact["id"]
            )

            async def preflight_construct_stub(model_id: str, device: str):
                if model_id == str(cached_model_dir):
                    return {
                        "ok": True,
                        "modelId": model_id,
                        "device": device,
                        "localFilesOnly": True,
                        "modelType": "gpt2",
                        "architectures": ["GPT2LMHeadModel"],
                        "contextWindow": 1024,
                        "parameterCountEstimate": 125000,
                        "estimatedLoadBytes": 1024,
                        "availableBytes": 4096,
                        "fitStatus": "fits",
                        "checks": [
                            {
                                "id": "archive-cache",
                                "label": "Archive cache",
                                "status": "pass",
                                "detail": "Cached tiny model is available.",
                            }
                        ],
                        "warnings": [],
                        "diagnostics": {},
                    }
                return {
                    "ok": False,
                    "modelId": model_id,
                    "device": device,
                    "localFilesOnly": True,
                    "modelType": None,
                    "architectures": [],
                    "contextWindow": None,
                    "parameterCountEstimate": None,
                    "estimatedLoadBytes": 0,
                    "availableBytes": 4096,
                    "fitStatus": "unknown",
                    "checks": [
                        {
                            "id": "archive-cache",
                            "label": "Archive cache",
                            "status": "fail",
                            "detail": "Model is not cached.",
                        }
                    ],
                    "warnings": ["Cache the model before Construct load."],
                    "diagnostics": {},
                }

            isolated_construct.preflight_model = preflight_construct_stub
            readiness_gate = assert_response(
                client.post(
                    "/api/v1/foundry/readiness",
                    json={
                        "constructModelId": str(cached_model_dir),
                        "constructDevice": "cpu",
                        "forgeRunId": local_forge["id"],
                    },
                )
            )
            assert readiness_gate["contractVersion"] == "foundry.readiness-gate.v1"
            assert readiness_gate["status"] == "ready"
            assert readiness_gate["canProceed"] is True
            assert {station["id"] for station in readiness_gate["stations"]} == {
                "construct-load",
                "forge-start",
            }

            stream_tokens = ["Marshall", " is", " ready", "."]
            isolated_construct.set_transformers_stream_backend(
                lambda _prepared, _message, _system_prompt: stream_tokens
            )
            configured_construct_runtime = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/configure",
                    json={
                        "mode": "transformers",
                        "modelId": str(cached_model_dir),
                        "device": "cpu",
                    },
                )
            )
            assert configured_construct_runtime["mode"] == "transformers"
            streamed = client.post(
                f"/api/v1/constructs/{local_construct['id']}/chat/stream",
                json={
                    "conversationId": "mvp-api-real-stream",
                    "message": "Respond as the trained character.",
                    "includeLibraryContext": False,
                    "maxNewTokens": 16,
                    "temperature": 0.0,
                },
            )
            assert streamed.status_code == 200, streamed.text
            lines = sse_lines(streamed.text)
            assert any(line.startswith("event: token") for line in lines)
            assert any('"token": "Marshall"' in line for line in lines)
            assert any(line.startswith("event: done") for line in lines)
            assert '"mode": "transformers"' in streamed.text
            assert '"status": "loaded"' in streamed.text
            assert '"verdict": "needs-review"' in streamed.text

            isolated_construct.set_transformers_stream_backend(None)
            assert_response(
                client.post(
                    "/api/v1/constructs/runtime/configure",
                    json={
                        "mode": "transformers",
                        "modelId": "missing-local-construct-model",
                        "device": "cpu",
                    },
                )
            )
            blocked_readiness_gate = assert_response(
                client.post(
                    "/api/v1/foundry/readiness",
                    json={
                        "constructModelId": "missing-local-construct-model",
                        "constructDevice": "cpu",
                        "forgeRunId": local_forge["id"],
                    },
                )
            )
            assert blocked_readiness_gate["status"] == "blocked"
            assert blocked_readiness_gate["canProceed"] is False
            assert any(
                station["id"] == "construct-load" and station["status"] == "blocked"
                for station in blocked_readiness_gate["stations"]
            )
            failed_stream = client.post(
                f"/api/v1/constructs/{local_construct['id']}/chat/stream",
                json={
                    "conversationId": "mvp-api-real-stream-failure",
                    "message": "This should fail loudly.",
                    "includeLibraryContext": False,
                    "maxNewTokens": 16,
                    "temperature": 0.0,
                },
            )
            assert failed_stream.status_code == 200, failed_stream.text
            failed_lines = sse_lines(failed_stream.text)
            assert any(line.startswith("event: error") for line in failed_lines)
            assert "could not start" in failed_stream.text
            assert "fell back to the simulator" not in failed_stream.text
            isolated_construct.set_transformers_stream_backend(None)
            assert_response(
                client.post(
                    "/api/v1/constructs/runtime/configure",
                    json={"mode": "simulated", "modelId": "", "device": "auto"},
                )
            )
            isolated_forge.set_local_trainer_backend(None)
            isolated_forge.mode = "simulated"

            completed_forge = forge
            for _ in range(10):
                completed_forge = assert_response(
                    client.post(f"/api/v1/forges/{forge['id']}/simulate")
                )
                if completed_forge["status"] == "completed":
                    break

            assert completed_forge["status"] == "completed"
            assert completed_forge["progress"] == 100
            assert completed_forge["artifactId"]
            assert completed_forge["workerState"]["metrics"]["status"] == "completed"

            artifacts = assert_response(
                client.get(f"/api/v1/workshops/{workshop['id']}/artifacts")
            )
            artifact = next(
                item for item in artifacts if item["id"] == completed_forge["artifactId"]
            )
            assert artifact["status"] == "ready"
            assert artifact["forgeRunId"] == forge["id"]
            assert artifact["readiness"]["status"] == "simulated"
            assert artifact["readiness"]["canLoad"] is True
            assert artifact["readiness"]["artifactKind"] == "metadata-only"
            assert artifact["readiness"]["compatibility"]["status"] == "simulated"

            construct = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/constructs/load-artifact",
                    json={"artifactId": artifact["id"]},
                )
            )
            assert construct["artifactId"] == artifact["id"]

            prompt = "What should a new engineer learn from this Forge?"
            chat = assert_response(
                client.post(
                    f"/api/v1/constructs/{construct['id']}/chat",
                    json={
                        "conversationId": "mvp-api-rehearsal",
                        "message": prompt,
                        "includeLibraryContext": False,
                        "maxNewTokens": 64,
                        "temperature": 0.2,
                    },
                )
            )
            assert chat["artifact"]["id"] == artifact["id"]
            assert "Simulated response" in chat["message"]["text"]
            assert chat["trial"]["messageId"] == chat["message"]["id"]
            assert chat["trial"]["verdict"] == "needs-review"
            assert chat["trial"]["generationSettings"]["autoTrial"]["reviewRequired"] is True
            unreviewed_trials = assert_response(
                client.get(f"/api/v1/workshops/{workshop['id']}/trials")
            )
            assert any(item["id"] == chat["trial"]["id"] for item in unreviewed_trials)
            unreviewed_export = client.post(
                f"/api/v1/workshops/{workshop['id']}/trials/export",
                json={
                    "trialIds": [chat["trial"]["id"]],
                    "verdicts": [],
                    "name": "Unreviewed Trial Export",
                },
            )
            assert unreviewed_export.status_code == 404
            assert "Review auto-captured Trials" in unreviewed_export.text

            trial = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/trials",
                    json={
                        "artifactId": artifact["id"],
                        "constructId": construct["id"],
                        "messageId": chat["message"]["id"],
                        "prompt": prompt,
                        "response": chat["message"]["text"],
                        "verdict": "pass",
                        "runtimeMode": "simulated",
                        "tokenCount": chat["message"]["tokenCount"],
                        "generationSettings": chat["generation"],
                    },
                )
            )
            assert trial["runtimeMode"] == "simulated"
            assert trial["verdict"] == "pass"
            assert trial["id"] == chat["trial"]["id"]
            assert trial["runtimeProfile"]["source"] == "simulated"
            assert trial["runtimeProfile"]["artifactKind"] == "metadata-only"
            assert trial["runtimeProfile"]["adapterLoaded"] is False

            trials = assert_response(client.get(f"/api/v1/workshops/{workshop['id']}/trials"))
            reviewed_trial = next(item for item in trials if item["id"] == trial["id"])
            assert reviewed_trial["verdict"] == "pass"
            assert reviewed_trial["runtimeProfile"]["source"] == "simulated"

            scored_artifact = next(
                item
                for item in assert_response(
                    client.get(f"/api/v1/workshops/{workshop['id']}/artifacts")
                )
                if item["id"] == artifact["id"]
            )
            assert scored_artifact["trialScore"] == 100

            trial_export = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/trials/export",
                    json={
                        "trialIds": [trial["id"]],
                        "verdicts": [],
                        "name": "Reviewed Trial Evaluation Set",
                    },
                )
            )
            assert trial_export["material"]["kind"] == "jsonl"
            assert trial_export["trialCount"] == 1

            evaluation_forge = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/forges",
                    json={
                        "materialSetId": trial_export["material"]["id"],
                        "baseModel": "sshleifer/tiny-gpt2",
                        "method": "QLoRA",
                        "purpose": "evaluation",
                        "epochs": 3,
                        "learningRate": "0.0002",
                        "loadIn4Bit": True,
                    },
                )
            )
            assert evaluation_forge["purpose"] == "evaluation"
            assert evaluation_forge["workerState"]["validation"]["valid"] is True
            for _ in range(10):
                evaluation_forge = assert_response(
                    client.post(f"/api/v1/forges/{evaluation_forge['id']}/simulate")
                )
                if evaluation_forge["status"] == "completed":
                    break
            assert evaluation_forge["status"] == "completed"
            evaluation_report = evaluation_forge["workerState"]["metrics"]["evaluationReport"]
            assert evaluation_report["reportVersion"] == "foundry.forge.evaluation.v1"
            assert evaluation_report["needsWorkCount"] == 1

            weak_sample = evaluation_report["samples"][0]
            weak_export = assert_response(
                client.post(
                    f"/api/v1/forges/{evaluation_forge['id']}/evaluation/weak-samples/export",
                    json={
                        "name": "Corrective Weak Samples",
                        "samples": [
                            {
                                "instruction": weak_sample["instruction"],
                                "expected": (
                                    weak_sample["expected"]
                                    + "\n\nCorrective note: keep the answer concise."
                                ),
                                "observed": weak_sample["observed"],
                                "verdict": weak_sample["verdict"],
                                "note": "Reviewed for the corrective Forge loop.",
                            }
                        ],
                    },
                )
            )
            assert weak_export["sampleCount"] == 1
            assert weak_export["material"]["status"] == "qa-ready"
            weak_metadata = weak_export["material"]["metadata"]["export"]
            assert weak_metadata["source"] == "evaluation-report"
            assert weak_metadata["reviewed"] is True
            assert weak_metadata["trainingReadiness"]["forgeReady"] is True
            assert weak_metadata["trainingReadiness"]["defaultTrainingSafe"] is False

            corrective_forge = assert_response(
                client.post(
                    f"/api/v1/workshops/{workshop['id']}/forges",
                    json={
                        "materialSetId": weak_export["material"]["id"],
                        "baseModel": "sshleifer/tiny-gpt2",
                        "method": "LoRA",
                        "purpose": "training",
                        "epochs": 1,
                        "learningRate": "0.0002",
                        "loadIn4Bit": False,
                    },
                )
            )
            assert corrective_forge["purpose"] == "training"
            assert corrective_forge["workerState"]["validation"]["valid"] is True
            assert (
                corrective_forge["trainingContract"]["datasetMetadata"]["export"]["source"]
                == "evaluation-report"
            )

            dashboard = assert_response(client.get("/api/v1/foundry/dashboard"))
            assert "loopEvidence" in dashboard
            assert dashboard["loopEvidence"]["updatedAt"]

            evidence = assert_response(
                client.get(f"/api/v1/workshops/{workshop['id']}/dashboard/evidence")
            )
            assert evidence["materialCount"] >= 2
            assert evidence["chunkCount"] >= 1
            assert evidence["qaPairCount"] >= 1
            assert evidence["acceptedQAPairCount"] >= 1
            assert evidence["jsonlMaterialCount"] >= 1
            assert evidence["completedForgeRunCount"] >= 1
            assert evidence["artifactCount"] >= 1
            assert evidence["readyArtifactCount"] >= 1
            assert evidence["trialCount"] >= 1
            assert evidence["updatedAt"]

            bootstrap = assert_response(client.get("/api/v1/foundry/bootstrap"))
            assert bootstrap["dashboard"]["loopEvidence"]["updatedAt"]
            exercise_workshop_delete_contract(client)
    finally:
        api_server.foundry_catalog_service = original_catalog_service
        api_server.forge_training_service = original_forge_service
        api_server.huggingface_model_service = original_huggingface_service
        api_server.local_forge_smoke_service = original_smoke_service
        api_server.construct_inference_service = original_construct_service
        catalog_module.DEFAULT_SOURCE_DIR = original_source_dir
        catalog_module.DEFAULT_EXPORT_DIR = original_export_dir
        forge_module.DEFAULT_FORGE_RUNTIME_DIR = original_forge_dir
        shutil.rmtree(runtime_root, ignore_errors=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        run_api_workflow(Path(tmp_dir))
    print("OK: Foundry API MVP workflow rehearsal passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
