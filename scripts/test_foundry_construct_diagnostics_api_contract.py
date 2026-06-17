#!/usr/bin/env python3
"""Exercise Construct runtime diagnostics API contracts with isolated storage."""

from __future__ import annotations

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
from backend.services.construct_inference_service import ConstructInferenceService
from backend.services.foundry_catalog_service import FoundryCatalogService


def assert_response(response, expected_status: int = 200) -> dict[str, Any]:
    assert response.status_code == expected_status, response.text
    payload = response.json()
    assert "requestId" in payload
    return payload["data"]


def run_diagnostics_contract(tmp_path: Path) -> None:
    original_catalog_service = api_server.foundry_catalog_service
    original_construct_service = api_server.construct_inference_service

    isolated_catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    isolated_construct = ConstructInferenceService()
    isolated_construct.runtime_event_db_path = tmp_path / "runtime-events.db"
    isolated_construct._runtime_events = []
    isolated_construct._initialize_runtime_event_store()

    api_server.foundry_catalog_service = isolated_catalog
    api_server.construct_inference_service = isolated_construct

    try:
        with TestClient(api_server.app) as client:
            cleared = assert_response(client.post("/api/v1/constructs/runtime/events/clear"))
            assert cleared["deletedCount"] == 0

            runtime = assert_response(client.get("/api/v1/constructs/runtime"))
            assert runtime["mode"] == "simulated"
            assert runtime["status"] == "fallback"
            assert runtime["diagnostics"]["loadedModel"]["loaded"] is True

            event = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/events",
                    json={
                        "type": "probe",
                        "status": "passed",
                        "title": "Tiny model probe",
                        "detail": "Probe completed without streaming errors.",
                        "constructId": "con-test",
                        "artifactId": "art-test",
                        "modelId": "sshleifer/tiny-gpt2",
                        "runtimeStatus": "fallback",
                        "source": "backend",
                        "metadata": {"tokens": 8, "path": "/Users/example/secret-cache"},
                    },
                )
            )
            assert event["type"] == "probe"
            assert event["metadata"]["tokens"] == 8

            events = assert_response(client.get("/api/v1/constructs/runtime/events"))
            assert len(events) == 1
            assert events[0]["id"] == event["id"]

            event_export = assert_response(
                client.get("/api/v1/constructs/runtime/events/export")
            )
            assert event_export["contractVersion"] == "foundry.construct.runtime-history.v1"
            assert event_export["eventCount"] == 1
            assert event_export["events"][0]["id"] == event["id"]

            passed_validation = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/validations",
                    json={
                        "constructId": "con-test",
                        "artifactId": "art-test",
                        "modelId": "sshleifer/tiny-gpt2",
                        "device": "cpu",
                        "status": "passed",
                        "totalTokens": 16,
                        "durationSeconds": 0.42,
                        "cleanupStatus": "released",
                        "memoryAvailableGb": 12.5,
                        "metadata": {"mode": "simulated"},
                    },
                )
            )
            assert passed_validation["status"] == "passed"
            assert passed_validation["cleanupStatus"] == "released"

            failed_validation = assert_response(
                client.post(
                    "/api/v1/constructs/runtime/validations",
                    json={
                        "modelId": "other/model",
                        "device": "mps",
                        "status": "failed",
                        "totalTokens": 0,
                        "durationSeconds": 0,
                        "cleanupStatus": "unknown",
                        "error": "Runtime not loaded",
                        "metadata": {"phase": "preflight"},
                    },
                )
            )
            assert failed_validation["status"] == "failed"
            assert failed_validation["error"] == "Runtime not loaded"

            page = assert_response(
                client.get(
                    "/api/v1/constructs/runtime/validations",
                    params={"modelId": "sshleifer/tiny-gpt2", "device": "cpu"},
                )
            )
            assert page["total"] == 1
            assert page["items"][0]["id"] == passed_validation["id"]
            assert page["filters"]["modelId"] == "sshleifer/tiny-gpt2"
            assert page["filters"]["device"] == "cpu"
            assert page["facets"]["statuses"]

            failed_page = assert_response(
                client.get(
                    "/api/v1/constructs/runtime/validations",
                    params={"status": "failed"},
                )
            )
            assert failed_page["total"] == 1
            assert failed_page["items"][0]["id"] == failed_validation["id"]

            validation_export = assert_response(
                client.get(
                    "/api/v1/constructs/runtime/validations/export",
                    params={"modelId": "sshleifer/tiny-gpt2", "status": "passed"},
                )
            )
            assert (
                validation_export["contractVersion"]
                == "foundry.construct.runtime-validations-export.v1"
            )
            assert validation_export["validationCount"] == 1
            assert validation_export["validations"][0]["id"] == passed_validation["id"]
            assert validation_export["filters"]["status"] == "passed"

            diagnostics = assert_response(
                client.get(
                    "/api/v1/constructs/runtime/diagnostics/export",
                    params={"modelId": "sshleifer/tiny-gpt2", "status": "passed"},
                )
            )
            assert diagnostics["contractVersion"] == "foundry.construct.diagnostics-bundle.v1"
            assert diagnostics["runtimeHistory"]["eventCount"] == 1
            assert diagnostics["validationHistory"]["count"] == 1
            assert diagnostics["validationHistory"]["filteredExport"]["validations"][0]["id"] == (
                passed_validation["id"]
            )
            assert diagnostics["serviceStatus"]["construct"]["reachable"] is True
            assert any("settings.huggingFaceToken" in item for item in diagnostics["redactions"])
            assert any(
                item["field"] == "chat.messages" and item["status"] == "excluded"
                for item in diagnostics["redactionAudit"]
            )
            serialized = str(diagnostics)
            assert "hf_" not in serialized

            cleared_after = assert_response(client.post("/api/v1/constructs/runtime/events/clear"))
            assert cleared_after["deletedCount"] == 1
            assert assert_response(client.get("/api/v1/constructs/runtime/events")) == []
    finally:
        api_server.foundry_catalog_service = original_catalog_service
        api_server.construct_inference_service = original_construct_service


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        run_diagnostics_contract(Path(tmp_dir))
    print("OK: Foundry Construct diagnostics API contract rehearsal passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
