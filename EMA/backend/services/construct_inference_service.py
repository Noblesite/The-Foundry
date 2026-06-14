from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from typing import Any, AsyncIterator, Dict, Optional


@dataclass
class InferenceRuntime:
    mode: str
    status: str
    detail: str
    modelId: str
    device: str
    loaded: bool
    diagnostics: Dict[str, Any]


class ConstructInferenceService:
    """
    Streams Construct tokens behind a small adapter boundary.

    The default simulator keeps The Foundry self-hostable during early setup.
    Setting FOUNDRY_CONSTRUCT_INFERENCE_MODE=transformers opts into the local
    Hugging Face path without changing API or frontend contracts.
    """

    def __init__(self) -> None:
        self.mode = os.getenv("FOUNDRY_CONSTRUCT_INFERENCE_MODE", "simulated").strip().lower()
        self.model_id = os.getenv("FOUNDRY_CONSTRUCT_MODEL_ID", "").strip()
        self.device_preference = os.getenv("FOUNDRY_CONSTRUCT_DEVICE", "auto").strip().lower()
        self._model_cache: Dict[str, Any] = {}
        self._active_loaded_model_id = ""
        self._last_load_event: Dict[str, Any] = {
            "status": "idle",
            "modelId": self.model_id or "",
            "device": self.device_preference,
            "durationSeconds": None,
            "startedAt": None,
            "finishedAt": None,
            "failureReason": None,
        }
        self._load_lock = asyncio.Lock()

    def describe_runtime(self) -> InferenceRuntime:
        active_loaded_model_id = (
            self._active_loaded_model_id
            if self._active_loaded_model_id in self._model_cache
            else ""
        )
        model_id = active_loaded_model_id or self.model_id or "active Artifact base model"
        loaded = self.mode == "simulated" or bool(active_loaded_model_id)
        loaded_device = self._loaded_device(model_id) if active_loaded_model_id else self.device_preference
        if self.mode == "transformers":
            return InferenceRuntime(
                mode="transformers",
                status="loaded" if active_loaded_model_id else "configured",
                detail="Local Transformers inference is enabled.",
                modelId=model_id,
                device=loaded_device,
                loaded=loaded,
                diagnostics=self._runtime_diagnostics(),
            )
        return InferenceRuntime(
            mode="simulated",
            status="fallback",
            detail="Using deterministic simulated token streaming.",
            modelId=model_id,
            device="none",
            loaded=True,
            diagnostics=self._runtime_diagnostics(),
        )

    def runtime_payload(self) -> Dict[str, Any]:
        runtime = self.describe_runtime()
        diagnostics = dict(runtime.diagnostics)
        diagnostics["loadedModel"] = {
            "modelId": runtime.modelId,
            "device": runtime.device,
            "loaded": runtime.loaded,
            "cacheSize": len(self._model_cache),
        }
        diagnostics["loadEvent"] = dict(self._last_load_event)
        return {
            "mode": runtime.mode,
            "status": runtime.status,
            "detail": runtime.detail,
            "modelId": runtime.modelId,
            "device": runtime.device,
            "loaded": runtime.loaded,
            "diagnostics": diagnostics,
        }

    async def configure(
        self,
        mode: str,
        model_id: Optional[str] = None,
        device: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_mode = mode.strip().lower()
        if normalized_mode not in {"simulated", "transformers"}:
            raise ValueError("Runtime mode must be simulated or transformers.")

        self.mode = normalized_mode
        if model_id is not None:
            self.model_id = model_id.strip()
        if device is not None:
            self.device_preference = device.strip().lower() or "auto"
        return self.runtime_payload()

    async def load(self, model_id: Optional[str] = None) -> Dict[str, Any]:
        if model_id:
            self.model_id = model_id.strip()
        if self.mode != "transformers":
            self._record_load_event(
                status="skipped",
                model_id=self.model_id or "active Artifact base model",
                device="none",
                duration_seconds=0,
                failure_reason="Runtime is using simulated token streaming.",
            )
            return self.runtime_payload()

        target_model = self.model_id
        if not target_model:
            raise ValueError("Set a model id before loading the Transformers runtime.")
        started_at = time.perf_counter()
        event_started_at = self._utc_now()
        self._last_load_event = {
            "status": "loading",
            "modelId": target_model,
            "device": self.device_preference,
            "durationSeconds": None,
            "startedAt": event_started_at,
            "finishedAt": None,
            "failureReason": None,
        }
        try:
            _tokenizer, model = await self._load_transformers_model(target_model)
            self._active_loaded_model_id = target_model
            self._record_load_event(
                status="loaded",
                model_id=target_model,
                device=self._device_for_model(model),
                duration_seconds=round(time.perf_counter() - started_at, 3),
                started_at=event_started_at,
            )
        except Exception as error:
            self._active_loaded_model_id = ""
            self._record_load_event(
                status="failed",
                model_id=target_model,
                device=self.device_preference,
                duration_seconds=round(time.perf_counter() - started_at, 3),
                started_at=event_started_at,
                failure_reason=str(error),
            )
            raise
        return self.runtime_payload()

    async def preflight_model(self, model_id: Optional[str], device: str) -> Dict[str, Any]:
        target_model = (model_id or self.model_id or "").strip()
        if not target_model:
            raise ValueError("Set a model id before running a compatibility preflight.")

        previous_device = self.device_preference
        self.device_preference = (device or "auto").strip().lower()
        try:
            return await asyncio.to_thread(self._preflight_model_sync, target_model)
        finally:
            self.device_preference = previous_device

    async def unload(self) -> Dict[str, Any]:
        self._model_cache.clear()
        self._active_loaded_model_id = ""
        self._record_load_event(
            status="unloaded",
            model_id=self.model_id or "",
            device=self.device_preference,
            duration_seconds=0,
        )
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass
        return self.runtime_payload()

    async def probe_runtime(
        self,
        *,
        model_id: str,
        prompt: str,
        max_new_tokens: int,
        device: str,
    ) -> Dict[str, Any]:
        safe_model_id = model_id.strip() or "sshleifer/tiny-gpt2"
        safe_prompt = prompt.strip() or "The Foundry is"
        safe_tokens = max(1, min(max_new_tokens, 128))
        previous_device = self.device_preference
        started_at = time.perf_counter()

        diagnostics = self._runtime_diagnostics()
        self.device_preference = device.strip().lower() or "auto"

        try:
            tokenizer, model = await self._load_transformers_model(safe_model_id)
            load_seconds = round(time.perf_counter() - started_at, 3)
            output_text = await asyncio.to_thread(
                self._generate_probe_text_sync,
                tokenizer,
                model,
                safe_prompt,
                safe_tokens,
            )
            total_seconds = round(time.perf_counter() - started_at, 3)
            resolved_device = str(next(model.parameters()).device)

            return {
                "ok": True,
                "modelId": safe_model_id,
                "prompt": safe_prompt,
                "output": output_text,
                "device": resolved_device,
                "requestedDevice": self.device_preference,
                "loadSeconds": load_seconds,
                "totalSeconds": total_seconds,
                "maxNewTokens": safe_tokens,
                "diagnostics": self._runtime_diagnostics(diagnostics),
            }
        except Exception as error:
            return {
                "ok": False,
                "modelId": safe_model_id,
                "prompt": safe_prompt,
                "output": "",
                "device": "unavailable",
                "requestedDevice": self.device_preference,
                "loadSeconds": None,
                "totalSeconds": round(time.perf_counter() - started_at, 3),
                "maxNewTokens": safe_tokens,
                "error": str(error),
                "diagnostics": self._runtime_diagnostics(diagnostics),
            }
        finally:
            self.device_preference = previous_device

    async def stream_tokens(
        self,
        prepared_response: Dict[str, Any],
        user_message: str,
        system_prompt: Optional[str] = None,
    ) -> AsyncIterator[str]:
        if self.mode == "transformers":
            async for token in self._stream_transformers(prepared_response, user_message, system_prompt):
                yield token
            return

        async for token in self._stream_simulated(prepared_response["message"]["text"]):
            yield token

    async def _stream_simulated(self, text: str) -> AsyncIterator[str]:
        tokens = text.split(" ")
        for index, token in enumerate(tokens):
            yield token + (" " if index < len(tokens) - 1 else "")
            await asyncio.sleep(0.01)

    async def _stream_transformers(
        self,
        prepared_response: Dict[str, Any],
        user_message: str,
        system_prompt: Optional[str],
    ) -> AsyncIterator[str]:
        try:
            target_model = self.model_id or prepared_response["artifact"]["baseModel"]
            started_at = time.perf_counter()
            event_started_at = self._utc_now()
            tokenizer, model = await self._load_transformers_model(target_model)
            self._active_loaded_model_id = target_model
            self._record_load_event(
                status="loaded",
                model_id=target_model,
                device=self._device_for_model(model),
                duration_seconds=round(time.perf_counter() - started_at, 3),
                started_at=event_started_at,
            )
        except Exception as error:
            self._record_load_event(
                status="failed",
                model_id=self.model_id or prepared_response["artifact"]["baseModel"],
                device=self.device_preference,
                duration_seconds=None,
                failure_reason=str(error),
            )
            fallback = (
                "Local Transformers inference could not start, so The Foundry "
                f"fell back to the simulator. Reason: {error}"
            )
            async for token in self._stream_simulated(fallback):
                yield token
            return

        generation = prepared_response["generation"]
        prompt = self._build_prompt(prepared_response, user_message, system_prompt)

        try:
            from transformers import TextIteratorStreamer
            import torch
        except Exception as error:
            fallback = (
                "Transformers runtime is not importable in this environment. "
                f"Reason: {error}"
            )
            async for token in self._stream_simulated(fallback):
                yield token
            return

        inputs = tokenizer(prompt, return_tensors="pt")
        device = next(model.parameters()).device
        inputs = {key: value.to(device) for key, value in inputs.items()}
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

        generation_kwargs = {
            **inputs,
            "streamer": streamer,
            "max_new_tokens": generation["maxNewTokens"],
            "do_sample": generation["temperature"] > 0,
            "pad_token_id": tokenizer.eos_token_id,
        }
        if generation["temperature"] > 0:
            generation_kwargs["temperature"] = generation["temperature"]
        thread = Thread(target=model.generate, kwargs=generation_kwargs, daemon=True)
        thread.start()

        for token in streamer:
            yield token
            await asyncio.sleep(0)

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    async def _load_transformers_model(self, model_name: str):
        if model_name in self._model_cache:
            cached = self._model_cache[model_name]
            return cached["tokenizer"], cached["model"]

        async with self._load_lock:
            if model_name in self._model_cache:
                cached = self._model_cache[model_name]
                return cached["tokenizer"], cached["model"]

            tokenizer, model = await asyncio.to_thread(self._load_transformers_model_sync, model_name)
            self._model_cache[model_name] = {"tokenizer": tokenizer, "model": model}
            return tokenizer, model

    def _load_transformers_model_sync(self, model_name: str):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch

        device = self._resolve_device(torch)
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForCausalLM.from_pretrained(model_name)
        model.to(device)
        model.eval()
        return tokenizer, model

    def _preflight_model_sync(self, model_name: str) -> Dict[str, Any]:
        from transformers import AutoConfig, AutoTokenizer

        local_files_only = Path(model_name).exists()
        diagnostics = self._runtime_diagnostics()
        checks = []
        warnings = []

        config = None
        tokenizer_ok = False
        try:
            config = AutoConfig.from_pretrained(
                model_name,
                local_files_only=local_files_only,
                trust_remote_code=False,
            )
            checks.append(
                {
                    "id": "config",
                    "label": "Model config",
                    "status": "pass",
                    "detail": f"{getattr(config, 'model_type', 'unknown')} config is readable.",
                }
            )
        except Exception as error:
            checks.append(
                {
                    "id": "config",
                    "label": "Model config",
                    "status": "fail",
                    "detail": str(error),
                }
            )

        try:
            tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                local_files_only=local_files_only,
                trust_remote_code=False,
            )
            tokenizer_ok = True
            checks.append(
                {
                    "id": "tokenizer",
                    "label": "Tokenizer",
                    "status": "pass",
                    "detail": f"Tokenizer loaded with vocab size {getattr(tokenizer, 'vocab_size', 'unknown')}.",
                }
            )
        except Exception as error:
            checks.append(
                {
                    "id": "tokenizer",
                    "label": "Tokenizer",
                    "status": "fail",
                    "detail": str(error),
                }
            )

        parameter_count = self._estimate_parameter_count(config) if config else None
        estimated_bytes = self._estimate_runtime_bytes(parameter_count)
        available_bytes = self._available_runtime_bytes(diagnostics)
        memory_status = self._fit_status(estimated_bytes, available_bytes)
        if parameter_count is None:
            warnings.append("Could not estimate parameter count from config; memory fit is approximate.")
        if memory_status == "too-large":
            warnings.append("Estimated load size exceeds the conservative runtime budget for this machine.")
        elif memory_status == "tight":
            warnings.append("Estimated load size may fit, but context and generation settings should stay conservative.")

        checks.append(
            {
                "id": "memory",
                "label": "Memory fit",
                "status": "fail" if memory_status == "too-large" else "warn" if memory_status in {"tight", "unknown"} else "pass",
                "detail": self._memory_fit_detail(memory_status, estimated_bytes, available_bytes),
            }
        )

        ok = bool(config and tokenizer_ok and memory_status != "too-large")
        return {
            "ok": ok,
            "modelId": model_name,
            "device": self._resolve_device_for_preflight(diagnostics),
            "localFilesOnly": local_files_only,
            "modelType": getattr(config, "model_type", None) if config else None,
            "architectures": list(getattr(config, "architectures", None) or []) if config else [],
            "contextWindow": self._config_context_window(config) if config else None,
            "parameterCountEstimate": parameter_count,
            "estimatedLoadBytes": estimated_bytes,
            "availableBytes": available_bytes,
            "fitStatus": memory_status,
            "checks": checks,
            "warnings": warnings,
            "diagnostics": diagnostics,
        }

    def _generate_probe_text_sync(self, tokenizer, model, prompt: str, max_new_tokens: int) -> str:
        import torch

        device = next(model.parameters()).device
        inputs = tokenizer(prompt, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        generation_kwargs = {
            **inputs,
            "max_new_tokens": max_new_tokens,
            "do_sample": False,
            "pad_token_id": tokenizer.eos_token_id,
        }
        with torch.no_grad():
            output_ids = model.generate(**generation_kwargs)
        return tokenizer.decode(output_ids[0], skip_special_tokens=True)

    def _resolve_device(self, torch) -> str:
        if self.device_preference in {"cpu", "cuda", "mps"}:
            return self.device_preference
        return "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

    def _resolve_device_for_preflight(self, diagnostics: Dict[str, Any]) -> str:
        if self.device_preference in {"cpu", "cuda", "mps"}:
            return self.device_preference
        if diagnostics.get("cudaAvailable"):
            return "cuda"
        if diagnostics.get("mpsAvailable"):
            return "mps"
        return "cpu"

    def _estimate_parameter_count(self, config) -> Optional[int]:
        if config is None:
            return None
        if getattr(config, "num_parameters", None):
            try:
                return int(config.num_parameters)
            except Exception:
                pass

        hidden_size = self._first_config_int(config, "hidden_size", "n_embd", "d_model")
        layers = self._first_config_int(config, "num_hidden_layers", "n_layer", "num_layers")
        vocab_size = self._first_config_int(config, "vocab_size")
        intermediate_size = self._first_config_int(config, "intermediate_size", "n_inner", "ffn_dim")
        if not hidden_size or not layers or not vocab_size:
            return None
        if not intermediate_size:
            intermediate_size = hidden_size * 4

        embedding_params = vocab_size * hidden_size
        attention_params = layers * 4 * hidden_size * hidden_size
        mlp_params = layers * 2 * hidden_size * intermediate_size
        norm_and_heads = layers * hidden_size * 6
        return int((embedding_params + attention_params + mlp_params + norm_and_heads) * 1.08)

    def _first_config_int(self, config, *names: str) -> Optional[int]:
        for name in names:
            value = getattr(config, name, None)
            if isinstance(value, int) and value > 0:
                return value
        return None

    def _config_context_window(self, config) -> Optional[int]:
        return self._first_config_int(
            config,
            "max_position_embeddings",
            "n_positions",
            "seq_length",
            "max_sequence_length",
        )

    def _estimate_runtime_bytes(self, parameter_count: Optional[int]) -> int:
        if not parameter_count:
            return 0
        # Current local loader uses the model default dtype. Estimate fp32 plus
        # runtime overhead so the warning errs toward protecting the machine.
        return int(parameter_count * 4 * 1.25)

    def _available_runtime_bytes(self, diagnostics: Dict[str, Any]) -> int:
        try:
            import psutil

            memory = psutil.virtual_memory()
            return int(memory.available)
        except Exception:
            memory = diagnostics.get("memory") or {}
            available_gb = memory.get("availableGb") if isinstance(memory, dict) else None
            return int(float(available_gb) * (1024**3)) if available_gb else 0

    def _fit_status(self, estimated_bytes: int, available_bytes: int) -> str:
        if not estimated_bytes or not available_bytes:
            return "unknown"
        usable = int(available_bytes * 0.78)
        if estimated_bytes <= usable * 0.7:
            return "fits"
        if estimated_bytes <= usable:
            return "tight"
        return "too-large"

    def _memory_fit_detail(self, status: str, estimated_bytes: int, available_bytes: int) -> str:
        estimated = round(estimated_bytes / (1024**3), 2) if estimated_bytes else 0
        available = round(available_bytes / (1024**3), 2) if available_bytes else 0
        if status == "fits":
            return f"Estimated load is {estimated}GB with {available}GB available."
        if status == "tight":
            return f"Estimated load is {estimated}GB against {available}GB available; expect limited headroom."
        if status == "too-large":
            return f"Estimated load is {estimated}GB and exceeds the conservative budget from {available}GB available."
        return "Could not calculate a reliable memory estimate from config metadata."

    def _loaded_device(self, model_id: str) -> str:
        cached = self._model_cache.get(model_id)
        if not cached:
            return self.device_preference
        return self._device_for_model(cached.get("model"))

    def _device_for_model(self, model) -> str:
        try:
            return str(next(model.parameters()).device)
        except Exception:
            return self.device_preference

    def _record_load_event(
        self,
        *,
        status: str,
        model_id: str,
        device: str,
        duration_seconds: Optional[float],
        started_at: Optional[str] = None,
        failure_reason: Optional[str] = None,
    ) -> None:
        self._last_load_event = {
            "status": status,
            "modelId": model_id,
            "device": device,
            "durationSeconds": duration_seconds,
            "startedAt": started_at or self._utc_now(),
            "finishedAt": self._utc_now(),
            "failureReason": failure_reason,
        }

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _runtime_diagnostics(self, baseline: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        diagnostics: Dict[str, Any] = dict(baseline or {})
        try:
            import psutil

            memory = psutil.virtual_memory()
            diagnostics["memory"] = {
                "totalGb": round(memory.total / (1024**3), 2),
                "availableGb": round(memory.available / (1024**3), 2),
                "percentUsed": memory.percent,
            }
        except Exception as error:
            diagnostics["memoryError"] = str(error)

        try:
            import torch

            diagnostics.update(
                {
                    "torchVersion": torch.__version__,
                    "cudaAvailable": torch.cuda.is_available(),
                    "mpsBuilt": bool(
                        hasattr(torch.backends, "mps") and torch.backends.mps.is_built()
                    ),
                    "mpsAvailable": bool(
                        hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
                    ),
                }
            )
        except Exception as error:
            diagnostics["torchError"] = str(error)
        return diagnostics

    def _build_prompt(
        self,
        prepared_response: Dict[str, Any],
        user_message: str,
        system_prompt: Optional[str],
    ) -> str:
        artifact = prepared_response["artifact"]
        system = system_prompt or (
            "You are a Construct loaded inside The Foundry. Answer clearly and stay grounded "
            "in the active Artifact."
        )
        return (
            f"{system}\n\n"
            f"Loaded Artifact: {artifact['name']} {artifact['version']}\n"
            f"Base Model: {artifact['baseModel']}\n"
            f"Training Method: {artifact['trainingMethod']}\n\n"
            f"User: {user_message}\n"
            "Assistant:"
        )
