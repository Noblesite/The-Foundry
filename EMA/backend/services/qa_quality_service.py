from __future__ import annotations

import re
from typing import Any, Dict


QA_QUALITY_CONFIDENCE_THRESHOLD = 0.6


class QAQualityEvaluator:
    """Scores QA rows with the same lightweight proof metrics used by the UI."""

    def evaluate(
        self,
        *,
        question: str,
        answer: str,
        source_text: str,
        confidence: float,
        generation_metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        source_terms = set(self._key_terms(source_text.lower()))
        answer_terms = set(self._key_terms(answer.lower()))
        overlap = len(source_terms.intersection(answer_terms))
        overlap_score = min(1.0, overlap / max(1, min(5, len(source_terms))))
        answer_length_score = min(1.0, max(0.0, len(answer.split()) / 18))
        question_score = 1.0 if question.strip().endswith("?") else 0.55
        fallback_penalty = 0.18 if generation_metadata.get("fallbackReason") else 0
        score = max(
            0.0,
            min(
                1.0,
                confidence * 0.35
                + overlap_score * 0.3
                + answer_length_score * 0.2
                + question_score * 0.15
                - fallback_penalty,
            ),
        )
        return {
            "score": round(score, 2),
            "confidence": round(confidence, 2),
            "sourceOverlap": round(overlap_score, 2),
            "answerLength": len(answer.split()),
            "questionFormed": question_score == 1.0,
            "fallback": fallback_penalty > 0,
        }

    def empty(self) -> Dict[str, Any]:
        return {
            "score": 0,
            "confidence": 0,
            "sourceOverlap": 0,
            "answerLength": 0,
            "questionFormed": False,
            "fallback": True,
        }

    def _key_terms(self, text: str) -> list[str]:
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
