from model_layer.zero_shot_engine import ZeroShotEngine
from utilities.logger import get_logger
from model_layer.system_prompts import SystemPrompts
import json

class ZeroShotFilterEngine:
    def __init__(self, config, deviceId: int = None):
        self.logger = get_logger("ZeroShotFilterEngine")
        self.min_confidence = config["min_confidence"]
        self.borderline_threshold = config["borderline_threshold"]
        self.required_labels = set(config["required_labels"])
        self._getSystemPrompt()
        
        if deviceId:
            self.model = ZeroShotEngine(config["zero_shot_model"], gpu_id=deviceId)
        else:
            self.model = ZeroShotEngine(config["zero_shot_model"])

    def filter(self, qa_pair):
        """Applies Zero-Shot classification to determine if a QA pair should be kept."""

        # ✅ Extract required fields
        question = qa_pair.get("question", "").strip()
        context = qa_pair.get("context", "").strip()
        answer = qa_pair.get("answer", "").strip()
        metadata = qa_pair.get("metadata", {})

        # ✅ Handle missing values
        if not question or not context or not answer:
            self.logger.warning(f"🚨 Skipping malformed QA Pair: {qa_pair}")
            return "reject", 0.0, "invalid"

        # ✅ Format metadata as readable text
        metadata_text = []
        for key, value in metadata.items():
            if value and isinstance(value, (str, list, dict)):
                if isinstance(value, list):
                    value = ", ".join(map(str, value))
                elif isinstance(value, dict):
                    value = json.dumps(value, ensure_ascii=False)
                metadata_text.append(f"{key.replace('_', ' ').title()}: {value}")

        metadata_str = "\n".join(metadata_text) if metadata_text else "No additional metadata."

        # ✅ Construct premise including metadata
        premise = (
            f"Context: {context}\n"
            f"Question: {question}\n"
            f"Answer: {answer}\n"
            f"Metadata:\n{metadata_str}"
        )

        # ✅ Construct hypothesis
        hypothesis = f"This question-answer pair is a well-formed '{qa_pair.get('type')}' question with sufficient context and answer details to train an AI assistant."

        # ✅ Run classification
        confidence, label = self.model.classify(premise, hypothesis)

         # ✅ Apply filtering rules
        if confidence >= self.min_confidence:
            return "keep", confidence, label
        elif self.min_confidence - confidence <= self.borderline_threshold:
            return "borderline", confidence, label
        else:
            return "reject", confidence, label

    def _getSystemPrompt(self):
        system_prompts = SystemPrompts()
        self.hypothesis = system_prompts.get_system_prompt_by_role("zs_dataset_filter_hypothesis")
        self.logger.debug(f"📝 Zero-Shot Hypothesis: {self.hypothesis}")