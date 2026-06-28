from __future__ import annotations

import json
import os
import platform
import re
from collections.abc import Callable
from datetime import datetime, timezone
from dataclasses import dataclass, field
from hashlib import sha256
from importlib.util import find_spec
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

import psutil

from .qa_quality_service import QAQualityEvaluator

QA_GENERATION_CONTRACT_VERSION = "foundry.qa-generation.v1"
QA_PROMPT_TEMPLATE_VERSION = "foundry.qa-prompt.source-context.v3"
BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_QA_MODEL_ARCHIVE_DIR = BASE_DIR / "runtime" / "models" / "huggingface"
SMOKE_QA_GENERATOR_MODEL_ID = "sshleifer/tiny-gpt2"
QUALITY_QA_GENERATOR_MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_QA_GENERATOR_MODEL_ID = QUALITY_QA_GENERATOR_MODEL_ID
QA_TYPE_SEQUENCE = (
    "factual",
    "behavior",
    "style",
    "cause-effect",
    "correction",
    "safety-boundary",
)
QA_TYPE_GUIDANCE = {
    "factual": "Ask for a concrete fact that is explicitly stated in the source.",
    "behavior": "Ask how the target model should act or respond when the source situation appears.",
    "style": "Ask about voice, tone, phrasing, or persona cues grounded in the source.",
    "cause-effect": "Ask why one source detail affects another source detail or target behavior.",
    "correction": "Ask for a misconception the source can correct without inventing new facts.",
    "safety-boundary": "Ask what boundary, constraint, or uncertainty the model should preserve.",
}


@dataclass(frozen=True)
class QAGenerationRequest:
    material_name: str
    material_kind: str
    chunk_id: str
    chunk_text: str
    qa_pair_count: int
    workshop_subject: str = ""
    voice_target: str = ""
    source_metadata: Dict[str, Any] = field(default_factory=dict)


