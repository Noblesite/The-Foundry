import json
import os
from pathlib import Path
from utilities.logger import get_logger

class JSONLSplitter:
    def __init__(self, input_file: str, output_dir: str, max_size_mb: int = 500):
        """
        Splits a large JSONL file into smaller chunks (~500MB each).

        :param input_file: Path to the input JSONL file.
        :param output_dir: Directory where split files will be saved.
        :param max_size_mb: Maximum file size for each split (default: 500MB).
        """
        self.logger = get_logger("JSONLSplitter")
        self.input_file = Path(input_file)
        self.output_dir = Path(output_dir)
        self.max_size_bytes = max_size_mb * 1024 * 1024  # Convert MB to Bytes
        self.part_number = 1

        if not self.output_dir.exists():
            self.output_dir.mkdir(parents=True)

    def split(self):
        """
        Reads the input JSONL file and writes records into separate ~500MB files.
        """
        if not self.input_file.exists():
            self.logger.error(f"❌ File not found: {self.input_file}")
            return

        current_file_size = 0
        output_file = self._get_output_file()
        output_f = open(output_file, "w", encoding="utf-8")

        with self.input_file.open("r", encoding="utf-8") as in_f:
            for line in in_f:
                record_size = len(line.encode("utf-8"))

                # Check if adding this record exceeds the 500MB limit
                if current_file_size + record_size > self.max_size_bytes:
                    output_f.close()
                    self.logger.info(f"✅ Saved: {output_file} ({current_file_size / (1024 * 1024):.2f}MB)")
                    self.part_number += 1
                    current_file_size = 0
                    output_file = self._get_output_file()
                    output_f = open(output_file, "w", encoding="utf-8")

                # Write record
                output_f.write(line)
                current_file_size += record_size

        output_f.close()
        self.logger.info(f"✅ Final split saved: {output_file} ({current_file_size / (1024 * 1024):.2f}MB)")
        self.logger.info("🎉 Splitting complete!")

    def _get_output_file(self):
        """
        Generates a new output file path for the next chunk.
        """
        return self.output_dir / f"{self.input_file.stem}_part{self.part_number}.jsonl"

# Example Usage
if __name__ == "__main__":
    input_file = "large_dataset.jsonl"
    output_dir = "split_jsonl_data"

    splitter = JSONLSplitter(input_file, output_dir)
    splitter.split()