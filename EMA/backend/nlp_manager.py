import yaml
import torch
from sentence_transformers import SentenceTransformer
from utilities.logger import get_logger

class NLPManager:
    def __init__(self, config_path: str):
        self.logger = get_logger(self.__class__.__name__)
        self.config = self._load_config(config_path)
        self.device = self._get_device(self.config["general_params"]["device"])
        self.logger.info(f"Using device: {self.device}")

        # Initialize models
        self.embedding_model = self._initialize_model(self.config["embedding_model"])
        self.template_model = self._initialize_model(self.config["dynamic_template_model"])

    def _load_config(self, config_path: str) -> dict:
        """Load YAML configuration."""
        try:
            with open(config_path, "r") as file:
                config = yaml.safe_load(file)
            self.logger.info(f"Loaded NLP configuration from {config_path}")
            return config["nlp"]
        except Exception as e:
            self.logger.error(f"Error loading NLP config: {e}")
            raise

    def _get_device(self, device_preference: str) -> str:
        """Select the appropriate device."""
        if device_preference == "auto":
            if torch.cuda.is_available():
                return "cuda"
            elif torch.backends.mps.is_available():
                return "mps"
            else:
                return "cpu"
        return device_preference

    def _initialize_model(self, model_config: dict):
        """Initialize NLP models based on configuration."""
        library = model_config["library"]
        model_name = model_config["name"]

        if library == "sentence-transformers":
            self.logger.info(f"Initializing model '{model_name}' from {library}...")
            model = SentenceTransformer(model_name, trust_remote_code=True).to(self.device)
            self.logger.info(f"✅ Model '{model_name}' loaded successfully.")
            return model
        else:
            self.logger.error(f"Unsupported library: {library}")
            raise ValueError(f"Unsupported library: {library}")

    def generate_embeddings(self, text: str) -> list:
        """Generate embeddings for the given text."""
        self.logger.debug(f"Generating embeddings for text: {text}")
        embeddings = self.embedding_model.encode(text).tolist()
        return embeddings

    def generate_dynamic_template(self, query: str) -> dict:
        """Generate a dynamic semantic template for a given query."""
        # Placeholder: Adjust for actual implementation (fine-tuned model, OpenAI, etc.)
        self.logger.debug(f"Generating dynamic template for query: {query}")
        return {
            "name": "Generated Template",
            "collection": "dynamic",
            "template": f"Process the query: {query}",
            "fields": ["field1", "field2", "context"],
            "filters": {
                "include": ["field1", "field2"],
                "exclude": []
            }
        }