class QAGenerationService:
    """Generates draft QA rows from source chunks behind a swappable model boundary."""

    def __init__(self) -> None:
        self.mode = os.getenv("FOUNDRY_QA_GENERATOR_MODE", "deterministic").strip().lower()
        self.model_id = os.getenv("FOUNDRY_QA_GENERATOR_MODEL", DEFAULT_QA_GENERATOR_MODEL_ID).strip()
        self.max_new_tokens = int(os.getenv("FOUNDRY_QA_GENERATOR_MAX_NEW_TOKENS", "320"))
        self.temperature = float(os.getenv("FOUNDRY_QA_GENERATOR_TEMPERATURE", "0.2"))
        self.quality_evaluator = QAQualityEvaluator()
        self._model_text_backend: Callable[[str, bool], str] | None = None

    def runtime_payload(self) -> Dict[str, Any]:
        transformers_available = self._transformers_available()
        ready = self.mode == "deterministic" or transformers_available
        selection = self.selection_plan(
            mode=self.mode,
            model_id=self.model_id,
            max_new_tokens=self.max_new_tokens,
        )
        return {
            "mode": self.mode,
            "modelId": self.model_id,
            "maxNewTokens": self.max_new_tokens,
            "temperature": self.temperature,
            "ready": ready,
            "status": "ready" if ready else "blocked",
            "detail": self._runtime_detail(transformers_available),
            "dependencies": {
                "transformers": transformers_available,
            },
            "platform": selection["platform"],
            "selection": selection,
            "contractVersion": "foundry.qa-generator.runtime.v1",
        }

    def configure(
        self,
        *,
        mode: str,
        model_id: str,
        max_new_tokens: int,
        temperature: float,
    ) -> Dict[str, Any]:
        normalized_mode = mode.strip().lower()
        if normalized_mode not in {"deterministic", "transformers", "local"}:
            raise ValueError("QA generator mode must be deterministic or transformers.")
        self.mode = "transformers" if normalized_mode == "local" else normalized_mode
        self.model_id = model_id.strip() or DEFAULT_QA_GENERATOR_MODEL_ID
        self.max_new_tokens = max(24, min(2048, int(max_new_tokens)))
        self.temperature = max(0.0, min(1.5, float(temperature)))
        return self.runtime_payload()

    def preflight(
        self,
        *,
        mode: str | None = None,
        model_id: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ) -> Dict[str, Any]:
        normalized_mode = (mode or self.mode).strip().lower()
        if normalized_mode == "local":
            normalized_mode = "transformers"
        target_model_id = (model_id or self.model_id or DEFAULT_QA_GENERATOR_MODEL_ID).strip()
        target_max_tokens = max(24, min(2048, int(max_new_tokens or self.max_new_tokens)))
        target_temperature = max(0.0, min(1.5, float(self.temperature if temperature is None else temperature)))

        if normalized_mode == "deterministic":
            selection = self.selection_plan(
                mode="deterministic",
                model_id=target_model_id,
                max_new_tokens=target_max_tokens,
            )
            checks = [
                self._preflight_check(
                    "runtime-mode",
                    "Runtime mode",
                    "pass",
                    "Deterministic mode is available without model dependencies.",
                )
            ]
            return {
                "ok": True,
                "status": "ready",
                "title": "Deterministic QA generator ready",
                "summary": "Smoke-test QA generation can run offline.",
                "nextAction": "Run Smoke proof or start the Assembly Line.",
                "mode": "deterministic",
                "modelId": target_model_id,
                "maxNewTokens": target_max_tokens,
                "temperature": target_temperature,
                "checks": checks,
                "warnings": [],
                "memory": self._qa_memory_estimate(None),
                "platform": selection["platform"],
                "selection": selection,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "contractVersion": "foundry.qa-generator.preflight.v1",
            }

        transformers_available = self._transformers_available()
        model_probe = self._qa_model_probe(target_model_id)
        memory = self._qa_memory_estimate(model_probe.get("path"))
        selection = self.selection_plan(
            mode="transformers",
            model_id=target_model_id,
            max_new_tokens=target_max_tokens,
            model_probe=model_probe,
            memory=memory,
        )
        checks = [
            self._preflight_check(
                "runtime-mode",
                "Runtime mode",
                "pass" if normalized_mode == "transformers" else "fail",
                "Local Transformers mode selected."
                if normalized_mode == "transformers"
                else "Choose Deterministic smoke or Local Transformers.",
            ),
            self._preflight_check(
                "dependencies",
                "Transformers dependency",
                "pass" if transformers_available else "fail",
                "Transformers is importable."
                if transformers_available
                else "Install optional ML dependencies with requirements-ml.txt.",
            ),
            self._preflight_check(
                "archive-cache",
                "Local model cache",
                "pass" if model_probe["cached"] else "fail",
                model_probe["message"],
            ),
            self._preflight_check(
                "memory-fit",
                "Memory fit",
                memory["checkStatus"],
                memory["message"],
            ),
        ]
        failed = [check for check in checks if check["status"] == "fail"]
        warned = [check for check in checks if check["status"] == "warn"]
        status = "blocked" if failed else "caution" if warned else "ready"
        warnings = [check["detail"] for check in checks if check["status"] in {"warn", "fail"}]
        return {
            "ok": not failed,
            "status": status,
            "title": (
                "Local QA generator ready"
                if status == "ready"
                else "Local QA generator needs review"
                if status == "caution"
                else "Local QA generator blocked"
            ),
            "summary": (
                "Cached model and dependencies are ready for model-backed QA generation."
                if status == "ready"
                else "Review warnings before using this model for QA generation."
                if status == "caution"
                else "Fix blocked checks before switching to Local Transformers QA generation."
            ),
            "nextAction": (
                "Configure Local Transformers, then run Quality proof."
                if status != "blocked"
                else "Install dependencies and cache the model in the Archive first."
            ),
            "mode": "transformers",
            "modelId": target_model_id,
            "maxNewTokens": target_max_tokens,
            "temperature": target_temperature,
            "model": model_probe,
            "memory": memory,
            "platform": selection["platform"],
            "selection": selection,
            "checks": checks,
            "warnings": warnings,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "contractVersion": "foundry.qa-generator.preflight.v1",
        }

    def selection_plan(
        self,
        *,
        mode: str | None = None,
        model_id: str | None = None,
        max_new_tokens: int | None = None,
        model_probe: Dict[str, Any] | None = None,
        memory: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        normalized_mode = (mode or self.mode).strip().lower()
        if normalized_mode == "local":
            normalized_mode = "transformers"
        target_model_id = (model_id or self.model_id or DEFAULT_QA_GENERATOR_MODEL_ID).strip()
        target_max_tokens = max(24, min(2048, int(max_new_tokens or self.max_new_tokens)))
        platform_profile = self._platform_profile()
        transformers_available = self._transformers_available()
        endpoint_url = os.getenv("FOUNDRY_QA_GENERATOR_ENDPOINT_URL", "").strip()
        probe = model_probe if model_probe is not None else self._qa_model_probe(target_model_id)
        memory_estimate = memory if memory is not None else self._qa_memory_estimate(probe.get("path"))

        tiers = [
            self._qa_tier(
                tier=0,
                label="Deterministic offline fallback",
                provider="deterministic",
                mode="deterministic",
                model_id="deterministic-context-generator",
                status="ready",
                fit_status="fits",
                quality="smoke",
                speed="fast",
                reason="Always available for smoke tests, demos, CI, and no-download first-run workflows.",
                next_action="Use for baseline validation, then switch to a model-backed tier for training data.",
            ),
            self._qa_tier(
                tier=1,
                label="Small cached local model",
                provider="transformers",
                mode="transformers",
                model_id=target_model_id,
                status=(
                    "ready"
                    if transformers_available and probe.get("cached") and memory_estimate.get("fitStatus") in {"fits", "tight", "unknown"}
                    else "blocked"
                ),
                fit_status=str(memory_estimate.get("fitStatus") or "unknown"),
                quality="modest",
                speed=self._latency_class(platform_profile, small_model=True),
                reason=(
                    "Configured model is cached and can run locally."
                    if transformers_available and probe.get("cached")
                    else "Requires optional Transformers dependencies and a cached local model."
                ),
                next_action=(
                    "Run Quality proof with the cached model."
                    if transformers_available and probe.get("cached")
                    else "Cache a small instruction model in Archive, then preflight again."
                ),
            ),
            self._qa_tier(
                tier=2,
                label="Stronger local model",
                provider="transformers",
                mode="transformers",
                model_id=target_model_id,
                status=(
                    "candidate"
                    if platform_profile["accelerator"] in {"cuda", "mps"} and platform_profile["availableMemoryBytes"] >= 12 * 1024**3
                    else "blocked"
                ),
                fit_status=str(memory_estimate.get("fitStatus") or "unknown"),
                quality="higher",
                speed=self._latency_class(platform_profile, small_model=False),
                reason=(
                    "This machine has accelerator headroom for a stronger local QA generator if one is cached."
                    if platform_profile["accelerator"] in {"cuda", "mps"}
                    else "No CUDA or Apple Metal runtime was detected for a stronger local generator."
                ),
                next_action="Choose and cache a stronger instruction model, then preflight it before use.",
            ),
            self._qa_tier(
                tier=3,
                label="User-provided inference endpoint",
                provider="openai-compatible-endpoint",
                mode="endpoint",
                model_id=target_model_id,
                status="candidate" if endpoint_url else "not-configured",
                fit_status="external",
                quality="user-selected",
                speed="endpoint-dependent",
                reason=(
                    "Endpoint URL is configured; The Foundry can route future QA generation through it."
                    if endpoint_url
                    else "Optional endpoint tier for Ollama, LM Studio, vLLM, local Transformers servers, or OpenAI-compatible servers."
                ),
                next_action=(
                    "Validate endpoint health before enabling endpoint generation."
                    if endpoint_url
                    else "Set FOUNDRY_QA_GENERATOR_ENDPOINT_URL when endpoint adapters are enabled."
                ),
            ),
        ]
        selected = self._select_qa_tier(normalized_mode, tiers)
        return {
            "contractVersion": "foundry.qa-generator.selection.v1",
            "selectedTier": selected["tier"],
            "selectedProvider": selected["provider"],
            "selectedMode": selected["mode"],
            "selectedModelId": selected["modelId"],
            "qualityPreference": os.getenv("FOUNDRY_QA_GENERATOR_QUALITY_PREFERENCE", "balanced").strip() or "balanced",
            "contextWindowRequirement": self._context_window_requirement(target_max_tokens),
            "fallbackPolicy": "fall back to deterministic rows with fallbackReason metadata; block fallback rows from default export",
            "tiers": tiers,
            "platform": platform_profile,
        }

    def set_model_text_backend(
        self,
        backend: Callable[[str, bool], str] | None,
    ) -> None:
        """Inject a text-generation backend while preserving the public QA contract."""
        self._model_text_backend = backend

    def smoke_proof(self) -> Dict[str, Any]:
        request = self._proof_request()
        rows = self.generate(request)
        public_rows = [self._public_row(row) for row in rows]
        generator_model = rows[0].get("generator_model") if rows else None
        metadata = rows[0].get("generation_metadata", {}) if rows else {}
        fallback_reason = metadata.get("fallbackReason") if isinstance(metadata, dict) else None
        status = "passed" if rows else "failed"
        if fallback_reason:
            status = "warning"
        return {
            "contractVersion": "foundry.qa-generator.smoke-proof.v1",
            "status": status,
            "runtime": self.runtime_payload(),
            "request": {
                "materialName": request.material_name,
                "materialKind": request.material_kind,
                "chunkId": request.chunk_id,
                "qaPairCount": request.qa_pair_count,
            },
            "rows": public_rows,
            "summary": self._smoke_summary(status, generator_model, fallback_reason),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    def quality_proof(self) -> Dict[str, Any]:
        request = self._proof_request()
        deterministic_service = QAGenerationService()
        deterministic_service.configure(
            mode="deterministic",
            model_id=self.model_id,
            max_new_tokens=self.max_new_tokens,
            temperature=self.temperature,
        )
        deterministic_rows = deterministic_service.generate(request)
        deterministic_result = self._quality_proof_result(
            label="Deterministic smoke",
            status="passed" if deterministic_rows else "failed",
            rows=deterministic_rows,
            source_text=request.chunk_text,
        )

        model_service = QAGenerationService()
        model_service.set_model_text_backend(self._model_text_backend)
        model_service.configure(
            mode="transformers",
            model_id=self.model_id,
            max_new_tokens=min(self.max_new_tokens, 160),
            temperature=self.temperature,
        )
        model_preflight = self.preflight(
            mode="transformers",
            model_id=self.model_id,
            max_new_tokens=min(self.max_new_tokens, 160),
            temperature=self.temperature,
        )
        if not model_preflight["ok"]:
            model_result = self._quality_proof_result(
                label="Cached local model",
                status="warning",
                rows=[],
                source_text=request.chunk_text,
                detail=(
                    "Backend model proof is blocked until preflight passes: "
                    f"{model_preflight['summary']}"
                ),
                proof_source="backend-local-model",
                local_files_only=True,
                preflight_status=str(model_preflight["status"]),
            )
        else:
            try:
                model_rows = model_service._generate_with_transformers(
                    request,
                    local_files_only=True,
                )
                model_result = self._quality_proof_result(
                    label="Cached local model",
                    status="passed" if model_rows else "warning",
                    rows=model_rows,
                    source_text=request.chunk_text,
                    detail=(
                        "Backend cached local model generated a parseable QA row."
                        if model_rows
                        else "Backend cached local model responded, but did not return parseable QA JSON."
                    ),
                    proof_source="backend-local-model",
                    local_files_only=True,
                    preflight_status=str(model_preflight["status"]),
                )
            except Exception as error:
                model_result = self._quality_proof_result(
                    label="Cached local model",
                    status="warning",
                    rows=[],
                    source_text=request.chunk_text,
                    detail=(
                        "Backend cached model proof could not run without downloading or loading "
                        f"the configured model: {type(error).__name__}: {error}"
                    ),
                    proof_source="backend-local-model",
                    local_files_only=True,
                    preflight_status=str(model_preflight["status"]),
                )

        results = [deterministic_result, model_result]
        return {
            "contractVersion": "foundry.qa-generator.quality-proof.v1",
            "runtime": self.runtime_payload(),
            "proofMode": {
                "source": "backend",
                "mode": self.mode,
                "modelId": self.model_id,
                "localFilesOnly": True,
                "simulated": False,
                "preflightStatus": model_preflight["status"],
                "modelCached": bool((model_preflight.get("model") or {}).get("cached")),
                "modelPath": (model_preflight.get("model") or {}).get("path"),
            },
            "request": {
                "materialName": request.material_name,
                "materialKind": request.material_kind,
                "chunkId": request.chunk_id,
                "qaPairCount": request.qa_pair_count,
            },
            "sourceText": request.chunk_text,
            "results": results,
            "recommendation": self._quality_proof_recommendation(results),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    def generate(self, request: QAGenerationRequest) -> List[Dict[str, Any]]:
        if self.mode in {"transformers", "local"}:
            try:
                rows = self._generate_with_transformers(request)
                if rows:
                    return rows
            except Exception as error:
                # Assembly Lines should still produce reviewable draft rows when the
                # optional generator model is unavailable. Metadata records fallback.
                return self._generate_deterministic(
                    request,
                    fallback_reason=f"{type(error).__name__}: {error}",
                    requested_model_id=self.model_id,
                )
        return self._generate_deterministic(request)

    def _generate_with_transformers(
        self,
        request: QAGenerationRequest,
        local_files_only: bool = False,
    ) -> List[Dict[str, Any]]:
        prompt = self._prompt(request)
        output = self._generate_model_text(prompt, local_files_only=local_files_only)
        parsed = self._parse_model_rows(output)
        rows = []
        for index, row in enumerate(parsed[: request.qa_pair_count]):
            question = str(row.get("question", "")).strip()
            answer = str(row.get("answer", "")).strip()
            if not question or not answer:
                continue
            qa_type = self._normalize_qa_type(str(row.get("qaType") or row.get("type") or ""))
            rows.append(
                self._row(
                    request=request,
                    question=question,
                    answer=answer,
                    confidence=float(row.get("confidence", 0.72) or 0.72),
                    strategy="model-json",
                    model_id=self.model_id,
                    row_index=index,
                    qa_type=qa_type or self._qa_type_for_index(index),
                )
            )
        return rows

    def _generate_model_text(self, prompt: str, *, local_files_only: bool = False) -> str:
        if self._model_text_backend:
            return self._model_text_backend(prompt, local_files_only)

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        model_reference = self._model_load_reference(local_files_only=local_files_only)
        tokenizer = AutoTokenizer.from_pretrained(
            model_reference,
            local_files_only=local_files_only,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_reference,
            local_files_only=local_files_only,
        )
        model.eval()
        prepared_prompt = self._prepare_model_prompt(tokenizer, prompt)
        model_inputs = tokenizer([prepared_prompt], return_tensors="pt")
        generation_kwargs: Dict[str, Any] = {
            **model_inputs,
            "max_new_tokens": self.max_new_tokens,
            "do_sample": self.temperature > 0,
            "pad_token_id": tokenizer.pad_token_id or tokenizer.eos_token_id,
        }
        if self.temperature > 0:
            generation_kwargs["temperature"] = self.temperature
        with torch.no_grad():
            output_ids = model.generate(**generation_kwargs)
        prompt_length = model_inputs["input_ids"].shape[-1]
        generated_ids = output_ids[0][prompt_length:]
        return tokenizer.decode(generated_ids, skip_special_tokens=True)

    def _prepare_model_prompt(self, tokenizer: Any, prompt: str) -> str:
        if getattr(tokenizer, "chat_template", None) and hasattr(tokenizer, "apply_chat_template"):
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are The Foundry QA generator. Return only a valid JSON "
                        "array. Do not use markdown fences or commentary."
                    ),
                },
                {"role": "user", "content": prompt},
            ]
            return str(
                tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            )
        return prompt

    def _model_load_reference(self, *, local_files_only: bool) -> str:
        if local_files_only:
            probe = self._qa_model_probe(self.model_id)
            if probe.get("cached") and probe.get("path"):
                return str(probe["path"])
        return self.model_id

    def _generate_deterministic(
        self,
        request: QAGenerationRequest,
        fallback_reason: str | None = None,
        requested_model_id: str | None = None,
    ) -> List[Dict[str, Any]]:
        compact = " ".join(request.chunk_text.split())
        sentences = self._sentences(compact)
        key_terms = self._key_terms(compact)
        rows = []
        for index in range(max(1, request.qa_pair_count)):
            qa_type = self._qa_type_for_index(index)
            answer = sentences[index % len(sentences)] if sentences else compact[:800]
            term = key_terms[index % len(key_terms)] if key_terms else "this source"
            question = self._deterministic_question(request, term, qa_type)
            rows.append(
                self._row(
                    request=request,
                    question=question,
                    answer=answer[:900],
                    confidence=self._deterministic_confidence(answer, key_terms),
                    strategy="context-sentence",
                    model_id="deterministic-context-generator",
                    row_index=index,
                    qa_type=qa_type,
                    fallback_reason=fallback_reason,
                    requested_model_id=requested_model_id,
                )
            )
        return rows

    def _row(
        self,
        *,
        request: QAGenerationRequest,
        question: str,
        answer: str,
        confidence: float,
        strategy: str,
        model_id: str,
        row_index: int,
        qa_type: str,
        fallback_reason: str | None = None,
        requested_model_id: str | None = None,
    ) -> Dict[str, Any]:
        prompt = self._prompt(request)
        compact_source = " ".join(request.chunk_text.split())
        source_metadata = request.source_metadata if isinstance(request.source_metadata, dict) else {}
        source_reference = source_metadata.get("source") if isinstance(source_metadata.get("source"), dict) else {}
        source_location = (
            source_metadata.get("sourceLocation")
            if isinstance(source_metadata.get("sourceLocation"), dict)
            else {}
        )
        metadata = {
            "contractVersion": QA_GENERATION_CONTRACT_VERSION,
            "mode": self.mode,
            "modelId": model_id,
            "strategy": strategy,
            "qaType": qa_type,
            "rowIndex": row_index,
            "prompt": {
                "templateVersion": QA_PROMPT_TEMPLATE_VERSION,
                "fingerprint": sha256(prompt.encode("utf-8")).hexdigest()[:16],
                "maxContextCharacters": 4000,
                "requestedRows": request.qa_pair_count,
                "requestedQaTypes": [
                    self._qa_type_for_index(index)
                    for index in range(max(1, request.qa_pair_count))
                ],
                "qualityTargets": {
                    "groundedOnly": True,
                    "avoidTrivialQuestions": True,
                    "answerMustBeSupportedBySource": True,
                    "preferCoverageAcrossDefinitionsProceduresComparisonsConstraints": True,
                },
            },
            "source": {
                "chunkId": request.chunk_id,
                "materialName": request.material_name,
                "materialKind": request.material_kind,
                "workshopSubject": request.workshop_subject,
                "voiceTarget": request.voice_target,
                "characterCount": len(request.chunk_text),
                "tokenEstimate": len(request.chunk_text.split()),
                "fingerprint": sha256(compact_source.encode("utf-8")).hexdigest()[:16],
                "materialId": source_reference.get("materialId"),
                "sourceTitle": source_reference.get("sourceTitle"),
                "sourceUri": source_reference.get("sourceUri"),
                "sourceLocation": source_location,
                "chunkFingerprint": source_metadata.get("fingerprint"),
                "chunkIndex": source_location.get("chunkIndex"),
            },
            "qaTypeGuidance": QA_TYPE_GUIDANCE.get(qa_type, ""),
        }
        if source_metadata:
            metadata["sourceMetadata"] = source_metadata
        if fallback_reason:
            metadata["fallbackReason"] = fallback_reason
            metadata["requestedModelId"] = requested_model_id
        return {
            "id": f"qa-{uuid4().hex[:12]}",
            "chunk_id": request.chunk_id,
            "question": question,
            "answer": answer,
            "generator_model": model_id,
            "confidence": round(max(0.0, min(1.0, confidence)), 2),
            "generation_metadata": metadata,
        }

    def _prompt(self, request: QAGenerationRequest) -> str:
        subject = request.workshop_subject or "the Workshop subject"
        voice_target = request.voice_target or "the target behavior"
        requested_types = [
            self._qa_type_for_index(index)
            for index in range(max(1, request.qa_pair_count))
        ]
        requested_type_text = ", ".join(requested_types)
        type_guidance = "\n".join(
            f"- {qa_type}: {QA_TYPE_GUIDANCE[qa_type]}"
            for qa_type in QA_TYPE_SEQUENCE
        )
        return (
            "You are The Foundry QA generator. Create high quality, grounded "
            "instruction-tuning examples from the source context. The examples "
            "should help a learner understand why source quality matters while "
            "also producing rows that can become training Material after human "
            "review.\n\n"
            "Return only JSON as an array of objects. Each object must contain "
            "question, answer, confidence, and qaType fields. Use concise answers "
            "grounded only in the source. Do not invent facts. Avoid trivial "
            "questions whose answer is obvious from a single copied phrase. Each "
            "answer must be complete enough to train from, but it must stay within "
            "the source evidence.\n\n"
            "QA type guidance:\n"
            f"{type_guidance}\n\n"
            f"Prompt template: {QA_PROMPT_TEMPLATE_VERSION}\n"
            f"Workshop subject: {subject}\n"
            f"Target voice/persona: {voice_target}\n"
            f"Material: {request.material_name}\n"
            f"Material kind: {request.material_kind}\n"
            f"Requested rows: {request.qa_pair_count}\n"
            f"Requested qaType sequence: {requested_type_text}\n"
            "Quality checklist: factual correctness, source grounding, clear question, "
            "complete answer, low duplication, no unsupported claims, useful coverage "
            "of definitions, procedures, comparisons, constraints, edge cases, examples, "
            "cause/effect, troubleshooting, or domain terminology when present.\n"
            f"Source context:\n{request.chunk_text[:4000]}\n"
        )

    def _qa_type_for_index(self, index: int) -> str:
        return QA_TYPE_SEQUENCE[index % len(QA_TYPE_SEQUENCE)]

    def _normalize_qa_type(self, value: str) -> str:
        normalized = value.strip().lower().replace("_", "-")
        aliases = {
            "fact": "factual",
            "facts": "factual",
            "persona": "style",
            "character": "behavior",
            "causal": "cause-effect",
            "cause": "cause-effect",
            "safety": "safety-boundary",
            "boundary": "safety-boundary",
        }
        normalized = aliases.get(normalized, normalized)
        return normalized if normalized in QA_TYPE_SEQUENCE else ""

    def _deterministic_question(
        self,
        request: QAGenerationRequest,
        term: str,
        qa_type: str,
    ) -> str:
        subject = request.workshop_subject or request.material_name
        voice_target = request.voice_target or "the model"
        templates = {
            "factual": f"What fact about {term} should the model learn from {request.material_name}?",
            "behavior": f"How should {voice_target} behave when {term} appears in {subject} source material?",
            "style": f"What style or voice cue should {voice_target} learn from the source context about {term}?",
            "cause-effect": f"Why does {term} matter for the target behavior in {subject}?",
            "correction": f"What misconception about {term} should the training data correct?",
            "safety-boundary": f"What grounded boundary should the model keep when answering about {term}?",
        }
        return templates.get(
            qa_type,
            f"What should a model learn about {term} from {request.material_name}?",
        )

    def _parse_model_rows(self, value: str) -> List[Dict[str, Any]]:
        stripped = value.strip()
        candidates = [stripped]
        match = re.search(r"(\[[\s\S]*\])", stripped)
        if match:
            candidates.insert(0, match.group(1))
        for candidate in candidates:
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, list):
                return [row for row in parsed if isinstance(row, dict)]
            if isinstance(parsed, dict):
                return [parsed]
        return []

    def _sentences(self, text: str) -> List[str]:
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", text)
            if len(sentence.strip()) > 12
        ]
        return sentences or ([text[:900]] if text else [])

    def _key_terms(self, text: str) -> List[str]:
        words = re.findall(r"[A-Za-z][A-Za-z0-9'-]{3,}", text)
        stop_words = {
            "about",
            "after",
            "from",
            "have",
            "into",
            "that",
            "their",
            "there",
            "this",
            "with",
            "would",
        }
        counts: Dict[str, int] = {}
        display: Dict[str, str] = {}
        for word in words:
            key = word.lower()
            if key in stop_words:
                continue
            counts[key] = counts.get(key, 0) + 1
            display.setdefault(key, word)
        ranked = sorted(counts, key=lambda key: (-counts[key], key))
        return [display[key] for key in ranked[:8]]

    def _deterministic_confidence(self, answer: str, key_terms: List[str]) -> float:
        if len(answer.split()) < 6:
            return 0.45
        if key_terms:
            return 0.68
        return 0.58

    def _proof_request(self) -> QAGenerationRequest:
        return QAGenerationRequest(
            material_name="Foundry QA Proof Material",
            material_kind="text",
            chunk_id=f"chk-proof-{uuid4().hex[:8]}",
            chunk_text=(
                "Marshall is a Dalmatian fire pup from Adventure Bay. He drives a "
                "fire truck, uses a water cannon, and helps the Paw Patrol during "
                "fire and medical emergencies. Marshall is brave and energetic, and "
                "he often recovers from clumsy moments by focusing on helping others."
            ),
            qa_pair_count=1,
            workshop_subject="Paw Patrol rescue behavior",
            voice_target="Marshall",
        )

    def _quality_proof_result(
        self,
        *,
        label: str,
        status: str,
        rows: List[Dict[str, Any]],
        source_text: str,
        detail: str | None = None,
        proof_source: str | None = None,
        local_files_only: bool | None = None,
        preflight_status: str | None = None,
    ) -> Dict[str, Any]:
        public_rows = [self._public_row(row) for row in rows]
        quality = self._score_quality(rows[0], source_text) if rows else self.quality_evaluator.empty()
        result = {
            "label": label,
            "status": status,
            "detail": detail or self._quality_detail(status, quality),
            "rows": public_rows,
            "quality": quality,
        }
        if proof_source:
            result["proofSource"] = proof_source
        if local_files_only is not None:
            result["localFilesOnly"] = local_files_only
        if preflight_status:
            result["preflightStatus"] = preflight_status
        return result

    def _score_quality(self, row: Dict[str, Any], source_text: str) -> Dict[str, Any]:
        question = str(row.get("question", ""))
        answer = str(row.get("answer", ""))
        confidence = float(row.get("confidence", 0) or 0)
        metadata = row.get("generation_metadata", {})
        return self.quality_evaluator.evaluate(
            question=question,
            answer=answer,
            source_text=source_text,
            confidence=confidence,
            generation_metadata=metadata if isinstance(metadata, dict) else {},
        )

    def _quality_detail(self, status: str, quality: Dict[str, Any]) -> str:
        if status == "passed":
            return f"Generated a QA row with a {quality['score']:.0%} proof score."
        if status == "warning":
            return "Generated output needs review before it can become training Material."
        return "No QA row was generated."

    def _quality_proof_recommendation(self, results: List[Dict[str, Any]]) -> str:
        model_result = next(
            (result for result in results if result["label"] == "Cached local model"),
            None,
        )
        if model_result and model_result["status"] == "passed":
            return "Compare the model row against the deterministic row, then promote the stronger generator for real Materials."
        return "Cache a tiny generator model first, then rerun the proof to compare model-aware QA against deterministic drafts."

    def _runtime_detail(self, transformers_available: bool) -> str:
        if self.mode == "deterministic":
            return "Using the offline deterministic QA generator for fast smoke tests."
        if transformers_available:
            return f"Transformers QA generator is configured for {self.model_id}."
        return "Transformers is not importable, so generation will fall back to deterministic drafts."

    def _transformers_available(self) -> bool:
        return self._model_text_backend is not None or find_spec("transformers") is not None

    def _preflight_check(
        self,
        check_id: str,
        label: str,
        status: str,
        detail: str,
    ) -> Dict[str, str]:
        return {
            "id": check_id,
            "label": label,
            "status": status,
            "detail": detail,
        }

    def _platform_profile(self) -> Dict[str, Any]:
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
        }

    def _qa_tier(
        self,
        *,
        tier: int,
        label: str,
        provider: str,
        mode: str,
        model_id: str,
        status: str,
        fit_status: str,
        quality: str,
        speed: str,
        reason: str,
        next_action: str,
    ) -> Dict[str, Any]:
        return {
            "tier": tier,
            "label": label,
            "provider": provider,
            "mode": mode,
            "modelId": model_id,
            "status": status,
            "fitStatus": fit_status,
            "quality": quality,
            "speed": speed,
            "reason": reason,
            "nextAction": next_action,
        }

    def _select_qa_tier(self, mode: str, tiers: List[Dict[str, Any]]) -> Dict[str, Any]:
        if mode == "deterministic":
            return tiers[0]
        if mode == "transformers":
            for tier in tiers:
                if tier["tier"] == 1 and tier["status"] == "ready":
                    return tier
            return tiers[0]
        if mode == "endpoint":
            for tier in tiers:
                if tier["tier"] == 3 and tier["status"] == "candidate":
                    return tier
        return tiers[0]

    def _latency_class(self, platform_profile: Dict[str, Any], *, small_model: bool) -> str:
        accelerator = platform_profile.get("accelerator")
        if accelerator in {"cuda", "mps"}:
            return "interactive" if small_model else "moderate"
        return "moderate" if small_model else "slow"

    def _context_window_requirement(self, max_new_tokens: int) -> Dict[str, Any]:
        prompt_context_tokens = 2048
        estimated_required_context = prompt_context_tokens + max_new_tokens
        return {
            "promptContextTokens": prompt_context_tokens,
            "maxNewTokens": max_new_tokens,
            "estimatedRequiredContextTokens": estimated_required_context,
            "reason": (
                "QA generation currently caps source context at roughly 4,000 characters; "
                "future model tiers should prefer at least this context plus requested output tokens."
            ),
        }

    def _qa_model_probe(self, model_id: str) -> Dict[str, Any]:
        direct_path = Path(model_id).expanduser()
        if direct_path.exists():
            size = self._directory_size(direct_path) if direct_path.is_dir() else direct_path.stat().st_size
            return {
                "modelId": model_id,
                "path": str(direct_path),
                "cached": True,
                "sizeOnDiskBytes": size,
                "message": "Generator model path exists locally.",
            }
        archive_path = DEFAULT_QA_MODEL_ARCHIVE_DIR / self._safe_archive_slug(model_id)
        if archive_path.exists():
            return {
                "modelId": model_id,
                "path": str(archive_path),
                "cached": True,
                "sizeOnDiskBytes": self._directory_size(archive_path),
                "message": "Generator model is cached in the local Archive.",
            }
        revisioned_archive_path = self._find_revisioned_archive_path(model_id)
        if revisioned_archive_path:
            return {
                "modelId": model_id,
                "path": str(revisioned_archive_path),
                "cached": True,
                "sizeOnDiskBytes": self._directory_size(revisioned_archive_path),
                "message": "Generator model is cached in the local Archive with a pinned revision.",
            }
        return {
            "modelId": model_id,
            "path": None,
            "cached": False,
            "sizeOnDiskBytes": 0,
            "message": "Generator model is not cached locally; use Archive search/download first.",
        }

    def _find_revisioned_archive_path(self, model_id: str) -> Path | None:
        archive_root = DEFAULT_QA_MODEL_ARCHIVE_DIR
        if not archive_root.exists():
            return None
        slug_prefix = f"{self._safe_archive_slug(model_id)}-"
        candidates = [
            path
            for path in archive_root.iterdir()
            if path.is_dir() and path.name.startswith(slug_prefix)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda path: path.stat().st_mtime)

    def _safe_archive_slug(self, model_id: str) -> str:
        return re.sub(r"[^A-Za-z0-9._-]+", "-", model_id.strip()).strip("-") or "model"

    def _directory_size(self, path: Path) -> int:
        total = 0
        if not path.exists():
            return total
        if path.is_file():
            return path.stat().st_size
        for item in path.rglob("*"):
            if item.is_file():
                try:
                    total += item.stat().st_size
                except OSError:
                    continue
        return total

    def _available_memory_bytes(self) -> int:
        try:
            import psutil

            return int(psutil.virtual_memory().available)
        except Exception:
            return 0

    def _qa_memory_estimate(self, model_path: str | None) -> Dict[str, Any]:
        available = self._available_memory_bytes()
        model_size = self._directory_size(Path(model_path)) if model_path else 0
        estimated = int(max(model_size * 2.0, 512 * 1024 * 1024 if model_path else 0))
        if not model_path:
            status = "unknown"
            check_status = "warn"
            message = "Memory fit will be checked after the generator model is cached."
        elif available <= 0:
            status = "unknown"
            check_status = "warn"
            message = "System memory could not be measured; monitor memory during QA generation."
        elif estimated <= available * 0.5:
            status = "fits"
            check_status = "pass"
            message = "Estimated QA generator load fits the conservative local budget."
        elif estimated <= available * 0.8:
            status = "tight"
            check_status = "warn"
            message = "Estimated QA generator load is tight; close other workloads first."
        else:
            status = "too-large"
            check_status = "fail"
            message = "Estimated QA generator load exceeds the conservative local budget."
        return {
            "fitStatus": status,
            "checkStatus": check_status,
            "estimatedLoadBytes": estimated,
            "availableBytes": available,
            "message": message,
        }

    def _smoke_summary(
        self,
        status: str,
        generator_model: str | None,
        fallback_reason: Any,
    ) -> str:
        if status == "passed":
            return f"QA generator produced a draft row with {generator_model or 'the configured model'}."
        if status == "warning":
            return (
                "QA generator produced a fallback draft row because the configured "
                f"model path was unavailable: {fallback_reason}"
            )
        return "QA generator did not produce a draft row."

    def _public_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": row.get("id"),
            "question": row.get("question"),
            "answer": row.get("answer"),
            "generatorModel": row.get("generator_model"),
            "confidence": row.get("confidence"),
            "generationMetadata": row.get("generation_metadata", {}),
            "reviewStatus": "draft",
            "reviewedAt": None,
        }
