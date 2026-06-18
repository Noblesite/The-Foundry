#!/usr/bin/env python3
"""Exercise Archive/Hugging Face API contracts without network or downloads."""

from __future__ import annotations

import shutil
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Any, Optional

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
from backend.services import huggingface_model_service as hf_module
from backend.services.foundry_catalog_service import FoundryCatalogService
from backend.services.huggingface_model_service import HuggingFaceModelService


PUBLIC_REPO = "foundry/tiny-public"
GATED_REPO = "foundry/tiny-gated"


class MockHuggingFaceModelService(HuggingFaceModelService):
    """Network-free Archive service that preserves catalog behavior."""

    def __init__(self, catalog_service, archive_dir: Path) -> None:
        super().__init__(catalog_service)
        self.archive_dir = archive_dir
        self.archive_dir.mkdir(parents=True, exist_ok=True)

    def _public_model(self) -> dict[str, Any]:
        return {
            "repoId": PUBLIC_REPO,
            "author": "foundry",
            "sha": "abc123",
            "lastModified": "2026-06-17T00:00:00+00:00",
            "downloads": 42,
            "likes": 7,
            "libraryName": "transformers",
            "pipelineTag": "text-generation",
            "tags": ["text-generation", "tiny"],
            "gated": False,
            "private": False,
            "parameterCount": 125_000,
            "sizeBytes": 2048,
        }

    def _gated_model(self) -> dict[str, Any]:
        model = self._public_model()
        model.update(
            {
                "repoId": GATED_REPO,
                "sha": "def456",
                "gated": True,
                "downloads": 5,
                "likes": 1,
            }
        )
        return model

    def _search_models_sync(
        self,
        *,
        query: str,
        pipeline_tag: str,
        sort: str,
        limit: int,
        include_gated: bool,
        token: Optional[str],
    ) -> list[dict[str, Any]]:
        models = [self._public_model(), self._gated_model()]
        results = []
        for model in models:
            if model["gated"] and not include_gated:
                continue
            if query and query not in model["repoId"]:
                continue
            model["fitEstimate"] = self.estimate_fit(
                model.get("parameterCount"),
                model.get("sizeBytes") or 0,
            )
            results.append(model)
        return results[:limit]

    def _inspect_model_sync(
        self,
        *,
        repo_id: str,
        revision: str,
        token: Optional[str],
    ) -> dict[str, Any]:
        if repo_id == PUBLIC_REPO:
            model = self._public_model()
        elif repo_id == GATED_REPO:
            model = self._gated_model()
        else:
            raise ValueError("Repository not found")
        model["revision"] = revision or model["sha"]
        model["siblings"] = [
            {"rfilename": "config.json", "size": 512},
            {"rfilename": "model.safetensors", "size": 1536},
        ]
        model["fitEstimate"] = self.estimate_fit(
            model.get("parameterCount"),
            model.get("sizeBytes") or 0,
        )
        return model

    def _download_model_sync(
        self,
        *,
        repo_id: str,
        revision: str,
        token: Optional[str],
    ) -> str:
        local_dir = self.archive_dir / self._safe_archive_slug(repo_id, revision)
        local_dir.mkdir(parents=True, exist_ok=True)
        (local_dir / "config.json").write_text('{"model_type":"gpt2"}\n', encoding="utf-8")
        (local_dir / "model.safetensors").write_bytes(b"foundry-tiny-model")
        return str(local_dir)

    def _whoami_sync(self, *, token: str) -> dict[str, Any]:
        if token == "hf_validtoken123":
            return {"name": "foundry-user", "auth": {"accessToken": {"role": "read"}}}
        raise ValueError("Invalid token hf_invalidsecret123")

    async def start_download_job(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")
        return await self.catalog_service.create_model_download_job(
            job_id="mdl-download-mock",
            repo_id=safe_repo_id,
            revision=revision.strip(),
            status="queued",
            phase="queued",
            progress=5,
            detail="Download job queued.",
        )


def assert_response(response, expected_status: int = 200) -> dict[str, Any]:
    assert response.status_code == expected_status, response.text
    payload = response.json()
    assert "requestId" in payload
    return payload["data"]


def run_archive_contract(tmp_path: Path) -> None:
    archive_root = tmp_path / "models"
    original_service = api_server.huggingface_model_service
    original_archive_dir = hf_module.DEFAULT_MODEL_ARCHIVE_DIR

    catalog = FoundryCatalogService(db_path=str(tmp_path / "catalog.db"))
    service = MockHuggingFaceModelService(catalog, archive_root)
    api_server.huggingface_model_service = service
    hf_module.DEFAULT_MODEL_ARCHIVE_DIR = archive_root

    try:
        with TestClient(api_server.app) as client:
            anonymous = assert_response(
                client.post("/api/v1/archive/huggingface/auth/test", json={})
            )
            assert anonymous["ok"] is False
            assert anonymous["accessLevel"] == "anonymous"
            assert anonymous["tokenPresent"] is False

            valid_auth = assert_response(
                client.post(
                    "/api/v1/archive/huggingface/auth/test",
                    json={"username": "foundry-user", "token": "hf_validtoken123"},
                )
            )
            assert valid_auth["ok"] is True
            assert valid_auth["resolvedUsername"] == "foundry-user"
            assert valid_auth["accessLevel"] == "read"

            mismatch_auth = assert_response(
                client.post(
                    "/api/v1/archive/huggingface/auth/test",
                    json={"username": "other-user", "token": "hf_validtoken123"},
                )
            )
            assert mismatch_auth["ok"] is False
            assert mismatch_auth["usernameMatches"] is False

            search = assert_response(
                client.post(
                    "/api/v1/archive/models/search",
                    json={"query": "foundry", "pipelineTag": "text-generation", "limit": 10},
                )
            )
            assert [model["repoId"] for model in search["models"]] == [PUBLIC_REPO]

            gated_search = assert_response(
                client.post(
                    "/api/v1/archive/models/search",
                    json={
                        "query": "foundry",
                        "pipelineTag": "text-generation",
                        "limit": 10,
                        "includeGated": True,
                    },
                )
            )
            assert {model["repoId"] for model in gated_search["models"]} == {
                PUBLIC_REPO,
                GATED_REPO,
            }

            preflight = assert_response(
                client.post("/api/v1/archive/models/preflight", json={"repoId": PUBLIC_REPO})
            )
            assert preflight["canDownload"] is True
            assert preflight["visibility"] == "public"
            assert preflight["auth"]["tokenPresent"] is False
            readiness = assert_response(
                client.post(
                    "/api/v1/foundry/readiness",
                    json={"archiveRepoId": PUBLIC_REPO},
                )
            )
            assert readiness["contractVersion"] == "foundry.readiness-gate.v1"
            assert readiness["status"] == "ready"
            assert readiness["canProceed"] is True
            assert readiness["stations"][0]["id"] == "archive-download"
            assert readiness["stations"][0]["status"] == "ready"

            gated_preflight = assert_response(
                client.post("/api/v1/archive/models/preflight", json={"repoId": GATED_REPO})
            )
            assert gated_preflight["canDownload"] is False
            assert gated_preflight["visibility"] == "gated"
            gated_readiness = assert_response(
                client.post(
                    "/api/v1/foundry/readiness",
                    json={"archiveRepoId": GATED_REPO},
                )
            )
            assert gated_readiness["status"] == "blocked"
            assert gated_readiness["canProceed"] is False
            assert gated_readiness["stations"][0]["checks"][0]["status"] == "fail"

            registered = assert_response(
                client.post("/api/v1/archive/models/register", json={"repoId": PUBLIC_REPO})
            )
            assert registered["archiveEntry"]["status"] == "remote"
            assert registered["archiveEntry"]["repoId"] == PUBLIC_REPO

            archive_entries = assert_response(client.get("/api/v1/archive/models"))
            assert len(archive_entries) == 1
            assert archive_entries[0]["status"] == "remote"

            downloaded = assert_response(
                client.post("/api/v1/archive/models/download", json={"repoId": PUBLIC_REPO})
            )
            assert downloaded["archiveEntry"]["status"] == "cached"
            assert downloaded["model"]["cached"] is True
            assert Path(downloaded["archiveEntry"]["localPath"]).exists()
            assert downloaded["archiveEntry"]["sizeOnDiskBytes"] > 0

            evicted = assert_response(
                client.post(
                    "/api/v1/archive/models/evict",
                    json={
                        "repoId": PUBLIC_REPO,
                        "revision": downloaded["archiveEntry"]["revision"],
                    },
                )
            )
            assert evicted["archiveEntry"]["status"] == "remote"
            assert evicted["archiveEntry"]["localPath"] == ""

            download_job = assert_response(
                client.post("/api/v1/archive/models/download-jobs", json={"repoId": PUBLIC_REPO})
            )
            assert download_job["id"] == "mdl-download-mock"
            assert download_job["status"] == "queued"

            fetched_job = assert_response(
                client.get(f"/api/v1/archive/models/download-jobs/{download_job['id']}")
            )
            assert fetched_job["id"] == download_job["id"]

            job_list = assert_response(client.get("/api/v1/archive/models/download-jobs"))
            assert [job["id"] for job in job_list] == [download_job["id"]]

            canceled = assert_response(
                client.post(
                    f"/api/v1/archive/models/download-jobs/{download_job['id']}/cancel"
                )
            )
            assert canceled["status"] == "canceled"
            assert canceled["cancelRequested"] is True
    finally:
        api_server.huggingface_model_service = original_service
        hf_module.DEFAULT_MODEL_ARCHIVE_DIR = original_archive_dir
        shutil.rmtree(archive_root, ignore_errors=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp_dir:
        run_archive_contract(Path(tmp_dir))
    print("OK: Foundry Archive API contract rehearsal passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
