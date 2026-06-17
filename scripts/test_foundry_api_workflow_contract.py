#!/usr/bin/env python3
"""Exercise the MVP workflow through FastAPI v1 contracts with isolated storage."""

from __future__ import annotations

import shutil
import sys
import tempfile
import warnings
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
from backend.services.forge_smoke_service import LocalForgeSmokeService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService
from backend.services.huggingface_model_service import HuggingFaceModelService


def assert_response(response, expected_status: int = 200) -> dict[str, Any]:
    assert response.status_code == expected_status, response.text
    payload = response.json()
    assert "requestId" in payload
    return payload["data"]


def run_api_workflow(tmp_path: Path) -> None:
    runtime_root = catalog_module.BASE_DIR / "runtime" / "test-api-workflow" / tmp_path.name
    original_source_dir = catalog_module.DEFAULT_SOURCE_DIR
    original_export_dir = catalog_module.DEFAULT_EXPORT_DIR
    original_forge_dir = forge_module.DEFAULT_FORGE_RUNTIME_DIR
    original_catalog_service = api_server.foundry_catalog_service
    original_forge_service = api_server.forge_training_service
    original_huggingface_service = api_server.huggingface_model_service
    original_smoke_service = api_server.local_forge_smoke_service

    catalog_module.DEFAULT_SOURCE_DIR = runtime_root / "sources"
    catalog_module.DEFAULT_EXPORT_DIR = runtime_root / "exports"
    forge_module.DEFAULT_FORGE_RUNTIME_DIR = runtime_root / "forges"

    isolated_catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    isolated_forge = ForgeTrainingService()
    api_server.foundry_catalog_service = isolated_catalog
    api_server.forge_training_service = isolated_forge
    api_server.huggingface_model_service = HuggingFaceModelService(isolated_catalog)
    api_server.local_forge_smoke_service = LocalForgeSmokeService(
        isolated_catalog,
        isolated_forge,
    )

    try:
        with TestClient(api_server.app) as client:
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
