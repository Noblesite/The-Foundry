import json
import os
from typing import Any, List
from utilities.path_manager import PathManager
from model_layer.system_prompts import SystemPrompts
from utilities.logger import get_logger

#TODO: Update so that not all of the record gets sent. Need to train NER model
class FileReaderTool:
    def __init__(self):
        self.name = "file_reader"
        self.description = (
            "Searches JSONL documents for relevant information based on user query. "
            "Summarizes and evaluates records using confidence scoring."
        )
        self.logger = get_logger("FileReaderTool")
        self._path_manager = PathManager()
        self._jsonl_directory = self._path_manager.get_path("MODEL_FILE_READ_TOOL_FOLDER")
        self._run();

    def _list_jsonl_files(self) -> List[str]:
        """Lists all JSONL files in the specified directory."""
        return [f for f in os.listdir(self._jsonl_directory) if f.endswith(".jsonl")]

    def _load_jsonl_data(self, file_path: str) -> List[dict]:
        """Loads a JSONL file into a list of dictionaries."""
        with open(file_path, "r") as file:
            return [json.loads(line.strip()) for line in file]

    def _run(self):
        """Reads JSONL files and stores only high-confidence results."""
        for filename in self._list_jsonl_files():
            file_path = os.path.join(self._jsonl_directory, filename)
            self.records = self._load_jsonl_data(file_path)
    
    def get_records(self):
        return self.records