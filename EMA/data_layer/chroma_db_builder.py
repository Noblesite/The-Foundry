import os
import json
import uuid
import yaml
import chromadb
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any
from itertools import islice
from sentence_transformers import SentenceTransformer
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from utilities.system_resource import get_dynamic_settings


class ChromaDBBuilder:
    def __init__(self):
        """
        Initializes ChromaDBBuilder with dynamic settings and model loading.
        """
        self.path_manager = PathManager()
        self.logger = get_logger("ChromaDBBuilder")

        EMA_CONFIG_PATH = self.path_manager.get_path("EMA_CONFIG_PATH")
        try:
            with open(EMA_CONFIG_PATH, "r") as file:
                self.EMA_CONFIG = yaml.safe_load(file)
            self.logger.info("EMA config loaded successfully.")
        except FileNotFoundError:
            self.EMA_CONFIG = {}
            self.logger.error(f"EMA_CONFIG file not found at {EMA_CONFIG_PATH}.")
            raise

        self.CHROMA_DB_PATH = self.path_manager.get_path("CHROMA_DB_PATH")
        self.EMBEDDING_MODEL = self.EMA_CONFIG["models"]["embedding_model"]

        self.batch_size, self.workers = get_dynamic_settings()
        self.logger.info(f"Dynamic settings - Batch size: {self.batch_size}, Workers: {self.workers}")

        self.client = chromadb.PersistentClient(self.CHROMA_DB_PATH)
        self.embed_model = SentenceTransformer(self.EMBEDDING_MODEL, trust_remote_code=True)
        self.collections_path = self.path_manager.get_path("COLLECTIONS_PATH")

        self.logger.info(f"ChromaDB initialized at {self.CHROMA_DB_PATH} with Embeddings Model: {self.EMBEDDING_MODEL}")

    def _run(self):
        
        try:
            # ✅ **Restored environment state data ingestion**
            self.load_and_insert_env_data(self.path_manager.get_path("DEVELOPMENT_DATASET_PATH"))

            # ✅ **Ensures API documentation is processed correctly**
            self.load_and_insert_api_data(self.path_manager.get_path("OMNISSA_STATIC_DATASET_PATH_API"))

            self.load_kb_doc_datasets(self.path_manager.get_path("OMNISSA_DATASET_PATH_KB_DOC_SEED"))

            # Final step: Save all collections to YAML
            self._save_collections()

            self.logger.info("✅ ChromaDB has been successfully built and populated!")
        except Exception as e:
            self.logger.error(f"❌ Error during ChromaDB population: {e}")


    def _initialize_collection(self, collection_name: str):
        """Retrieve or create a ChromaDB collection."""
        try:
            return self.client.get_collection(collection_name)
        except chromadb.errors.InvalidCollectionException:
            self.logger.info(f"Creating new collection: {collection_name}")
            return self.client.create_collection(collection_name)
    
    def _load_collections(self) -> Dict[str, chromadb.api.Collection]:
        """
        Load available collections from the ChromaDB instance.
        :return: Dictionary of collections where the key is the collection name.
        """
        try:
            collection_names = self.client.list_collections()
            collections = {
                name: self.client.get_collection(name) for name in collection_names
            }
            self.logger.info(f"Loaded collections: {list(collections.keys())}")
            return collections
        except Exception as e:
            self.logger.error(f"Failed to load collections: {e}")
            raise

    def load_kb_doc_datasets(self, file_path: str):
        """Load static datasets into ChromaDB."""
        
        if not os.path.exists(file_path):
            self.logger.error(f"❌ Dataset path not found: {file_path}")
            return
        
        self.logger.info(f"📥 Loading dataset: {file_path}")
        try:
            with open(file_path, "r") as file:
                data = [json.loads(line) for line in file]
                self.insert_kb_doc_data(data)
        except Exception as e:
            self.logger.error(f"❌ Error loading dataset '{file_path}': {e}")
            raise
                
    def insert_kb_doc_data(self, data: List[Dict[str, Any]]):
        """Insert data into a specific ChromaDB collection."""
        
        for entry in data:
            data_source = entry.get("source", "unknown").lower().replace(" ", "_")
            title = entry.get("title", "unknown").lower()
            summary = entry.get("summary", "unknown").lower()
            collection_name = f"{data_source}"

            # Ensure collection is registered
            collection = self._initialize_collection(collection_name)

            text_for_embedding = f"{title} {summary}"

            embedding = self._generate_embeddings(text_for_embedding)

             # 🔹 Fix metadata extraction
            metadata = {
                key: (value if isinstance(value, (str, int, float, list)) else str(value)) 
                for key, value in entry.items()
                if key not in ["title", "summary"]  # Exclude primary text fields
            }
            normalized_metadata = self.normalize_metadata(metadata)

            #self.logger.debug(f"insert_kb_doc_data for collection: {collection_name} with document values: {text_for_embedding} And MetaData: {normalized_metadata}")

            try:
                collection.add(
                    documents=[text_for_embedding],
                    metadatas=[normalized_metadata],
                    embeddings=[embedding],
                    ids=[str(uuid.uuid4())]
                )
            except Exception as e:
                self.logger.error(f"Error inserting into collection '{collection_name}': {e}")

    def _generate_embeddings(self, text: str) -> List[float]:
        """Generate vector embeddings for the given text."""
        return self.embed_model.encode(text).tolist()
    
    def insert_api_data(self, data: List[Dict[str, Any]], source: str):
        """
        Insert API data into category-based collections with embedded key fields.
        - Ensures each API is indexed under its respective category.
        - Stores key API details in ChromaDB.
        """
        for entry in data:
            category = entry.get("api_category", "unknown").lower().replace(" ", "_")
            collection_name = f"{category}"

            # Ensure collection is registered
            collection = self._initialize_collection(collection_name)

            # Embed key API details
            text_for_embedding = f"{entry.get('api_name', '')}. {entry.get('description', '')}. {entry.get('functionality', '')}"
            embedding = self._generate_embeddings(text_for_embedding)

            # Store metadata
            metadata = {
                "method": entry.get("method", "UNKNOWN").upper(),
                "url": entry.get("url", ""),
                "headers": entry.get("headers", []),
                "variables": entry.get("variables", []),
                "query_parameters": entry.get("query_parameters", []),
                "api_name": entry.get("api_name", "unknown"),
                "category": entry.get("api_category", "unknown"),
                "request_body": entry.get("request_body", ""),
                "source": source,
            }
            normalized_metadata = self.normalize_metadata(metadata)

            #self.logger.debug(f"insert_api_data for collection: {collection_name} with document values: {text_for_embedding} And MetaData: {normalized_metadata}")

            try:
                collection.add(
                    documents=[text_for_embedding],
                    metadatas=[normalized_metadata],
                    embeddings=[embedding],
                    ids=[str(uuid.uuid4())]
                )
            except Exception as e:
                self.logger.error(f"Error inserting into collection '{collection_name}': {e}")

    def insert_wso_enviroment_data(self, data: List[Dict[str, Any]], source: str, collection_name: str):
        """
        Insert API data into category-based collections with embedded key fields.
        - Ensures each API is indexed under its respective category.
        - Stores key API details in ChromaDB.
        """
        for entry in data:
            position = 0  # Get the third element (index 2)
            primary_field , value_dict = next(islice(entry.items(), position, None))

            key , value = next(islice(value_dict.items(), position, None))
            
            # Ensure collection is registered
            collection = self._initialize_collection(collection_name)

            # Embed key API details
            text_for_embedding = f"{collection_name} {primary_field} {value}"
            embedding = self._generate_embeddings(text_for_embedding)

             # Construct metadata dynamically (exclude primary field)
            metadata = {key: value["value"] for key, value in entry.items()}
            normalized_metadata = self.normalize_metadata(metadata)

            #self.logger.debug(f"insert_wso_enviroment_data for collection: {collection_name} with document values: {text_for_embedding} And MetaData: {normalized_metadata}")

            try:
                collection.add(
                    documents=[text_for_embedding],
                    metadatas=[normalized_metadata],
                    embeddings=[embedding],
                    ids=[str(uuid.uuid4())]
                )
            except Exception as e:
                self.logger.error(f"Error inserting into collection '{collection_name}': {e}")

    def load_and_insert_api_data(self, file_path: str):
        """
        Load API data from JSONL and insert into category-based collections.
        - Extracts API category to determine collection name.
        """
        if not os.path.exists(file_path):
            self.logger.error(f"❌ API dataset not found: {file_path}")
            return

        self.logger.info(f"🚀 Loading API dataset: {file_path}")
        try:
            with open(file_path, "r") as file:
                data = [json.loads(line) for line in file]
                self.insert_api_data(data, source="api_dataset")
        except Exception as e:
            self.logger.error(f"❌ Error processing API dataset '{file_path}': {e}")

    def load_and_insert_env_data(self, directory: str):
        """
        Load and insert environment state data dynamically from all .jsonl files.
        - Uses multithreading to process large datasets efficiently.
        """
        file_paths = [os.path.join(directory, f) for f in os.listdir(directory) if f.endswith(".jsonl")]

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            for file_path in file_paths:
                collection_name = os.path.basename(file_path).replace(".jsonl", "")
                executor.submit(self._process_file, file_path, collection_name)

    def _process_file(self, file_path: str, collection_name: str):
        """Process individual environment state file and insert data into ChromaDB."""
        self.logger.info(f"🚀 Processing file: {file_path} into collection '{collection_name}'")
        try:
            with open(file_path, "r") as file:
                data = [json.loads(line) for line in file]
                self.insert_wso_enviroment_data(data, source="env_state", collection_name=collection_name)
        except Exception as e:
            self.logger.error(f"❌ Error processing file '{file_path}': {e}")


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
                self.logger.error(f"Error normalizing metadata key '{k}': {e}")
                normalized_metadata[k] = "error"
        return normalized_metadata

    def _save_collections(self):
        """Save updated collection names to collections.yaml after execution."""
        try:
            # ✅ Ensure we extract only collection names as strings
            collection_names = [str(name) for name in self.client.list_collections()]
            self.logger.debug(f"_save_collections called with collection names: {collection_names}")

            # ✅ Save the list of collection names correctly
            with open(self.collections_path, "w") as file:
                yaml.safe_dump({"collections": collection_names}, file, default_flow_style=False)

            self.logger.info(f"✅ Collections updated in collections.yaml")
        except Exception as e:
            self.logger.error(f"❌ Error _save_collections: {e}")
