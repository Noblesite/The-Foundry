import os
import json
import uuid
import logging
import yaml
import chromadb
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from utilities.system_resource import get_dynamic_settings

# Initialize utilities
path_manager = PathManager()
logger = get_logger(__name__)

class ChromaDBBuilder:
    def __init__(self, db_path: str = None, embed_model_name: str = 'BAAI/bge-large-en-v1.5'):
        """
        Initializes ChromaDBManager with dynamic settings and model loading.
        """
        # Load system resource settings
        self.batch_size, self.workers = get_dynamic_settings()
        logger.info(f"Dynamic settings - Batch size: {self.batch_size}, Workers: {self.workers}")

        # Load collections.yaml
        self.collections_path = path_manager.get_path("COLLECTIONS_PATH")
        self.collections = self._load_collections()

        # Initialize ChromaDB client and embedding model
        self.db_path = db_path or path_manager.get_path("CHROMA_DB_PATH")
        self.client = chromadb.PersistentClient(self.db_path)
        self.embed_model = SentenceTransformer(embed_model_name)

        logger.info(f"ChromaDB initialized at {self.db_path}")

    def _load_collections(self) -> Dict[str, str]:
        """Load existing collections from collections.yaml."""
        if os.path.exists(self.collections_path):
            with open(self.collections_path, "r") as file:
                return yaml.safe_load(file).get("collections", {})
        return {}

    def _save_collections(self):
        """Save updated collections to collections.yaml after execution."""
        with open(self.collections_path, "w") as file:
            yaml.safe_dump({"collections": self.collections}, file, default_flow_style=False)
        logger.info(f"✅ Collections updated in collections.yaml")

    def _initialize_collection(self, collection_name: str):
        """Retrieve or create a ChromaDB collection."""
        try:
            return self.client.get_collection(collection_name)
        except chromadb.errors.InvalidCollectionException:
            logger.info(f"Creating new collection: {collection_name}")
            return self.client.create_collection(collection_name)

    def _update_collections(self, collection_name: str):
        """Add new collection to the in-memory collections list."""
        if collection_name not in self.collections:
            self.collections[collection_name] = collection_name
            logger.info(f"📌 New collection detected: {collection_name}")

    def generate_embeddings(self, text: str) -> List[float]:
        """Generate vector embeddings for the given text."""
        return self.embed_model.encode(text).tolist()

    def normalize_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize metadata fields for ChromaDB compatibility."""
        normalized_metadata = {}
        for k, v in metadata.items():
            try:
                if isinstance(v, (str, int, float, bool)):
                    normalized_metadata[k] = v
                elif isinstance(v, list):
                    normalized_metadata[k] = ", ".join(str(item) for item in v)
                elif isinstance(v, dict):
                    normalized_metadata[k] = "; ".join(f"{key}:{value}" for key, value in v.items())
                else:
                    normalized_metadata[k] = str(v)
            except Exception as e:
                logger.error(f"Error normalizing metadata key '{k}': {e}")
                normalized_metadata[k] = "error"
        return normalized_metadata

    def insert_api_data(self, data: List[Dict[str, Any]], source: str):
        """
        Insert API data into category-based collections with embedded key fields.
        - Ensures each API is indexed under its respective category.
        - Stores key API details in ChromaDB.
        """
        for entry in data:
            category = entry.get("api_category", "unknown").lower().replace(" ", "_")
            collection_name = f"{category}_api_v1"

            # Ensure collection is registered
            self._update_collections(collection_name)
            collection = self._initialize_collection(collection_name)

            # Embed key API details
            text_for_embedding = f"{entry.get('api_name', '')}. {entry.get('description', '')}. {entry.get('functionality', '')}. {entry.get('context', '')}"
            embedding = self.generate_embeddings(text_for_embedding)

            # Store metadata
            metadata = {
                "method": entry.get("method", "UNKNOWN").upper(),
                "url": entry.get("url", ""),
                "headers": entry.get("headers", []),
                "variables": entry.get("variables", []),
                "query_parameters": entry.get("query_parameters", []),
                "api_name": entry.get("api_name", "unknown"),
                "category": entry.get("api_category", "unknown"),
                "source": source,
            }
            normalized_metadata = self.normalize_metadata(metadata)

            try:
                collection.add(
                    documents=[text_for_embedding],
                    metadatas=[normalized_metadata],
                    embeddings=[embedding],
                    ids=[str(uuid.uuid4())]
                )
            except Exception as e:
                logger.error(f"Error inserting into collection '{collection_name}': {e}")

    def load_and_insert_api_data(self, file_path: str):
        """
        Load API data from JSONL and insert into category-based collections.
        - Extracts API category to determine collection name.
        """
        if not os.path.exists(file_path):
            logger.error(f"❌ API dataset not found: {file_path}")
            return

        logger.info(f"🚀 Loading API dataset: {file_path}")
        try:
            with open(file_path, "r") as file:
                data = [json.loads(line) for line in file]
                self.insert_api_data(data, source="api_dataset")
        except Exception as e:
            logger.error(f"❌ Error processing API dataset '{file_path}': {e}")

    def load_and_insert_data(self, directory: str):
        """
        Load and insert environment state data dynamically from all .jsonl files.
        - Uses multithreading to process large datasets efficiently.
        """
        file_paths = [os.path.join(directory, f) for f in os.listdir(directory) if f.endswith(".jsonl")]

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            for file_path in file_paths:
                collection_name = os.path.basename(file_path).replace(".jsonl", "")
                self._update_collections(collection_name)  # Ensure collection is tracked
                executor.submit(self._process_file, file_path, collection_name)

    def _process_file(self, file_path: str, collection_name: str):
        """Process individual environment state file and insert data into ChromaDB."""
        logger.info(f"🚀 Processing file: {file_path} into collection '{collection_name}'")
        try:
            with open(file_path, "r") as file:
                data = [json.loads(line) for line in file]
                self.insert_api_data(data, source="env_state")
        except Exception as e:
            logger.error(f"❌ Error processing file '{file_path}': {e}")

# Main execution
if __name__ == "__main__":
    db_builder = ChromaDBBuilder()

    try:
        # ✅ **Restored environment state data ingestion**
        db_builder.load_and_insert_data(path_manager.get_path("DEVELOPMENT_DATASET_PATH"))

        # ✅ **Ensures API documentation is processed correctly**
        db_manager.load_and_insert_api_data(path_manager.get_path("OMNISSA_STATIC_DATASET_PATH_API"))

        db_manager.load_static_datasets({
            path_manager.get_path("OMNISSA_STATIC_DATASET_PATH_KB_DOC"): "document_and_knowledge_base_articles",
        })

        # Final step: Save all collections to YAML
        db_manager._save_collections()

        print("✅ ChromaDB has been successfully built and populated!")
    except Exception as e:
        logger.error(f"❌ Error during ChromaDB population: {e}")