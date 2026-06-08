import json
import re

class DatasetTabNewLineCleaner:
    """
    A class for cleaning JSONL datasets by removing unnecessary newlines, tabs, 
    extra spaces, and preserving JSON structure.
    """

    def __init__(self, input_file: str, output_file: str):
        """
        Initializes the DatasetCleaner with input and output file paths.
        
        :param input_file: Path to the input JSONL dataset file.
        :param output_file: Path to save the cleaned JSONL dataset.
        """
        self.input_file = input_file
        self.output_file = output_file

    def _clean_text(self, value):
        """
        Cleans a string value by removing newlines, tabs, and extra spaces.
        
        :param value: The string to clean.
        :return: A cleaned string.
        """
        if isinstance(value, str):
            value = re.sub(r'[\n\t]', ' ', value)  # Remove newlines and tabs
            value = re.sub(r'\s+', ' ', value).strip()  # Remove excessive spaces
        return value

    def _clean_json(self, data):
        """
        Recursively cleans JSON data (dict, list, or strings).
        
        :param data: JSON-like structure (dict, list, str).
        :return: Cleaned JSON structure.
        """
        if isinstance(data, dict):
            return {key: self._clean_json(value) for key, value in data.items()}
        elif isinstance(data, list):
            return [self._clean_json(item) for item in data]
        else:
            return self._clean_text(data)

    def clean_dataset(self):
        """
        Reads a JSONL file, cleans each record, and writes the cleaned records to the output file.
        """
        with open(self.input_file, "r", encoding="utf-8") as infile, open(self.output_file, "w", encoding="utf-8") as outfile:
            for line in infile:
                data = json.loads(line)  # Parse JSON
                cleaned_data = self._clean_json(data)  # Clean data
                outfile.write(json.dumps(cleaned_data, ensure_ascii=False) + "\n")  # Save cleaned JSONL
        print(f"✅ Dataset cleaning completed! Cleaned file saved at: {self.output_file}")

# Example Usage:
# cleaner = DatasetCleaner("qa_pairs.jsonl", "cleaned_qa_pairs.jsonl")
# cleaner.clean_dataset()