import json
import re
import chromadb
from chromadb.config import Settings
import torch
import numpy as np
from typing import List, Dict, Optional
from utilities.logger import get_logger
from embedding.generate_embeddings import EmbeddingGenerator


class VectorDatabase:
    def __init__(self, chroma_db_path: str, embedding_model_name: str):
        """
        Initialize the VectorDatabase with a ChromaDB client and embedding generator.
        :param chroma_db_path: Path to the ChromaDB instance.
        :param embedding_model_name: Name of the embedding model to use.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.client = chromadb.PersistentClient(chroma_db_path)
        self.embedding_generator = EmbeddingGenerator(embedding_model_name)
        self.collections = self._load_collections()

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

    def query(self, collection_name: str, query_text: str, top_k: int = 3) -> Dict:
        """
        Queries a ChromaDB collection and returns structured API metadata.
        """
        self.logger.debug(f"🔍 Querying collection '{collection_name}' with text: {query_text}")

        if collection_name not in self.collections:
            error_message = f"❌ Collection '{collection_name}' not found."
            self.logger.error(error_message)
            return {"error": error_message, "query": query_text, "retrieved_records": []}

        try:
            query_embedding = self.embedding_generator.generate(query_text)
            collection = self.collections[collection_name]
            results = collection.query(query_embeddings=[query_embedding], n_results=top_k)

            # ✅ Ensure results exist before processing
            if not results or "documents" not in results or not results["documents"]:
                self.logger.warning(f"⚠️ No matching results found for query: {query_text}")
                return {"query": query_text, "retrieved_records": []}

            # ✅ Handle cases where results are shorter than expected
            structured_results = {"query": query_text, "retrieved_records": []}
            documents = results["documents"][0] if results["documents"] and len(results["documents"]) > 0 else []
            metadata = results.get("metadatas", [[]])[0] if "metadatas" in results and len(results["metadatas"]) > 0 else []

            for doc, meta in zip(documents, metadata):
                structured_results["retrieved_records"].append({
                    "document": doc if doc else "⚠️ No document content found",
                    "metadata": meta or {}  # Ensure metadata is always a dictionary
                })

            return structured_results

        except Exception as e:
            self.logger.error(f"❌ Failed to query collection '{collection_name}': {e}", exc_info=True)
            return {"error": str(e), "query": query_text, "retrieved_records": []}
        
    def query_with_override(self, user_input: str, top_k: int = 1) -> Dict:
        """
        Parses user input for explicit collection and query overrides using structured format:
        ## FIND key:value IN collection_name ##
        Queries the specified ChromaDB collection directly, generating its own embeddings.
        """

        self.logger.debug(f"🔍 query_with_override triggered with input: {user_input}")

        try:
            match = re.match(r"##\s*FIND\s+([\w: @.]+)\s+IN\s+([\w\d_]+)\s*##", user_input)

            if not match:
                self.logger.warning("⚠️ No structured override detected, passing prompt directly to LLM.")
                return {"query": user_input, "retrieved_records": []}

            filter_text, collection_name = match.groups()
            
            # Parse key-value filters and ensure correct formatting
            filters = {}
            for pair in filter_text.split():
                if ":" in pair:
                    key, value = pair.split(":", 1)
                    filters[key.strip()] = {"$eq": f"value:{value.strip()}"}

            filter_text = json.dumps(filters, indent=2)  # Convert to JSON for structured query
            self.logger.debug(f"🔍 Filter text after parsing: {filter_text}")

            # If no override detected or it failed, proceed with a normal query
            if collection_name not in self.collections:
                error_message = f"❌ Collection '{collection_name}' not found."
                self.logger.error(error_message)
                return {"error": error_message, "query": filter_text, "retrieved_records": []}

        
            query_embedding = self.embedding_generator.generate(filter_text)
            collection = self.collections[collection_name]
            results = collection.query(query_embeddings=[query_embedding], n_results=top_k)

            self.logger.debug(f"🔍 Query results: {json.dumps(results, indent=2)}")

            # Ensure valid results exist
            if not results.get("documents") or not results["documents"][0]:
                self.logger.warning(f"⚠️ No matching results found for query: {filter_text}")
                return {"query": filter_text, "retrieved_records": []}

            structured_results = {"query": filter_text, "retrieved_records": []}

            for doc, meta in zip(results["documents"][0], results.get("metadatas", [[]])[0]):
                structured_results["retrieved_records"].append({
                    "document": doc if doc else "⚠️ No document content found",
                    "metadata": meta or {}  # Ensure metadata is always a dictionary
                })

            self.logger.debug(f"✅ Structured Query Results: {json.dumps(structured_results, indent=2)}")
            return structured_results

        except Exception as e:
            self.logger.error(f"❌ Failed to query collection '{collection_name}': {e}", exc_info=True)
            return {"error": str(e), "query": filter_text, "retrieved_records": []}

    def add_document(self, collection_name: str, document: str, metadata: Dict[str, any]):
        """
        Add a document to a specific collection.
        :param collection_name: Name of the collection.
        :param document: Document text to add.
        :param metadata: Metadata associated with the document.
        """
        if collection_name not in self.collections:
            error_message = f"Collection '{collection_name}' not found."
            self.logger.error(error_message)
            raise ValueError(error_message)

        try:
            collection = self.collections[collection_name]
            doc_id = metadata.get("id", str(hash(document)))
            embedding = self.embedding_generator.generate(document)

            collection.add(
                documents=[document],
                metadatas=[metadata],
                embeddings=[embedding],
                ids=[doc_id]
            )
            self.logger.info(f"Document added to '{collection_name}' with ID: {doc_id}")
        except Exception as e:
            self.logger.error(f"Failed to add document to collection '{collection_name}': {e}")
            raise

    def create_collection(self, collection_name: str):
        """
        Create a new collection in ChromaDB.
        :param collection_name: Name of the new collection.
        """
        try:
            self.client.create_collection(name=collection_name)
            self.logger.info(f"Created new collection: {collection_name}")
            self.collections = self._load_collections()  # Refresh collections
        except Exception as e:
            self.logger.error(f"Failed to create collection '{collection_name}': {e}")
            raise

    def delete_collection(self, collection_name: str):
        """
        Delete a collection from ChromaDB.
        :param collection_name: Name of the collection to delete.
        """
        if collection_name not in self.collections:
            error_message = f"Collection '{collection_name}' not found."
            self.logger.error(error_message)
            raise ValueError(error_message)

        try:
            self.client.delete_collection(name=collection_name)
            self.logger.info(f"Deleted collection: {collection_name}")
            self.collections = self._load_collections()  # Refresh collections
        except Exception as e:
            self.logger.error(f"Failed to delete collection '{collection_name}': {e}")
            raise

    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate an embedding for a given text using the embedding generator.
        :param text: Text to encode into an embedding.
        :return: Generated embedding as a list of floats.
        """
        try:
            embedding = self.embedding_generator.generate(text)
            self.logger.debug(f"Generated embedding for text: {text}")
            return embedding
        except Exception as e:
            self.logger.error(f"Failed to generate embedding for text: {e}")
            raise
    
    def find_best_collection(self, query_text: str) -> Optional[str]:
        """
        Queries all collections and returns the name of the best-matching collection.
        """

        match = re.match(r"##\s*FIND\s+([\w: @.]+)\s+IN\s+([\w\d_]+)\s*##", query_text)

        if match:
            collection_name = match.group(2)  # ✅ Now correctly captures the collection name
            if collection_name in self.collections:
                self.logger.info(f"📌 Explicit collection override detected: {collection_name}")
                return collection_name
            
        query_embedding = self.embedding_generator.generate(query_text)
        best_collection = None
        best_score = float("inf")  # ChromaDB uses distance (lower is better)

        for collection_name, collection in self.collections.items():
            try:
                results = collection.query(query_embeddings=[query_embedding], n_results=1)
                
                # Ensure distances exist and properly extract the first float value
                if "distances" in results and results["distances"]:
                    score = results["distances"][0][0] if isinstance(results["distances"][0], list) else results["distances"][0]

                    if score < best_score:  # Lower distance = better match
                        best_collection = collection_name
                        best_score = score

            except Exception as e:
                self.logger.error(f"Error querying collection '{collection_name}': {e}")

        self.logger.info(f"📊 Best-matching collection: {best_collection} (Score: {best_score:.4f})")

        #TODO: Need to abstract to ema_config
        #if(best_score < 0.5):
        #    self.logger.warning(f"Best-matching score below 0.5: Returning nothing")
        #    return

        return best_collection
    
    def flatten_dict(self, d, parent_key='', sep='_'):
        """
        Recursively flattens a nested dictionary into key-value pairs.
        :param d: The dictionary to flatten.
        :param parent_key: Used for recursive key concatenation.
        :param sep: Separator used to concatenate keys.
        :return: A flattened dictionary.
        """
        items = []
        
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            
            if isinstance(v, dict):
                # Correct recursive call using 'self.'
                items.extend(self.flatten_dict(v, new_key, sep=sep).items())
            
            elif isinstance(v, list):
                # If list contains only dictionaries, merge key-value pairs instead of indexing
                if all(isinstance(item, dict) for item in v):
                    for idx, item in enumerate(v):
                        items.extend(self.flatten_dict(item, f"{new_key}_{idx}", sep=sep).items())
                else:
                    # If not all elements are dicts, concatenate the values into a single string
                    items.append((new_key, ", ".join(map(str, v))))
            
            else:
                items.append((new_key, v))
        
        return dict(items)

# Example usage
if __name__ == "__main__":
    db = VectorDatabase("/path/to/chroma_db", "all-MiniLM-L6-v2")
    db.create_collection("test_collection")
    db.add_document("test_collection", "Example document text", {"key": "value"})
    results = db.query("test_collection", "Example query")
    print(results)