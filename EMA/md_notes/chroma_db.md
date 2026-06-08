
Explanation of Each Argument for collection.add
Argument	Type	            Required?	Description
ids	        List[str]	        ✅ Yes	Unique document identifiers. Must be unique per document.
documents	List[str]	        ✅ if not using embeddings	Text content for auto-generated embeddings.
embeddings	List[List[float]]	✅ if not using documents	Precomputed vector embeddings (e.g., from sentence-transformers).
metadatas	List[Dict]	        ❌ No	Custom metadata (tags, categories, authors, timestamps). Useful for filtering queries.
uris	    List[str]	        ❌ No	Reference URLs for external documents.
timestamps	List[int]	        ❌ No	Unix timestamps for versioning and filtering based on document age.

