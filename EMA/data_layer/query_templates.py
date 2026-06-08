import spacy
import yaml

class QueryTemplates:
    def __init__(self, semantic_template_path: str):
        """
        Initialize the QueryTemplates class by loading semantic templates and spaCy model.

        :param semantic_template_path: Path to the semantic templates YAML file.
        """
        self.nlp = spacy.load("en_core_web_sm")
        self.semantic_templates = self.load_semantic_templates(semantic_template_path)

    @staticmethod
    def load_semantic_templates(file_path):
        """
        Load semantic templates from a YAML file.

        :param file_path: Path to the semantic templates file.
        :return: Dictionary of semantic templates.
        """
        with open(file_path, "r") as file:
            return yaml.safe_load(file)

    def extract_keywords(self, user_input):
        """
        Extract keywords and entities from user input using spaCy NLP.

        :param user_input: The raw query from the user.
        :return: Tuple of (keywords, entities).
        """
        doc = self.nlp(user_input)
        keywords = [token.text.lower() for token in doc if token.is_alpha and not token.is_stop]
        entities = [(ent.text, ent.label_) for ent in doc.ents]
        return keywords, entities

    def match_semantic_template(self, user_input):
        """
        Attempt to match the user input to a predefined semantic template.

        :param user_input: The raw query from the user.
        :return: Matched template or None if no match is found.
        """
        for template in self.semantic_templates.get("templates", []):
            if all(keyword in user_input.lower() for keyword in template.get("keywords", [])):
                return template
        return None

    def build_query_template(self, user_input):
        """
        Build a dynamic query template based on extracted keywords and semantic templates.

        :param user_input: The raw query from the user.
        :return: Combined metadata filters for ChromaDB.
        """
        keywords, entities = self.extract_keywords(user_input)
        filters = {}

        # Match against semantic templates
        matched_template = self.match_semantic_template(user_input)
        if matched_template:
            filters.update(matched_template.get("filters", {}))

        # Dynamically generate filters for unmatched keywords
        for keyword in keywords:
            for field, config in self.semantic_templates.get("dynamic_fields", {}).items():
                if keyword in config.get("keywords", []):
                    filters[field] = {"$contains": keyword}

        return filters

# Example usage
if __name__ == "__main__":
    qt = QueryTemplates("semantic_templates.yaml")

    # Example user input
    user_query = "Find non-compliant devices in smart group Retail"
    filters = qt.build_query_template(user_query)

    print("Generated Filters:", filters)
