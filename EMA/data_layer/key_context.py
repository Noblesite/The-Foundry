import json
import os
from utilities.logger import get_logger

logger = get_logger(__name__)

class KeyContext:
    CONTEXT = {}

    @classmethod
    def load_context(cls, file_path="key_context.json"):
        """
        Loads context definitions from a JSON file.
        :param file_path: Path to the JSON file containing key contexts.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Key context file not found: {file_path}")
        with open(file_path, "r") as f:
            cls.CONTEXT = cls._to_lowercase_keys(json.load(f))

    @staticmethod
    def _to_lowercase_keys(data):
        """
        Recursively converts all keys in a dictionary or list to lowercase.
        :param data: Input data (dictionary or list).
        :return: Data with all keys in lowercase.
        """
        if isinstance(data, dict):
            return {k.lower(): KeyContext._to_lowercase_keys(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [KeyContext._to_lowercase_keys(item) for item in data]
        else:
            return data

    
    @classmethod
    def get_context(cls, key: str, parent_key: str = None) -> str:
        """
        Retrieve context for a given key, considering parent categories and nested structures.
        :param key: The specific key to look up.
        :param parent_key: The parent category (e.g., "OrganizationGroup").
        :return: The context description or a default message.
        """
        try:
            context = cls.CONTEXT

            # Step 1: Navigate to the parent key if provided
            if parent_key:
                parent_key = parent_key.lower()
                if parent_key in context:
                    context = context[parent_key]
                else:
                    logger.debug(f"Parent key '{parent_key}' not found in key context.")
                    return "No context available for this key."

            # Step 2: Look up the key in the (possibly nested) context
            key = key.lower()
            if isinstance(context, dict):
                value = context.get(key)
                if value:
                    return value
                else:
                    logger.debug(f"Key '{key}' not found under parent '{parent_key}'.")
            else:
                logger.debug(f"Parent '{parent_key}' is not a dictionary. Cannot retrieve key '{key}'.")

            return "No context available for this key."
        except Exception as e:
            logger.error(f"Error retrieving context for key '{key}' under parent '{parent_key}': {e}")
            return "No context available for this key."

    @classmethod
    def enrich_record(cls, record: dict) -> dict:
        """
        Enriches a single record by adding contextual descriptions.
        Handles nested structures dynamically.
        :param record: The record to enrich.
        :return: Enriched record as a dictionary.
        """
        def enrich_value(value, key_prefix=""):
            if isinstance(value, dict):
                return {k: enrich_value(v, f"{key_prefix}{k.lower()}_") for k, v in value.items()}
            elif isinstance(value, list):
                return [enrich_value(v, f"{key_prefix}{i}_") for i, v in enumerate(value)]
            else:
                context_key = key_prefix.rstrip("_").lower()
                return {"value": value, "context": cls.get_context(context_key)}

        return enrich_value(record)

    @classmethod
    def enrich_data(cls, data: list) -> list:
        """
        Enriches a list of records by adding contextual descriptions.
        :param data: List of records to enrich.
        :return: Enriched data as a list of dictionaries.
        """
        return [cls.enrich_record(record) for record in data]