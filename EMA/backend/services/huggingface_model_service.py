from __future__ import annotations

import os
import platform
import re
import asyncio
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from uuid import uuid4

import psutil


BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_ARCHIVE_DIR = BASE_DIR / "runtime" / "models" / "huggingface"


class HuggingFaceAccessError(ValueError):
    """Raised when Hugging Face rejects or requires credentials."""


class HuggingFaceModelService:
    """
    Archive-facing Hugging Face model discovery.

    Public model search works anonymously. A token is only needed for private or
    gated repositories, and callers pass it per request so the service never
    persists credentials.
    """

    def __init__(self, catalog_service) -> None:
        self.catalog_service = catalog_service
        self.archive_dir = Path(
            os.getenv("FOUNDRY_MODEL_ARCHIVE_DIR", str(DEFAULT_MODEL_ARCHIVE_DIR))
        )
        self.archive_dir.mkdir(parents=True, exist_ok=True)

    async def search_models(
        self,
        *,
        query: str,
        pipeline_tag: str,
        sort: str,
        limit: int,
        include_gated: bool,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_limit = max(1, min(limit, 50))
        models = await self._run_hf_query(
            self._search_models_sync,
            query=query.strip(),
            pipeline_tag=pipeline_tag.strip() or "text-generation",
            sort=sort.strip() or "downloads",
            limit=safe_limit,
            include_gated=include_gated,
            token=self._effective_token(token),
        )
        return {
            "models": models,
            "platform": self.platform_profile(username=username, token=token),
        }

    async def inspect_model(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")

        model = await self._run_hf_query(
            self._inspect_model_sync,
            repo_id=safe_repo_id,
            revision=revision.strip(),
            token=self._effective_token(token),
        )
        archive_entry = await self.catalog_service.get_model_archive_entry(
            repo_id=safe_repo_id,
            revision=revision.strip(),
        )
        model["archiveEntry"] = archive_entry
        model["cached"] = bool(archive_entry and archive_entry.get("status") in {"cached", "ready"})
        return {
            "model": model,
            "platform": self.platform_profile(username=username, token=token),
        }

    async def preflight_model(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")

        model = await self._run_hf_query(
            self._inspect_model_sync,
            repo_id=safe_repo_id,
            revision=revision.strip(),
            token=self._effective_token(token),
        )
        visibility = self._model_visibility(model)
        fit = model["fitEstimate"]
        estimated_download_bytes = int(model.get("sizeBytes") or fit.get("estimatedBytes") or 0)
        can_download = fit.get("status") != "too-large"
        if visibility in {"gated", "private"} and not (token or "").strip():
            can_download = False

        return {
            "ok": True,
            "canDownload": can_download,
            "visibility": visibility,
            "model": model,
            "platform": self.platform_profile(username=username, token=token),
            "fitEstimate": fit,
            "estimatedDownloadBytes": estimated_download_bytes,
            "auth": {
                "username": (username or "").strip() or None,
                "tokenPresent": bool((token or "").strip()),
            },
            "message": self._preflight_message(
                model=model,
                visibility=visibility,
                can_download=can_download,
            ),
        }

    async def register_remote_model(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        inspection = await self.inspect_model(
            repo_id=repo_id,
            revision=revision,
            username=username,
            token=token,
        )
        model = inspection["model"]
        entry = await self.catalog_service.upsert_model_archive_entry(
            repo_id=model["repoId"],
            revision=model.get("revision") or "",
            local_path="",
            source="huggingface",
            status="remote",
            size_on_disk_bytes=model.get("sizeBytes") or 0,
            parameter_count=model.get("parameterCount"),
            library_name=model.get("libraryName"),
            pipeline_tag=model.get("pipelineTag"),
            gated=bool(model.get("gated")),
            private=bool(model.get("private")),
        )
        model["archiveEntry"] = entry
        return {
            "model": model,
            "archiveEntry": entry,
            "platform": inspection["platform"],
        }

    async def download_model(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")

        safe_revision = revision.strip()
        model = None
        try:
            model = await self._run_hf_query(
                self._inspect_model_sync,
                repo_id=safe_repo_id,
                revision=safe_revision,
                token=self._effective_token(token),
            )
            local_path = await self._run_hf_query(
                self._download_model_sync,
                repo_id=safe_repo_id,
                revision=safe_revision,
                token=self._effective_token(token),
            )
            size_on_disk = self._directory_size(Path(local_path))
            entry = await self.catalog_service.upsert_model_archive_entry(
                repo_id=model["repoId"],
                revision=model.get("revision") or safe_revision,
                local_path=local_path,
                source="huggingface",
                status="cached",
                size_on_disk_bytes=size_on_disk,
                parameter_count=model.get("parameterCount"),
                library_name=model.get("libraryName"),
                pipeline_tag=model.get("pipelineTag"),
                gated=bool(model.get("gated")),
                private=bool(model.get("private")),
            )
            model["archiveEntry"] = entry
            model["cached"] = True
            return {
                "model": model,
                "archiveEntry": entry,
                "platform": self.platform_profile(username=username, token=token),
            }
        except Exception:
            if model:
                await self.catalog_service.upsert_model_archive_entry(
                    repo_id=model["repoId"],
                    revision=model.get("revision") or safe_revision,
                    local_path="",
                    source="huggingface",
                    status="failed",
                    size_on_disk_bytes=0,
                    parameter_count=model.get("parameterCount"),
                    library_name=model.get("libraryName"),
                    pipeline_tag=model.get("pipelineTag"),
                    gated=bool(model.get("gated")),
                    private=bool(model.get("private")),
                )
            raise

    async def start_download_job(
        self,
        *,
        repo_id: str,
        revision: str,
        username: Optional[str],
        token: Optional[str],
    ) -> Dict[str, Any]:
        self._validate_auth_pair(username=username, token=token)
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")

        job = {
            "id": f"mdl-download-{uuid4()}",
            "repoId": safe_repo_id,
            "revision": revision.strip(),
            "status": "queued",
            "phase": "queued",
            "progress": 5,
            "detail": "Download job queued.",
            "archiveEntry": None,
            "error": None,
        }
        job = await self.catalog_service.create_model_download_job(
            job_id=job["id"],
            repo_id=job["repoId"],
            revision=job["revision"],
            status=job["status"],
            phase=job["phase"],
            progress=job["progress"],
            detail=job["detail"],
        )
        asyncio.create_task(
            self._run_download_job(job["id"], token=self._effective_token(token))
        )
        return job

    def _validate_auth_pair(self, *, username: Optional[str], token: Optional[str]) -> None:
        if (username or "").strip() and not (token or "").strip():
            raise ValueError("Hugging Face token is required when a username is provided.")

    async def test_auth(self, *, username: Optional[str], token: Optional[str]) -> Dict[str, Any]:
        safe_username = (username or "").strip()
        safe_token = (token or "").strip()
        if not safe_token:
            return {
                "ok": False,
                "provider": "huggingface",
                "username": safe_username or None,
                "resolvedUsername": None,
                "tokenPresent": False,
                "usernameMatches": False,
                "accessLevel": "anonymous",
                "message": "No Hugging Face token is saved. Public model search can still work, but gated/private models require a username and token.",
            }

        try:
            identity = await self._run_hf_query(self._whoami_sync, token=safe_token)
        except Exception as error:
            return {
                "ok": False,
                "provider": "huggingface",
                "username": safe_username or None,
                "resolvedUsername": None,
                "tokenPresent": True,
                "usernameMatches": False,
                "accessLevel": "invalid",
                "message": self._friendly_huggingface_error(error),
            }

        resolved_username = (
            str(identity.get("name") or identity.get("fullname") or "").strip() or None
        )
        username_matches = not safe_username or (
            bool(resolved_username) and safe_username.lower() == resolved_username.lower()
        )
        access_level = self._auth_access_level(identity)
        if not username_matches:
            return {
                "ok": False,
                "provider": "huggingface",
                "username": safe_username or None,
                "resolvedUsername": resolved_username,
                "tokenPresent": True,
                "usernameMatches": False,
                "accessLevel": access_level,
                "message": f"The token is valid, but it belongs to {resolved_username or 'a different Hugging Face account'}. Update the username in Settings or paste a token for {safe_username}.",
            }

        display_username = safe_username or resolved_username or "the saved account"
        return {
            "ok": True,
            "provider": "huggingface",
            "username": safe_username or resolved_username,
            "resolvedUsername": resolved_username,
            "tokenPresent": True,
            "usernameMatches": True,
            "accessLevel": access_level,
            "message": f"Hugging Face credentials verified for {display_username}. Archive can use this token for models the account is allowed to access.",
        }

    async def get_download_job(self, job_id: str) -> Dict[str, Any]:
        job = await self.catalog_service.get_model_download_job(job_id)
        if job is None:
            raise ValueError("Model download job was not found.")
        return job

    async def list_download_jobs(self) -> list[Dict[str, Any]]:
        return await self.catalog_service.list_model_download_jobs()

    async def cancel_download_job(self, job_id: str) -> Dict[str, Any]:
        job = await self.catalog_service.get_model_download_job(job_id)
        if job is None:
            raise ValueError("Model download job was not found.")
        if job["status"] in {"completed", "failed", "canceled"}:
            return job
        return await self.catalog_service.cancel_model_download_job(job_id)

    async def list_archive_entries(self) -> list[Dict[str, Any]]:
        return await self.catalog_service.list_model_archive_entries()

    async def evict_archive_model(self, *, repo_id: str, revision: str) -> Dict[str, Any]:
        safe_repo_id = repo_id.strip()
        if not safe_repo_id:
            raise ValueError("Model repository id cannot be empty.")

        existing_entry = await self.catalog_service.get_model_archive_entry(
            repo_id=safe_repo_id,
            revision=revision.strip(),
        )
        if existing_entry is None:
            raise ValueError("Model Archive entry was not found.")

        entry = await self.catalog_service.upsert_model_archive_entry(
            repo_id=existing_entry["repoId"],
            revision=existing_entry.get("revision") or "",
            local_path="",
            source=existing_entry.get("source") or "huggingface",
            status="remote",
            size_on_disk_bytes=0,
            parameter_count=existing_entry.get("parameterCount"),
            library_name=existing_entry.get("libraryName"),
            pipeline_tag=existing_entry.get("pipelineTag"),
            gated=bool(existing_entry.get("gated")),
            private=bool(existing_entry.get("private")),
        )
        return {"archiveEntry": entry}

    async def _run_download_job(self, job_id: str, token: Optional[str]) -> None:
        try:
            await self._raise_if_download_canceled(job_id)
            job = await self._update_download_job(
                job_id,
                status="running",
                phase="inspecting",
                progress=15,
                detail="Inspecting model metadata.",
            )
            await self._raise_if_download_canceled(job_id)
            model = await self._run_hf_query(
                self._inspect_model_sync,
                repo_id=job["repoId"],
                revision=job["revision"],
                token=token,
            )
            await self._raise_if_download_canceled(job_id)
            job = await self._update_download_job(
                job_id,
                phase="downloading",
                progress=35,
                detail=f"Downloading {model['repoId']} into the local Archive.",
            )
            local_path = await self._run_hf_query(
                self._download_model_sync,
                repo_id=job["repoId"],
                revision=job["revision"],
                token=token,
            )
            await self._raise_if_download_canceled(job_id)
            await self._update_download_job(
                job_id,
                phase="cataloging",
                progress=88,
                detail="Cataloging local model files.",
            )
            size_on_disk = self._directory_size(Path(local_path))
            entry = await self.catalog_service.upsert_model_archive_entry(
                repo_id=model["repoId"],
                revision=model.get("revision") or job["revision"],
                local_path=local_path,
                source="huggingface",
                status="cached",
                size_on_disk_bytes=size_on_disk,
                parameter_count=model.get("parameterCount"),
                library_name=model.get("libraryName"),
                pipeline_tag=model.get("pipelineTag"),
                gated=bool(model.get("gated")),
                private=bool(model.get("private")),
            )
            await self._update_download_job(
                job_id,
                status="completed",
                phase="completed",
                progress=100,
                detail=f"{model['repoId']} is cached in the local Archive.",
                archive_entry_id=entry["id"],
            )
        except asyncio.CancelledError as error:
            await self._update_download_job(
                job_id,
                status="canceled",
                phase="canceled",
                progress=100,
                detail=str(error),
                error=str(error),
                cancel_requested=True,
            )
        except Exception as error:
            job = await self.catalog_service.get_model_download_job(job_id)
            if job and job.get("cancelRequested"):
                await self._update_download_job(
                    job_id,
                    status="canceled",
                    phase="canceled",
                    progress=100,
                    detail="Download canceled.",
                    error=None,
                    cancel_requested=True,
                )
                return
            await self._update_download_job(
                job_id,
                status="failed",
                phase="failed",
                progress=100,
                detail="Model download failed.",
                error=self._friendly_huggingface_error(error),
            )
            try:
                await self.catalog_service.upsert_model_archive_entry(
                    repo_id=job["repoId"] if job else "",
                    revision=job["revision"] if job else "",
                    local_path="",
                    source="huggingface",
                    status="failed",
                    size_on_disk_bytes=0,
                    parameter_count=None,
                    library_name=None,
                    pipeline_tag=None,
                    gated=False,
                    private=False,
                )
            except Exception:
                pass

    async def _update_download_job(self, job_id: str, **kwargs) -> Dict[str, Any]:
        return await self.catalog_service.update_model_download_job(job_id, **kwargs)

    async def _raise_if_download_canceled(self, job_id: str) -> None:
        job = await self.catalog_service.get_model_download_job(job_id)
        if job and job.get("cancelRequested"):
            raise asyncio.CancelledError("Download canceled.")

    async def _run_hf_query(self, fn, **kwargs):
        try:
            return await asyncio.to_thread(fn, **kwargs)
        except Exception as error:
            friendly_message = self._friendly_huggingface_error(error)
            if friendly_message != str(error):
                raise HuggingFaceAccessError(friendly_message) from error
            raise

    def _friendly_huggingface_error(self, error: Exception) -> str:
        message = self._redact_secret(str(error)).strip()
        lowered = message.lower()

        if any(
            marker in lowered
            for marker in (
                "invalid token",
                "token is invalid",
                "unauthorized",
                "401 client error",
                "401 unauthorized",
                "bad credentials",
            )
        ):
            return (
                "Hugging Face rejected the saved token. Check Settings, paste a current "
                "access token, and make sure it belongs to the selected username."
            )

        if any(
            marker in lowered
            for marker in (
                "gated repo",
                "gated repository",
                "restricted",
                "access to model",
                "must be authenticated",
                "private repo",
                "private repository",
            )
        ):
            return (
                "This model is gated or private. Sign in to Hugging Face, accept the "
                "model terms if required, then save your username and access token in Settings."
            )

        if "repository not found" in lowered or "404 client error" in lowered:
            return (
                "Hugging Face could not find that model, or the account saved in Settings "
                "does not have access to it."
            )

        return message or "Hugging Face returned an unknown error."

    def _redact_secret(self, value: str) -> str:
        return re.sub(r"hf_[A-Za-z0-9_\\-]{8,}", "hf_***", value)

    def _search_models_sync(
        self,
        *,
        query: str,
        pipeline_tag: str,
        sort: str,
        limit: int,
        include_gated: bool,
        token: Optional[str],
    ) -> list[Dict[str, Any]]:
        from huggingface_hub import HfApi

        api = HfApi(token=token)
        models = api.list_models(
            search=query or None,
            pipeline_tag=pipeline_tag or None,
            sort=sort,
            direction=-1,
            limit=limit,
            full=False,
            token=token,
        )

        results = []
        for model_info in models:
            model = self._model_summary_from_info(model_info)
            if model["gated"] and not include_gated:
                continue
            model["fitEstimate"] = self.estimate_fit(model.get("parameterCount"))
            results.append(model)
        return results[:limit]

    def _inspect_model_sync(
        self,
        *,
        repo_id: str,
        revision: str,
        token: Optional[str],
    ) -> Dict[str, Any]:
        from huggingface_hub import HfApi

        api = HfApi(token=token)
        model_info = api.model_info(
            repo_id=repo_id,
            revision=revision or None,
            files_metadata=True,
            token=token,
        )
        model = self._model_summary_from_info(model_info)
        model["revision"] = revision or getattr(model_info, "sha", "") or ""
        model["siblings"] = [
            {
                "rfilename": getattr(sibling, "rfilename", ""),
                "size": getattr(sibling, "size", None),
            }
            for sibling in (getattr(model_info, "siblings", None) or [])
        ]
        model["fitEstimate"] = self.estimate_fit(model.get("parameterCount"), model.get("sizeBytes"))
        return model

    def _download_model_sync(
        self,
        *,
        repo_id: str,
        revision: str,
        token: Optional[str],
    ) -> str:
        from huggingface_hub import snapshot_download

        local_dir = self.archive_dir / self._safe_archive_slug(repo_id, revision)
        local_dir.mkdir(parents=True, exist_ok=True)
        return snapshot_download(
            repo_id=repo_id,
            revision=revision or None,
            token=token,
            local_dir=str(local_dir),
        )

    def _whoami_sync(self, *, token: str) -> Dict[str, Any]:
        from huggingface_hub import HfApi

        api = HfApi(token=token)
        identity = api.whoami(token=token)
        return identity if isinstance(identity, dict) else {}

    def _auth_access_level(self, identity: Dict[str, Any]) -> str:
        auth = identity.get("auth")
        if isinstance(auth, dict):
            access_token = auth.get("accessToken")
            if isinstance(access_token, dict):
                role = access_token.get("role") or access_token.get("fineGrained")
                if role:
                    return str(role)
        return "authenticated"

    def _model_visibility(self, model: Dict[str, Any]) -> str:
        if model.get("private"):
            return "private"
        if model.get("gated"):
            return "gated"
        return "public"

    def _preflight_message(
        self,
        *,
        model: Dict[str, Any],
        visibility: str,
        can_download: bool,
    ) -> str:
        repo_id = str(model.get("repoId") or "Selected model")
        fit_status = str(model.get("fitEstimate", {}).get("status") or "unknown")
        if visibility in {"gated", "private"} and not can_download:
            return (
                f"{repo_id} is {visibility}. Save credentials for an account with access "
                "before queueing the Archive download."
            )
        if fit_status == "too-large":
            return (
                f"{repo_id} is visible, but the memory estimate is too large for the current "
                "runtime profile. Pick a smaller model or use stronger quantization."
            )
        if fit_status == "tight":
            return (
                f"{repo_id} is visible and downloadable, but the memory estimate is tight. "
                "Expect slower inference or reduce context size."
            )
        return f"{repo_id} is visible, metadata loaded, and ready to queue for Archive download."

    def _model_summary_from_info(self, model_info) -> Dict[str, Any]:
        repo_id = getattr(model_info, "modelId", None) or getattr(model_info, "id", "")
        tags = list(getattr(model_info, "tags", None) or [])
        parameter_count = self._parameter_count(model_info, repo_id, tags)
        return {
            "repoId": repo_id,
            "author": getattr(model_info, "author", None),
            "sha": getattr(model_info, "sha", None),
            "lastModified": self._stringify_datetime(getattr(model_info, "lastModified", None)),
            "downloads": getattr(model_info, "downloads", 0) or 0,
            "likes": getattr(model_info, "likes", 0) or 0,
            "libraryName": getattr(model_info, "library_name", None),
            "pipelineTag": getattr(model_info, "pipeline_tag", None),
            "tags": tags,
            "gated": bool(getattr(model_info, "gated", False)),
            "private": bool(getattr(model_info, "private", False)),
            "parameterCount": parameter_count,
            "sizeBytes": self._size_bytes(model_info),
        }

    def _parameter_count(
        self,
        model_info,
        repo_id: str,
        tags: Iterable[str],
    ) -> Optional[int]:
        safetensors = getattr(model_info, "safetensors", None)
        if isinstance(safetensors, dict):
            total = safetensors.get("total")
            if isinstance(total, int):
                return total

        card_data = getattr(model_info, "cardData", None)
        if isinstance(card_data, dict):
            for key in ("params", "parameters", "parameter_count"):
                parsed = self._parse_parameter_text(str(card_data.get(key, "")))
                if parsed:
                    return parsed

        for value in [repo_id, *tags]:
            parsed = self._parse_parameter_text(value)
            if parsed:
                return parsed
        return None

    def _parse_parameter_text(self, value: str) -> Optional[int]:
        match = re.search(r"(?<![a-z0-9])(\d+(?:\.\d+)?)\s*([bm])\b", value.lower())
        if not match:
            return None
        amount = float(match.group(1))
        multiplier = 1_000_000_000 if match.group(2) == "b" else 1_000_000
        return int(amount * multiplier)

    def _size_bytes(self, model_info) -> int:
        siblings = getattr(model_info, "siblings", None) or []
        total = 0
        for sibling in siblings:
            size = getattr(sibling, "size", None)
            if isinstance(size, int):
                total += size
        return total

    def _directory_size(self, path: Path) -> int:
        if not path.exists():
            return 0
        total = 0
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    total += file_path.stat().st_size
                except OSError:
                    continue
        return total

    def _safe_archive_slug(self, repo_id: str, revision: str) -> str:
        raw_value = f"{repo_id}@{revision}" if revision else repo_id
        normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw_value).strip("-")
        return normalized or "model"

    def platform_profile(
        self,
        username: Optional[str] = None,
        token: Optional[str] = None,
    ) -> Dict[str, Any]:
        memory = psutil.virtual_memory()
        accelerator = "cpu"
        accelerator_memory_bytes = 0
        torch_details: Dict[str, Any] = {}

        try:
            import torch

            torch_details = {
                "torchVersion": torch.__version__,
                "cudaAvailable": torch.cuda.is_available(),
                "mpsBuilt": bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_built()),
                "mpsAvailable": bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available()),
            }
            if torch.cuda.is_available():
                props = torch.cuda.get_device_properties(0)
                accelerator = "cuda"
                accelerator_memory_bytes = int(props.total_memory)
                torch_details["cudaDevice"] = props.name
            elif torch_details["mpsAvailable"]:
                accelerator = "mps"
                accelerator_memory_bytes = int(memory.available)
        except Exception as error:
            torch_details["torchError"] = str(error)

        return {
            "os": platform.system() or "Unknown",
            "machine": platform.machine() or "unknown",
            "python": platform.python_version(),
            "accelerator": accelerator,
            "systemMemoryBytes": int(memory.total),
            "availableMemoryBytes": int(memory.available),
            "acceleratorMemoryBytes": accelerator_memory_bytes,
            "unifiedMemory": accelerator == "mps",
            "torch": torch_details,
            "auth": {
                "provider": "huggingface",
                "username": (username or "").strip() or None,
                "tokenPresent": bool((token or "").strip()),
            },
        }

    def estimate_fit(
        self,
        parameter_count: Optional[int],
        size_bytes: int = 0,
        quantization: str = "int4",
    ) -> Dict[str, Any]:
        profile = self.platform_profile()
        available = profile["acceleratorMemoryBytes"] or profile["availableMemoryBytes"]
        if not parameter_count and not size_bytes:
            return {
                "status": "unknown",
                "recommendedRuntime": profile["accelerator"],
                "estimatedBytes": 0,
                "availableBytes": available,
                "reason": "Model parameter count or file size was not available from Hugging Face metadata.",
            }

        bytes_per_parameter = {
            "fp32": 4.0,
            "fp16": 2.0,
            "bf16": 2.0,
            "int8": 1.2,
            "int4": 0.7,
        }.get(quantization, 0.7)
        parameter_estimate = int(parameter_count * bytes_per_parameter) if parameter_count else 0
        base_estimate = max(parameter_estimate, size_bytes)
        estimated = int(base_estimate * 1.35)
        conservative_budget = int(available * (0.78 if profile["accelerator"] == "mps" else 0.85))

        if estimated <= conservative_budget * 0.75:
            status = "fits"
            reason = "Estimated memory fits with comfortable runtime headroom."
        elif estimated <= available:
            status = "tight"
            reason = (
                "Estimated memory is within available memory, but exceeds the conservative "
                "runtime headroom budget. Keep context length and batch size conservative."
            )
        else:
            status = "too-large"
            reason = "Estimated memory exceeds currently available memory for this machine."

        if profile["accelerator"] == "cpu":
            reason = f"{reason} CPU inference may be slow without GPU acceleration."

        return {
            "status": status,
            "recommendedRuntime": profile["accelerator"],
            "estimatedBytes": estimated,
            "availableBytes": available,
            "assumedQuantization": quantization,
            "reason": reason,
        }

    def _effective_token(self, token: Optional[str]) -> Optional[str]:
        safe_token = (token or "").strip()
        return safe_token or os.getenv("HF_TOKEN") or None

    def _stringify_datetime(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)
