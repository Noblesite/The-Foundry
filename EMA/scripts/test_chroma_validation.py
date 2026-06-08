import os
from chromadb import PersistentClient
from chromadb.errors import InvalidCollectionException
from utilities.path_manager import PathManager

path_manager = PathManager()
CHROMA_DB_PATH = path_manager.get_path("CHROMA_DB_PATH")
COLLECTION_NAME = "workspace_data"

# Initialize ChromaDB Client
def init_chroma_client(db_path):
    print(f"🔍 Connecting to ChromaDB at: {db_path}")
    try:
        return PersistentClient(db_path)
    except Exception as e:
        raise RuntimeError(f"❌ Error initializing ChromaDB: {e}")

# List Available Collections
def list_collections(client):
    collections = client.list_collections()
    print(f"📂 Available collections: {collections}")
    return collections

# Validate Specific Collection
def validate_collection(client, collection_name):
    try:
        collection = client.get_collection(collection_name)
        print(f"✅ Collection '{collection_name}' exists.")
        print(f"📊 Document count in '{collection_name}': {collection.count()}")
        return collection
    except InvalidCollectionException:
        raise RuntimeError(f"❌ Collection '{collection_name}' does not exist.")
    except Exception as e:
        raise RuntimeError(f"❌ Error accessing collection: {e}")

# Validate Document Content
def validate_documents(collection, sample_count=5):
    print(f"📝 Validating up to {sample_count} documents.")
    try:
        docs = collection.get(limit=sample_count)
        if not docs:
            raise RuntimeError(f"❌ No documents found in collection '{COLLECTION_NAME}'.")

        for doc in docs:
            # Adjust this based on the returned format
            if isinstance(doc, str):
                print(f"- Document Text: {doc[:100]}...")  # Show first 100 characters
            elif isinstance(doc, dict):
                print(f"- ID: {doc.get('id', 'N/A')}")
                print(f"  Text: {doc.get('text', 'N/A')[:100]}...")  # Show first 100 characters
                print(f"  Metadata: {doc.get('metadata', 'N/A')}")
            else:
                print(f"⚠️ Unexpected document format: {type(doc)}")
        print(f"✅ Document validation complete. Total documents: {collection.count()}")
    except Exception as e:
        raise RuntimeError(f"❌ Error validating documents: {e}")

# Test Query Functionality
def test_query(collection, embedding_dim=384):
    print("🔍 Testing query functionality.")
    try:
        # Example dummy embedding
        query_embedding = [0.1] * embedding_dim
        results = collection.query(query_embeddings=[query_embedding], n_results=5)
        print("Query Results:")
        for res in results["documents"]:
            print(f"  - {res[:100]}...")  # Show first 100 characters
    except Exception as e:
        raise RuntimeError(f"❌ Query test failed: {e}")

# Main Validation Workflow
def validate_chroma_db():
    print("🔍 Starting ChromaDB Validation...")
    try:
        client = init_chroma_client(CHROMA_DB_PATH)
        collections = list_collections(client)
        if COLLECTION_NAME not in collections:
            raise RuntimeError(f"❌ Collection '{COLLECTION_NAME}' is missing.")

        collection = validate_collection(client, COLLECTION_NAME)
        validate_documents(collection)
        test_query(collection)
        print("🎉 ChromaDB Validation Completed Successfully!")
    except Exception as e:
        print(f"❌ Validation failed: {e}")

if __name__ == "__main__":
    validate_chroma_db()