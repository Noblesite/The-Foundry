from __future__ import annotations

import re
from typing import Any, Dict


QA_QUALITY_CONFIDENCE_THRESHOLD = 0.6
QA_QUALITY_SOURCE_OVERLAP_THRESHOLD = 0.2
QA_QUALITY_MIN_ANSWER_WORDS = 6
QA_QUALITY_MAX_QUESTION_ANSWER_SIMILARITY = 0.82
VALID_QA_TYPES = {
    "factual",
    "behavior",
    "style",
    "cause-effect",
    "correction",
    "safety-boundary",
}


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
        normalized_question = self._normalize_text(question)
        normalized_answer = self._normalize_text(answer)
        normalized_source = self._normalize_text(source_text)
        source_terms = set(self._key_terms(normalized_source))
        answer_terms = set(self._key_terms(normalized_answer))
        question_terms = set(self._key_terms(normalized_question))
        overlap = len(source_terms.intersection(answer_terms))
        overlap_score = min(1.0, overlap / max(1, min(5, len(source_terms))))
        answer_word_count = len(answer.split())
        answer_length_score = min(1.0, max(0.0, answer_word_count / 18))
        question_score = 1.0 if question.strip().endswith("?") else 0.55
        fallback_penalty = 0.18 if generation_metadata.get("fallbackReason") else 0
        answer_in_source = bool(normalized_answer and normalized_answer in normalized_source)
        term_coverage = min(1.0, len(source_terms.intersection(answer_terms)) / max(1, len(answer_terms)))
        question_answer_similarity = self._jaccard(question_terms, answer_terms)
        trivial_question = self._is_trivial_question(question)
        qa_type = str(generation_metadata.get("qaType", "unspecified") or "unspecified")
        qa_type_valid = qa_type in VALID_QA_TYPES
        answer_too_short = answer_word_count < QA_QUALITY_MIN_ANSWER_WORDS
        hallucination_risk = (
            not answer_in_source
            and overlap_score < QA_QUALITY_SOURCE_OVERLAP_THRESHOLD
        )
        quality_penalty = 0.0
        if hallucination_risk:
            quality_penalty += 0.18
        if trivial_question:
            quality_penalty += 0.12
        if question_answer_similarity > QA_QUALITY_MAX_QUESTION_ANSWER_SIMILARITY:
            quality_penalty += 0.1
        if not qa_type_valid:
            quality_penalty += 0.08
        if answer_too_short:
            quality_penalty += 0.08
        score = max(
            0.0,
            min(
                1.0,
                confidence * 0.35
                + overlap_score * 0.3
                + answer_length_score * 0.2
                + question_score * 0.15
                - fallback_penalty
                - quality_penalty,
            ),
        )
        return {
            "score": round(score, 2),
            "confidence": round(confidence, 2),
            "sourceOverlap": round(overlap_score, 2),
            "sourceTermCoverage": round(term_coverage, 2),
            "answerLength": answer_word_count,
            "questionFormed": question_score == 1.0,
            "fallback": fallback_penalty > 0,
            "answerInSource": answer_in_source,
            "answerTooShort": answer_too_short,
            "trivialQuestion": trivial_question,
            "questionAnswerSimilarity": round(question_answer_similarity, 2),
            "hallucinationRisk": hallucination_risk,
            "qaTypeValid": qa_type_valid,
            "groundedTerms": sorted(source_terms.intersection(answer_terms))[:6],
            "qaType": qa_type,
            "promptTemplateVersion": (
                generation_metadata.get("prompt", {}).get("templateVersion")
                if isinstance(generation_metadata.get("prompt"), dict)
                else None
            ),
            "qualityThresholds": {
                "sourceOverlap": QA_QUALITY_SOURCE_OVERLAP_THRESHOLD,
                "minAnswerWords": QA_QUALITY_MIN_ANSWER_WORDS,
                "maxQuestionAnswerSimilarity": QA_QUALITY_MAX_QUESTION_ANSWER_SIMILARITY,
            },
        }

    def empty(self) -> Dict[str, Any]:
        return {
            "score": 0,
            "confidence": 0,
            "sourceOverlap": 0,
            "answerLength": 0,
            "questionFormed": False,
            "fallback": True,
            "sourceTermCoverage": 0,
            "answerInSource": False,
            "answerTooShort": True,
            "trivialQuestion": True,
            "questionAnswerSimilarity": 0,
            "hallucinationRisk": True,
            "qaTypeValid": False,
            "groundedTerms": [],
            "qaType": "none",
            "promptTemplateVersion": None,
            "qualityThresholds": {
                "sourceOverlap": QA_QUALITY_SOURCE_OVERLAP_THRESHOLD,
                "minAnswerWords": QA_QUALITY_MIN_ANSWER_WORDS,
                "maxQuestionAnswerSimilarity": QA_QUALITY_MAX_QUESTION_ANSWER_SIMILARITY,
            },
        }

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", text.lower()).strip()

    def _jaccard(self, left: set[str], right: set[str]) -> float:
        if not left or not right:
            return 0.0
        return len(left.intersection(right)) / len(left.union(right))

    def _is_trivial_question(self, question: str) -> bool:
        compact = self._normalize_text(question).strip("?")
        words = compact.split()
        if len(words) < 5:
            return True
        trivial_starts = (
            "what is this",
            "what does this say",
            "what is mentioned",
            "what is the text",
            "tell me about this",
        )
        return compact.startswith(trivial_starts)

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
