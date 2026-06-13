from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
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
        self._load_lock = asyncio.Lock()

    def describe_runtime(self) -> InferenceRuntime:
        model_id = self.model_id or "active Artifact base model"
        loaded = self.mode == "simulated" or bool(self._model_cache)
        if self.mode == "transformers":
            return InferenceRuntime(
                mode="transformers",
                status="loaded" if self._model_cache else "configured",
                detail="Local Transformers inference is enabled.",
                modelId=model_id,
                device=self.device_preference,
                loaded=loaded,
            )
        return InferenceRuntime(
            mode="simulated",
            status="fallback",
            detail="Using deterministic simulated token streaming.",
            modelId=model_id,
            device="none",
            loaded=True,
        )

    def runtime_payload(self) -> Dict[str, Any]:
        runtime = self.describe_runtime()
        return {
            "mode": runtime.mode,
            "status": runtime.status,
            "detail": runtime.detail,
            "modelId": runtime.modelId,
            "device": runtime.device,
            "loaded": runtime.loaded,
            "diagnostics": self._runtime_diagnostics(),
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
            return self.runtime_payload()

        target_model = self.model_id
        if not target_model:
            raise ValueError("Set a model id before loading the Transformers runtime.")
        await self._load_transformers_model(target_model)
        return self.runtime_payload()

    async def unload(self) -> Dict[str, Any]:
        self._model_cache.clear()
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
            tokenizer, model = await self._load_transformers_model(
                self.model_id or prepared_response["artifact"]["baseModel"]
            )
        except Exception as error:
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
            "temperature": generation["temperature"],
            "do_sample": generation["temperature"] > 0,
        }
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
