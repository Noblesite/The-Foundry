# query_chroma_db_tool.py
import json

from data_layer.vector_database import VectorDatabase
from typing import Any


class QueryChromaDBTool():
   
    def __init__(self, vector_db: VectorDatabase):
        # Initialize the parent and then set the private attribute.
        
        self.name = "query_chroma_db"
        self.description = (
        "A tool to query ChromaDB for Workspace One UEM data. "
        "Input should be a natural language query, e.g., 'Chad Veloso last login'. "
        "The tool returns JSON data with the retrieved records."
        )
        self._vector_db = vector_db

    def _run(self, query: str) -> str:
        # Use the private attribute for operations.
        best_collection = self._vector_db.find_best_collection(query)
        if not best_collection:
            return #"No suitable collection found in ChromaDB."
        #TODO: Need to abstract recored amount to ema_config
        results = self._vector_db.query(best_collection, query, top_k=1)
        return json.dumps(results, indent=2)

    async def _arun(self, query: str) -> str:
        raise NotImplementedError("Async execution is not supported for this tool.")