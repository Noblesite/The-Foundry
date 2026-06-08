import yaml
import json
from difflib import SequenceMatcher
from typing import Dict, Optional, Any
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from difflib import SequenceMatcher
from backend.nlp_manager import NLPManager  # Import NLPManager


class TemplateManager:
    """
    Manages semantic templates for various use cases.
    """

    def __init__(self, config_path: Optional[str] = None, nlp_config_path: str = None):
        """
        Initializes the TemplateManager.
        :param config_path: Path to the YAML file containing templates.
        :param nlp_config_path: Path to the YAML file for NLPManager configuration.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.path_manager = PathManager()
        self.templates = self._load_templates(config_path)
        self.nlp_manager = NLPManager(nlp_config_path)

    def _load_templates(self, config_path: Optional[str]) -> Dict[str, Dict]:
        """
        Loads templates from the specified YAML configuration file.
        :param config_path: Path to the YAML configuration file.
        :return: A dictionary of templates grouped by use case.
        """
        try:
            resolved_path = config_path or self.path_manager.get_path("SEMANTIC_TEMPLATES_PATH")
            self.logger.info(f"Loading templates from {resolved_path}")

            with open(resolved_path, "r") as file:
                templates = yaml.safe_load(file)

            if not templates or "semantic_templates" not in templates:
                self.logger.error("❌ Missing 'semantic_templates' key in the configuration.")
                raise ValueError("Invalid template configuration file.")

            self.logger.info(f"✅ Successfully loaded semantic templates.")
            return templates["semantic_templates"]

        except FileNotFoundError:
            self.logger.error(f"❌ Template file not found: {config_path}")
            raise
        except yaml.YAMLError as e:
            self.logger.error(f"❌ Error parsing YAML template file: {e}")
            raise
        except Exception as e:
            self.logger.error(f"❌ Unexpected error loading templates: {e}")
            raise

    def get_template(self, template_key: str) -> Dict[str, str]:
        """
        Retrieves a specific template by its key.
        :param template_key: The key of the template to retrieve.
        :return: The template dictionary.
        """
        try:
            template = self.templates.get(template_key)
            if not template:
                self.logger.warning(f"Template key '{template_key}' not found.")
                return {}
            
            self.logger.debug(f"Retrieved template for key: {template_key}")
            return template
        except Exception as e:
            self.logger.error(f"❌ Error retrieving template '{template_key}': {e}")
            raise

    def match_template(self, query: str, collection_name: str) -> Optional[Dict[str, Any]]:
        """
        Matches a user query to the most relevant template using collection-specific filtering.
        """
        self.logger.info(f"🔍 Matching template for collection: {collection_name}")
        best_match = None
        best_score = 0.0

        for key, template in self.templates.items():
            if template.get("collection") != collection_name:
                continue  # Skip templates from other collections

            template_text = f"{template.get('name', '')} {template.get('description', '')} {' '.join(template.get('keywords', []))}"
            match_score = SequenceMatcher(None, query.lower(), template_text.lower()).ratio()

            if match_score > best_score:
                best_match = template
                best_score = match_score

        if best_match and best_score > 0.6:  # Ensure quality match
            self.logger.info(f"🎯 Found best template: {best_match['name']} (Score: {best_score:.2f})")
            return best_match
        
        self.logger.warning(f"⚠️ No semantic template found. Falling back to dynamic template generation.")
        return self.nlp_manager.generate_dynamic_template(query)

    def list_templates(self) -> Dict[str, Dict]:
        """
        Lists all available templates.
        :return: A dictionary of all templates.
        """
        self.logger.debug("Listing all available templates.")
        return self.templates

    def validate_template(self, template: Dict[str, Any]) -> bool:
        """
        Validates a given template structure.
        :param template: The template dictionary to validate.
        :return: True if valid, False otherwise.
        """
        required_keys = ["name", "description", "template", "fields", "filters"]
        missing_keys = [key for key in required_keys if key not in template]

        if missing_keys:
            self.logger.error(f"Invalid template. Missing keys: {missing_keys}")
            return False
        return True
    
    
    def extract_metadata_filters(self, query: str, matched_template=None) -> Dict:
        """
        Extract metadata filters from a user query based on semantic templates.
        :param query: The user query string.
        :param matched_template: Pre-matched template if available, otherwise find one.
        :return: JSON-formatted dictionary of extracted metadata filters.
        """
        try:
            if matched_template is None:
                self.logger.debug(f"Extracting metadata filters for query: {query}")
                matched_template = self.match_template(query)

            if not matched_template:
                self.logger.warning("No matching template found. Returning default filters.")
                return {}

            filters = matched_template.get("filters")

            # Ensure filters exist and are a dictionary
            if not isinstance(filters, dict):
                self.logger.error(f"Invalid filter format found in template: {matched_template}")
                return {}

            # Convert filters to JSON format (if necessary)
            try:
                filters_json = json.loads(json.dumps(filters))  # Ensures JSON serialization
                self.logger.debug(f"✅ Extracted metadata filters (JSON): {filters_json}")
                return filters_json
            except json.JSONDecodeError as e:
                self.logger.error(f"❌ Error serializing filters to JSON: {e}")
                return {}

        except Exception as e:
            self.logger.error(f"❌ Error extracting metadata filters for query '{query}': {e}")
            return {}