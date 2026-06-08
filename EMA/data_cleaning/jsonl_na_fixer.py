import json
from pathlib import Path
from utilities.logger import get_logger

class MetadataCleaner:
    """Cleans a dataset by removing 'N/A' values from metadata fields."""

    def __init__(self, input_file: str, output_file: str):
        self.input_file = Path(input_file)
        self.output_file = Path(output_file)
        self.removed_count = 0  # Counter for removed 'N/A' values
        self.updated_records = 0  # Counter for records modified
        self.logger = get_logger("Metadata Cleaner")

    def _clean_metadata(self, record):
        """Recursively removes metadata keys where the value is 'n/a' (case-insensitive),
        an empty list `[]`, or an empty dictionary `{}`."""
        
        if isinstance(record, str):
            if record.strip().lower() == "n/a":
                self.removed_count += 1
                return None  # Mark for removal
            return record

        elif isinstance(record, dict):
            cleaned_dict = {k: self._clean_metadata(v) for k, v in record.items()}
            cleaned_dict = {k: v for k, v in cleaned_dict.items() if v not in [None, {}, []]}
            
            if len(cleaned_dict) < len(record):  # If anything was removed
                self.updated_records += 1
            return cleaned_dict

        elif isinstance(record, list):
            cleaned_list = [self._clean_metadata(item) for item in record]
            cleaned_list = [item for item in cleaned_list if item not in [None, {}, []]]

            if len(cleaned_list) < len(record):  # If anything was removed
                self.updated_records += 1
            return cleaned_list

        return record  # Return as-is if it's neither a dict, list, nor string

    @staticmethod
    def _is_na(value):
        """Checks if a value is 'N/A' (case insensitive)."""
        return isinstance(value, str) and value.strip().lower() == "n/a"

    def clean(self):
        """Loads, cleans, and saves the dataset."""
        cleaned_records = []
        total_records = 0

        # Read dataset
        with self.input_file.open("r", encoding="utf-8") as f:
            for line in f:
                record = json.loads(line.strip())
                if "metadata" in record:
                    record["metadata"] = self._clean_metadata(record["metadata"])
                cleaned_records.append(record)

        # Save cleaned dataset
        with self.output_file.open("w", encoding="utf-8") as f:
            for record in cleaned_records:
                f.write(json.dumps(record) + "\n")

        self.logger.info(f"✅ Cleaned dataset saved to: {self.output_file} with {self.removed_count} 'N/A' values removed.")
        self.logger.info(f"✅ {self.updated_records} records were modified.")

# Example Usage
if __name__ == "__main__":
    cleaner = MetadataCleaner(
        input_file="/home/noblesite/Projects/EMA/EMA/distributed_data_layer/datasets/workspace_one_dirty.jsonl",
        output_file="/home/noblesite/Projects/EMA/EMA/distributed_data_layer/datasets/workspace_one_clean.jsonl"
    )
    cleaner.clean()