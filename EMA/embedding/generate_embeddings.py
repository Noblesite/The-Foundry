from sentence_transformers import SentenceTransformer
from utilities.logger import get_logger

class EmbeddingGenerator:
    def __init__(self, model_name: str):
        """
        Initializes the EmbeddingGenerator with a specified embedding model.

        Args:
            model_name (str): The name of the model to load for generating embeddings.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.logger.info(f"Initializing embedding model: {model_name}")

        try:
            self.model = SentenceTransformer(model_name, trust_remote_code=True)
            self.logger.info(f"✅ Embedding model '{model_name}' loaded successfully.")
        except Exception as e:
            self.logger.error(f"❌ Failed to load embedding model '{model_name}': {e}")
            raise

    def generate(self, text: str):
        """
        Generate an embedding for a single piece of text.
        """
        if not text.strip():
            self.logger.warning("Attempted to generate embedding for empty text.")
            raise ValueError("Text input is empty or invalid.")

        try:
            self.logger.debug(f"Generating embedding for text: '{text[:50]}...")
            embedding = self.model.encode(text).tolist()
            
            # ✅ Ensure embedding length is valid
            if len(embedding) < 500:
                self.logger.warning(f"Embedding too short ({len(embedding)}). Padding or handling needed.")
            
            self.logger.debug(f"Generated embedding of length {len(embedding)}")
            return embedding

        except Exception as e:
            self.logger.error(f"❌ Error generating embedding for text: {e}")
            raise

    def batch_generate(self, texts: list):
        """
        Generate embeddings for a batch of texts.

        Args:
            texts (list): A list of strings to generate embeddings for.

        Returns:
            list: A list of embedding vectors, one for each input string.
        """
        if not texts:
            self.logger.warning("Attempted to generate embeddings for an empty list.")
            raise ValueError("Input text list is empty.")

        try:
            self.logger.debug(f"Generating embeddings for batch of {len(texts)} texts.")
            embeddings = self.model.encode(texts).tolist()
            self.logger.debug(f"Generated embeddings for batch of size {len(embeddings)}")
            return embeddings
        except Exception as e:
            self.logger.error(f"❌ Error generating batch embeddings: {e}")
            raise

if __name__ == "__main__":
    # Example usage
    generator = EmbeddingGenerator("all-MiniLM-L6-v2")
    sample_text = "This is a test sentence."
    embedding = generator.generate(sample_text)
    print(f"Generated embedding: {embedding[:10]}...")