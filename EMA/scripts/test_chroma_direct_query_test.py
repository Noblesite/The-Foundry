import chromadb
from chromadb import PersistentClient
from sentence_transformers import SentenceTransformer
from utilities.path_manager import PathManager

path_manager = PathManager()

chroma_db_path = path_manager.get_path("CHROMA_DB_PATH")

print(f"ChromaDB path: {chroma_db_path}")

# Initialize the ChromaDB client
#chroma_client = PersistentClient(path=chroma_db_path)
chroma_client = chromadb.PersistentClient(chroma_db_path)
# List all collections in the database
collections = chroma_client.list_collections()

# Print available collections
print("Available collections in ChromaDB:")
for collection in collections:
    print(f"- {collection}")

# Initialize ChromaDB and SentenceTransformer
#chroma_client = chromadb.PersistentClient(chroma_db_path)


collection = chroma_client.get_collection("workspace_data")
embed_model = SentenceTransformer('all-MiniLM-L6-v2')

# Generate an embedding for a sample query
query = "OrganizationGroupId : 8547, how many devices have BundleId: com.android.chrome installed?"
query_embedding = embed_model.encode(query).tolist()

# Perform the query
results = collection.query(query_embeddings=[query_embedding], n_results=5)

# Display results
print("Query Results:")
for doc in results.get("documents", []):
    print(f"- {doc[:100]}...")