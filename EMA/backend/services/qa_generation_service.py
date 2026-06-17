from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List
from uuid import uuid4


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

    def generate(self, request: QAGenerationRequest) -> List[Dict[str, Any]]:
        if self.mode in {"transformers", "local"}:
            try:
                rows = self._generate_with_transformers(request)
                if rows:
                    return rows
            except Exception:
                # Assembly Lines should still produce reviewable draft rows when the
                # optional generator model is unavailable. Metadata records fallback.
                pass
        return self._generate_deterministic(request)

    def _generate_with_transformers(self, request: QAGenerationRequest) -> List[Dict[str, Any]]:
        from transformers import pipeline

        generator = pipeline(
            "text-generation",
            model=self.model_id,
            tokenizer=self.model_id,
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

    def _generate_deterministic(self, request: QAGenerationRequest) -> List[Dict[str, Any]]:
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
    ) -> Dict[str, Any]:
        return {
            "id": f"qa-{uuid4().hex[:12]}",
            "chunk_id": request.chunk_id,
            "question": question,
            "answer": answer,
            "generator_model": model_id,
            "confidence": round(max(0.0, min(1.0, confidence)), 2),
            "generation_metadata": {
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
            },
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
