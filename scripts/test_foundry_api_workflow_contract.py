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
                }
            ]
        )

    catalog.qa_generator.set_model_text_backend(tiny_model_backend)
    runtime = assert_response(
        client.post(
            "/api/v1/assembly-line/qa-generator/runtime/configure",
            json={
                "mode": "transformers",
                "modelId": "sshleifer/tiny-gpt2",
                "maxNewTokens": 96,
                "temperature": 0.0,
            },
        )
    )
    assert runtime["mode"] == "transformers"

    workshop = assert_response(
        client.post(
            "/api/v1/workshops",
            json={
                "name": "Model Backed API Workshop",
                "subject": "Foundry",
                "voiceTarget": "Engineer",
                "baseModel": "sshleifer/tiny-gpt2",
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
    assert qa_pairs and qa_pairs[0]["generatorModel"] == "sshleifer/tiny-gpt2"
    assert qa_pairs[0]["confidence"] == 0.93
    metadata = qa_pairs[0]["generationMetadata"]
    assert metadata["mode"] == "transformers"
    assert metadata["strategy"] == "model-json"
    assert metadata["prompt"]["templateVersion"] == "foundry.qa-prompt.source-context.v1"
    assert qa_pairs[0]["qualityGate"]["metrics"]["sourceOverlap"] > 0
    assert captured_prompts
    assert "Marshall uses a water cannon" in captured_prompts[0]["prompt"]


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

            qa_pairs = assert_response(
                client.get(
                    f"/api/v1/workshops/{workshop['id']}/qa-pairs",
                    params={"runId": assembly["id"]},
                )
            )
            assert qa_pairs and qa_pairs[0]["reviewStatus"] == "draft"
            assert qa_pairs[0]["qualityGate"]["status"] == "blocked"

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
            assert "trainer-result.json" in local_artifact["readiness"]["presentFiles"]
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

            trials = assert_response(client.get(f"/api/v1/workshops/{workshop['id']}/trials"))
            assert len(trials) == 1
            assert trials[0]["id"] == trial["id"]

            scored_artifact = next(
                item
                for item in assert_response(
                    client.get(f"/api/v1/workshops/{workshop['id']}/artifacts")
                )
                if item["id"] == artifact["id"]
            )
            assert scored_artifact["trialScore"] == 100
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
