import yaml
import os
from utilities.logger import get_logger

class IntentEngine:
    def __init__(self, classifier, config_path="intent_mapping.yaml"):
        self.classifier = classifier  # Zero-shot classification model
        self.intent_mapping = self._load_intent_mapping(config_path)
        self.logger = get_logger("IntentEngine")

    def _load_intent_mapping(self, config_path):
        """Loads the intent hierarchy from a YAML file."""
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Intent mapping file not found: {config_path}")
        
        with open(config_path, "r", encoding="utf-8") as file:
            return yaml.safe_load(file)

    def _extract_intent_label(self, classifier_result):
        """Extracts the highest confidence intent label from classifier results."""
        if isinstance(classifier_result, dict) and "labels" in classifier_result:
            return classifier_result["labels"][0]
        return classifier_result  # Assume it's already a string

    def classify_intent(self, query):
        """Classifies the query into broad, refined, and action intent."""
        self.logger.debug(f"Classifying query: {query}")

        # Get broad intent
        broad_intent = self._extract_intent_label(
            self.classifier(query, list(self.intent_mapping.keys()), multi_label=False)
        )
        self.logger.debug(f"Broad Intent: {broad_intent}")

        if broad_intent not in self.intent_mapping:
            return "fallback_default"

        # Get refined intent
        refined_intent = self._extract_intent_label(
            self.classifier(query, list(self.intent_mapping[broad_intent].keys()), multi_label=False)
        )
        self.logger.debug(f"Refined Intent: {refined_intent}")

        if refined_intent not in self.intent_mapping[broad_intent]:
            return "fallback_default"

        # Get action intent
        action_intent = self._extract_intent_label(
            self.classifier(query, list(self.intent_mapping[broad_intent][refined_intent].keys()), multi_label=False)
        )
        self.logger.debug(f"Action Intent: {action_intent}")

        return self.intent_mapping[broad_intent][refined_intent].get(action_intent, "fallback_default")

# Usage Example:
# intent_processor = IntentEngine(zero_shot_model)
# task = intent_processor.classify_intent("What is the compliance status of my device?")
# print(task)  # Output: check_device_compliance