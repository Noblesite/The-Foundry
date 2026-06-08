import json
from pathlib import Path
from utilities.logger import get_logger

class JSONLConsolidator:
    def __init__(self, input_dir: str, output_file: str):
        """
        Initialize the consolidator with an input directory and an output file path.

        :param input_dir: Directory containing JSONL files.
        :param output_file: Path to the output JSONL file.
        """
        self.logger = get_logger("JSONLConsolidator")
        self.input_dir = Path(input_dir)
        self.output_file = Path(output_file)
        self.input_files = list(self.input_dir.glob("*.jsonl"))  # Find all JSONL files in the directory

    def consolidate(self):
        """
        Reads JSONL data from input files in the directory and appends it to the output file.
        Ensures that each line is properly formatted JSON.
        """
        if not self.input_files:
            self.logger.error(f"⚠️ No JSONL files found in {self.input_dir}. Nothing to consolidate.")
            return

        with self.output_file.open("w", encoding="utf-8") as out_f:
            for input_file in self.input_files:
                if not input_file.exists():
                    self.logger.warning(f"⚠️ Warning: {input_file} does not exist. Skipping.")
                    continue
                
                with input_file.open("r", encoding="utf-8") as in_f:
                    for line in in_f:
                        try:
                            json_obj = json.loads(line.strip())  # Validate JSON
                            out_f.write(json.dumps(json_obj, ensure_ascii=False) + "\n")
                        except json.JSONDecodeError as e:
                            self.logger.error(f"❌ Error: Invalid JSON in {input_file}: {e}")
                            continue
        self.logger.info(f"✅ Consolidation complete. Output saved to: {self.output_file}")

# Example usage:
if __name__ == "__main__":
    input_directory = "data/jsonl_files"  # Replace with the actual directory path
    output_file = "consolidated.jsonl"
    
    consolidator = JSONLConsolidator(input_directory, output_file)
    consolidator.consolidate()