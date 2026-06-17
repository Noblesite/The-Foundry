from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from dataclasses import dataclass
from importlib.util import find_spec
from typing import Any, Dict, List
from uuid import uuid4

from .qa_quality_service import QAQualityEvaluator


@dataclass(frozen=True)
class QAGenerationRequest:
    material_name: str
    material_kind: str
    chunk_id: str
    chunk_text: str
    qa_pair_count: int


class QAGenerationService:
    """Generates draft QA rows from source chunks behind a swappable model boundary."""

    def __init__(self) -> None:
        self.mode = os.getenv("FOUNDRY_QA_GENERATOR_MODE", "deterministic").strip().lower()
        self.model_id = os.getenv("FOUNDRY_QA_GENERATOR_MODEL", "sshleifer/tiny-gpt2").strip()
        self.max_new_tokens = int(os.getenv("FOUNDRY_QA_GENERATOR_MAX_NEW_TOKENS", "320"))
        self.temperature = float(os.getenv("FOUNDRY_QA_GENERATOR_TEMPERATURE", "0.2"))
        self.quality_evaluator = QAQualityEvaluator()

    def runtime_payload(self) -> Dict[str, Any]:
        transformers_available = find_spec("transformers") is not None
        ready = self.mode == "deterministic" or transformers_available
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
        self.model_id = model_id.strip() or "sshleifer/tiny-gpt2"
        self.max_new_tokens = max(24, min(2048, int(max_new_tokens)))
        self.temperature = max(0.0, min(1.5, float(temperature)))
        return self.runtime_payload()

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
        model_service.configure(
            mode="transformers",
            model_id=self.model_id,
            max_new_tokens=min(self.max_new_tokens, 160),
            temperature=self.temperature,
        )
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
                    "Cached model generated a parseable QA row."
                    if model_rows
                    else "Cached model responded, but did not return parseable QA JSON."
                ),
            )
        except Exception as error:
            model_result = self._quality_proof_result(
                label="Cached local model",
                status="warning",
                rows=[],
                source_text=request.chunk_text,
                detail=(
                    "Cached model proof could not run without downloading or loading "
                    f"the configured model: {type(error).__name__}: {error}"
                ),
            )

        results = [deterministic_result, model_result]
        return {
            "contractVersion": "foundry.qa-generator.quality-proof.v1",
            "runtime": self.runtime_payload(),
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
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline

        tokenizer = AutoTokenizer.from_pretrained(
            self.model_id,
            local_files_only=local_files_only,
        )
        model = AutoModelForCausalLM.from_pretrained(
            self.model_id,
            local_files_only=local_files_only,
        )

        generator = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            device=-1,
        )
        prompt = self._prompt(request)
        output = generator(
            prompt,
            max_new_tokens=self.max_new_tokens,
            temperature=self.temperature,
            do_sample=self.temperature > 0,
            return_full_text=False,
        )[0]["generated_text"]
        parsed = self._parse_model_rows(output)
        rows = []
        for index, row in enumerate(parsed[: request.qa_pair_count]):
            question = str(row.get("question", "")).strip()
            answer = str(row.get("answer", "")).strip()
            if not question or not answer:
                continue
            rows.append(
                self._row(
                    request=request,
                    question=question,
                    answer=answer,
                    confidence=float(row.get("confidence", 0.72) or 0.72),
                    strategy="model-json",
                    model_id=self.model_id,
                    row_index=index,
                )
            )
        return rows

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
            answer = sentences[index % len(sentences)] if sentences else compact[:800]
            term = key_terms[index % len(key_terms)] if key_terms else "this source"
            question = (
                f"What should a model learn about {term} from {request.material_name}?"
            )
            rows.append(
                self._row(
                    request=request,
                    question=question,
                    answer=answer[:900],
                    confidence=self._deterministic_confidence(answer, key_terms),
                    strategy="context-sentence",
                    model_id="deterministic-context-generator",
                    row_index=index,
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
        fallback_reason: str | None = None,
        requested_model_id: str | None = None,
    ) -> Dict[str, Any]:
        metadata = {
            "contractVersion": "foundry.qa-generation.v1",
            "mode": self.mode,
            "strategy": strategy,
            "rowIndex": row_index,
            "source": {
                "chunkId": request.chunk_id,
                "materialName": request.material_name,
                "materialKind": request.material_kind,
                "characterCount": len(request.chunk_text),
                "tokenEstimate": len(request.chunk_text.split()),
            },
        }
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
        return (
            "You are The Foundry QA generator. Create high quality training examples "
            "from the source context. Return only JSON as an array of objects with "
            "question, answer, and confidence fields.\n\n"
            f"Material: {request.material_name}\n"
            f"Material kind: {request.material_kind}\n"
            f"Requested rows: {request.qa_pair_count}\n"
            f"Source context:\n{request.chunk_text[:4000]}\n"
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
        )

    def _quality_proof_result(
        self,
        *,
        label: str,
        status: str,
        rows: List[Dict[str, Any]],
        source_text: str,
        detail: str | None = None,
    ) -> Dict[str, Any]:
        public_rows = [self._public_row(row) for row in rows]
        quality = self._score_quality(rows[0], source_text) if rows else self.quality_evaluator.empty()
        return {
            "label": label,
            "status": status,
            "detail": detail or self._quality_detail(status, quality),
            "rows": public_rows,
            "quality": quality,
        }

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
