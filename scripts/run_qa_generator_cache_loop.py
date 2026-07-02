#!/usr/bin/env python3
"""Rehearse the QA generator cache loop through FastAPI contracts.

This smoke intentionally avoids network access and model downloads. It proves
the contract path that the Materials UI drives:

blocked local generator preflight -> local Archive cache appears ->
configure/preflight -> model-backed proof.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import warnings
from datetime import datetime, timezone
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
from backend.services import qa_generation_service as qa_module
from backend.services.foundry_catalog_service import FoundryCatalogService


class SmokeFailure(RuntimeError):
    pass


def assert_response(response, expected_status: int = 200) -> dict[str, Any]:
    if response.status_code != expected_status:
        raise SmokeFailure(
            f"{response.request.method} {response.request.url} returned "
            f"HTTP {response.status_code}: {response.text}"
        )
    payload = response.json()
    if "data" not in payload or "requestId" not in payload:
        raise SmokeFailure("API response did not use the Foundry envelope.")
    return payload["data"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def tiny_generator_backend(prompt: str, local_files_only: bool) -> str:
    require(local_files_only, "Model-backed proof did not request local files only.")
    require("Marshall" in prompt, "Model-backed proof prompt did not include source context.")
    return json.dumps(
        [
            {
                "question": "Which emergency roles does Marshall handle in Adventure Bay?",
                "answer": (
                    "Marshall helps the Paw Patrol as a fire pup and supports "
                    "medical emergencies when the team needs rescue help."
                ),
                "confidence": 0.91,
                "qaType": "behavior",
            }
        ]
    )


def run_cache_loop(tmp_path: Path) -> dict[str, Any]:
    runtime_root = tmp_path / "runtime"
    archive_root = runtime_root / "models" / "huggingface"
    original_catalog_service = api_server.foundry_catalog_service
    original_qa_archive_dir = qa_module.DEFAULT_QA_MODEL_ARCHIVE_DIR

    qa_module.DEFAULT_QA_MODEL_ARCHIVE_DIR = archive_root
    isolated_catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    isolated_catalog.qa_generator.set_model_text_backend(tiny_generator_backend)
    isolated_catalog.qa_generator._transformers_available = lambda: True
    api_server.foundry_catalog_service = isolated_catalog

    model_id = "foundry-smoke/qa-generator-cache-loop"
    archive_slug = isolated_catalog.qa_generator._safe_archive_slug(model_id)
    archive_path = archive_root / archive_slug
    request_body = {
        "mode": "transformers",
        "modelId": model_id,
        "maxNewTokens": 96,
        "temperature": 0.0,
    }
    report: dict[str, Any] = {
        "modelId": model_id,
        "archivePath": str(archive_path),
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with TestClient(api_server.app) as client:
            blocked = assert_response(
                client.post(
                    "/api/v1/assembly-line/qa-generator/preflight",
                    json=request_body,
                )
            )
            require(blocked["contractVersion"] == "foundry.qa-generator.preflight.v1", "Blocked preflight contract mismatch.")
            require(blocked["status"] == "blocked", "Uncached QA generator preflight should be blocked.")
            require(blocked["model"]["cached"] is False, "Uncached preflight reported cached model.")
            require(
                any(check["id"] == "archive-cache" and check["status"] == "fail" for check in blocked["checks"]),
                "Blocked preflight did not fail the archive-cache check.",
            )
            report["blockedStatus"] = blocked["status"]

            archive_path.mkdir(parents=True, exist_ok=True)
            (archive_path / "config.json").write_text("{}", encoding="utf-8")

            cached = assert_response(
                client.post(
                    "/api/v1/assembly-line/qa-generator/preflight",
                    json=request_body,
                )
            )
            require(cached["status"] == "ready", "Cached QA generator preflight should be ready.")
            require(cached["model"]["cached"] is True, "Cached preflight did not report cached model.")
            require(cached["model"]["path"] == str(archive_path), "Cached preflight reported the wrong archive path.")
            require(
                any(check["id"] == "archive-cache" and check["status"] == "pass" for check in cached["checks"]),
                "Cached preflight did not pass the archive-cache check.",
            )
            report["cachedStatus"] = cached["status"]

            runtime = assert_response(
                client.post(
                    "/api/v1/assembly-line/qa-generator/runtime/configure",
                    json=request_body,
                )
            )
            require(runtime["ready"] is True, "QA generator runtime did not become ready.")
            require(runtime["mode"] == "transformers", "QA generator runtime did not stay in transformers mode.")

            proof = assert_response(client.post("/api/v1/assembly-line/qa-generator/quality-proof"))
            require(proof["contractVersion"] == "foundry.qa-generator.quality-proof.v1", "Quality proof contract mismatch.")
            require(proof["proofMode"]["modelId"] == model_id, "Quality proof used the wrong model id.")
            require(proof["proofMode"]["modelCached"] is True, "Quality proof did not preserve cached model metadata.")
            require(proof["proofMode"]["localFilesOnly"] is True, "Quality proof was not constrained to local files.")
            require(proof["proofMode"]["simulated"] is False, "API quality proof should not report simulated mode.")
            model_proof = next(
                result for result in proof["results"] if result["label"] == "Cached local model"
            )
            require(model_proof["status"] == "passed", "Cached local model proof did not pass.")
            require(model_proof["proofSource"] == "backend-local-model", "Model proof source mismatch.")
            require(model_proof["preflightStatus"] == "ready", "Model proof did not retain ready preflight status.")
            require(model_proof["rows"], "Model-backed proof did not produce a QA row.")
            report["proofStatus"] = model_proof["status"]
            report["proofSource"] = model_proof["proofSource"]
            report["question"] = model_proof["rows"][0]["question"]
            report["completedAt"] = datetime.now(timezone.utc).isoformat()
            return report
    finally:
        api_server.foundry_catalog_service = original_catalog_service
        qa_module.DEFAULT_QA_MODEL_ARCHIVE_DIR = original_qa_archive_dir
        shutil.rmtree(runtime_root, ignore_errors=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        report = run_cache_loop(Path(tmp_dir))
    print("PASS: QA generator cache loop rehearsal completed.")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SmokeFailure as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
