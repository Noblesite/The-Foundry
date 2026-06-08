import json
from pathlib import Path
from utilities.logger import get_logger

class MalformedJSONLCleaner:
    """Cleans a dataset by removing 'N/A' values from metadata fields."""

    def __init__(self, input_file: str, output_file: str):        
        self.input_file = Path(input_file)
        self.output_file = Path(output_file)
        self.removed_count = 0  # Counter for removed 'N/A' values
        self.logger = get_logger("MalformedJSONLCleaner")

    def _remove_malformed_qa_pairs(self, qa_pair):
        question = qa_pair.get("question", "").strip()
        context = qa_pair.get("context", "").strip()
        answer = qa_pair.get("answer", "").strip()

        # ✅ Remove malformed records
        if not question or not context or not answer:
            self.removed_count += 1
            return None
        return qa_pair

    def clean(self):
        """Loads, cleans, and saves the dataset."""
        cleaned_records = []
        total_records = 0

        # Read dataset
        with self.input_file.open("r", encoding="utf-8") as f:
            for line in f:
                record = json.loads(line.strip())
                total_records += 1
                record = self._remove_malformed_qa_pairs(record)
                if record:  # ✅ Avoid appending None values
                    cleaned_records.append(record)

        # Save cleaned dataset
        with self.output_file.open("w", encoding="utf-8") as f:
            f.writelines(json.dumps(record) + "\n" for record in cleaned_records)  # ✅ Batch write

        self.logger.info(
            f"✅ Cleaned dataset saved to: {self.output_file} | "
            f"Removed: {self.removed_count} malformed QA pairs | "
            f"Valid records: {len(cleaned_records)} of {total_records}."
        )


# Example Usage
if __name__ == "__main__":
    cleaner = MalformedJSONLCleaner(
        input_file="/home/noblesite/Projects/EMA/EMA/distributed_data_layer/datasets/workspace_one_dirty.jsonl",
        output_file="/home/noblesite/Projects/EMA/EMA/distributed_data_layer/datasets/workspace_one_clean.jsonl"
    )
    cleaner.clean()