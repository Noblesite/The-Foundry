import json
import os
import statistics
from transformers import AutoTokenizer
from utilities.path_manager import PathManager
from tqdm import tqdm
from utilities.logger import get_logger

class DatasetTokenCounter:
    def __init__(self, model_name: str, dataset_path: str):
        """
        Initializes the token counter with the given model and dataset file path.
        
        Args:
            model_name (str): Name of the pretrained model (e.g., "meta-llama/Llama-3.2-3B-Instruct").
            dataset_path (str): Path to a JSONL file where each line is a record.
        """
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.dataset_path = dataset_path
        self.logger = get_logger("DatasetTokenCounter")

    def load_records(self) -> list:
        """
        Loads records from a JSONL file.
        
        Returns:
            List[str]: A list of text records.
        """
        records = []
        if not os.path.exists(self.dataset_path):
            raise FileNotFoundError(f"Dataset file not found: {self.dataset_path}")
        with open(self.dataset_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    # If the JSON object has a "text" field, use it; otherwise assume data is directly the text.
                    if isinstance(data, dict) and "text" in data:
                        record = data["text"]
                    else:
                        record = data
                    records.append(record)
                except json.JSONDecodeError:
                    # If line is not valid JSON, treat it as a raw text string.
                    records.append(line)
        return records

    def count_tokens(self, text: str) -> int:
        """
        Tokenizes a given text and returns the number of tokens.
        
        Args:
            text (str): The text to tokenize.
            
        Returns:
            int: Number of tokens.
        """
        if not isinstance(text, str):
            text = str(text)
        token_ids = self.tokenizer.encode(text, add_special_tokens=False)
        return len(token_ids)

    def generate_report(self) -> dict:
        """
        Generates a token count report for the entire dataset.
        
        Returns:
            dict: A report containing total records, min, max, average, median token counts,
                  and a mapping from record indices to their token counts.
        """
        records = self.load_records()
        token_counts = []
        record_counts = {}
        for idx, record in enumerate(tqdm(records, desc="Counting tokens")):
            count = self.count_tokens(record)
            token_counts.append(count)
            record_counts[idx] = count

        total_records = len(token_counts)
        min_tokens = min(token_counts) if total_records > 0 else 0
        max_tokens = max(token_counts) if total_records > 0 else 0
        avg_tokens = sum(token_counts) / total_records if total_records > 0 else 0
        median_tokens = statistics.median(token_counts) if total_records > 0 else 0

        report = {
            "total_records": total_records,
            "min_tokens": min_tokens,
            "max_tokens": max_tokens,
            "avg_tokens": avg_tokens,
            "median_tokens": median_tokens,
            "record_token_counts": record_counts  # Maps record indices to token counts.
        }
        return report

    def print_report(self):
        """
        Generates the token count report and prints it to the terminal.
        """
        report = self.generate_report()
        self.logger.info(json.dumps(report, indent=4))

if __name__ == "__main__":
    # Example usage:
    path_manager = PathManager()
    # Adjust these paths as necessary:
    dataset_file = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_filitired_Llama-3.2-3B-Instruct.jsonl"

    token_counter = DatasetTokenCounter(
        model_name="meta-llama/Llama-3.2-3B-Instruct",
        dataset_path=dataset_file
    )
    token_counter.print_report()