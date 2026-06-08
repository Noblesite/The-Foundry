import json
import os
from typing import List, Dict
from utilities.logger import get_logger
from pathlib import Path
from utilities.path_manager import PathManager

class DataIngestion:
    def __init__(self, chroma_db_client):
        """
        Data ingestion module for ChromaDB.

        Args:
            chroma_db_client: Initialized ChromaDB client.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.chroma_db_client = chroma_db_client
        self.path_manager = PathManager()

    def normalize_metadata(self, metadata: Dict) -> Dict:
        """
        Normalizes metadata to ensure compatibility with ChromaDB.

        Args:
            metadata (Dict): Metadata dictionary.

        Returns:
            Dict: Normalized metadata.
        """
        normalized_metadata = {}
        for key, value in metadata.items():
            if isinstance(value, (str, int, float, bool)):
                normalized_metadata[key] = value
            elif isinstance(value, list):
                normalized_metadata[key] = ",".join(map(str, value))
            elif isinstance(value, dict):
                normalized_metadata[key] = json.dumps(value)
            else:
                normalized_metadata[key] = str(value)
        return normalized_metadata

    def ingest_file(self, file_path: str, collection_name: str):
        """
        Ingests data from a JSONL file into ChromaDB.

        Args:
            file_path (str): Path to the JSONL file.
            collection_name (str): ChromaDB collection name.
        """
        try:
            with open(file_path, "r") as f:
                data = [json.loads(line) for line in f]
            
            collection = self.chroma_db_client.get_collection(collection_name)
            for record in data:
                text = record.get("text", "")
                metadata = record.get("metadata", {})
                normalized_metadata = self.normalize_metadata(metadata)
                collection.add(
                    documents=[text],
                    metadatas=[normalized_metadata]
                )
            
            self.logger.info(f"✅ Successfully ingested file: {file_path}")
        except Exception as e:
            self.logger.error(f"❌ Failed to ingest file {file_path}: {e}")

    def ingest_directory(self, directory_path: str, collection_name: str):
        """
        Ingests all JSONL files from a directory into ChromaDB.

        Args:
            directory_path (str): Path to the directory containing JSONL files.
            collection_name (str): ChromaDB collection name.
        """
        try:
            directory = Path(directory_path)
            if not directory.exists():
                raise FileNotFoundError(f"Directory not found: {directory_path}")

            jsonl_files = list(directory.glob("*.jsonl"))
            if not jsonl_files:
                self.logger.warning(f"No JSONL files found in directory: {directory_path}")
                return

            for file_path in jsonl_files:
                self.ingest_file(str(file_path), collection_name)

        except Exception as e:
            self.logger.error(f"❌ Failed to ingest directory {directory_path}: {e}")

if __name__ == "__main__":
    # Example Usage
    from utilities.vector_db_client import ChromaDBClient

    path_manager = PathManager()
    chroma_db_client = ChromaDBClient(path_manager.get_path("CHROMA_DB_PATH"))
    ingestion = DataIngestion(chroma_db_client)

    dataset_path = path_manager.get_path("OMNISSA_PRODUCTION_DATASET_PATH")
    ingestion.ingest_directory(dataset_path, collection_name="api_reference")