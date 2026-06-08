import json
from pathlib import Path

class JSONLKeySplitter:
    def __init__(self, input_file: str, output_with_key: str, output_without_key: str, key_to_check: str):
        """
        Initialize the splitter with input/output file paths and the key to check.

        :param input_file: Path to the input JSONL file.
        :param output_with_key: Path to output JSONL file where the key exists.
        :param output_without_key: Path to output JSONL file where the key is missing.
        :param key_to_check: The top-level key to check for presence.
        """
        self.input_file = Path(input_file)
        self.output_with_key = Path(output_with_key)
        self.output_without_key = Path(output_without_key)
        self.key_to_check = key_to_check

    def split(self):
        """
        Reads the JSONL file and splits it into two new files:
        - One where the specified key is present.
        - One where the specified key is missing.
        """
        if not self.input_file.exists():
            print(f"⚠️ Warning: {self.input_file} does not exist.")
            return

        with self.input_file.open("r", encoding="utf-8") as in_f, \
                self.output_with_key.open("w", encoding="utf-8") as out_with, \
                self.output_without_key.open("w", encoding="utf-8") as out_without:

            for line in in_f:
                try:
                    json_obj = json.loads(line.strip())

                    if self.key_to_check in json_obj and json_obj[self.key_to_check]:  
                        # Write to the file where the key is present
                        out_with.write(json.dumps(json_obj, ensure_ascii=False) + "\n")
                    else:
                        # Write to the file where the key is missing
                        out_without.write(json.dumps(json_obj, ensure_ascii=False) + "\n")

                except json.JSONDecodeError as e:
                    print(f"❌ Skipping invalid JSON line: {e}")

        print(f"✅ Splitting complete.\n- Records with '{self.key_to_check}' saved to: {self.output_with_key}\n- Records without '{self.key_to_check}' saved to: {self.output_without_key}")

# Example usage:
if __name__ == "__main__":
    input_path = "dataset.jsonl"
    output_with_key_path = "with_context.jsonl"
    output_without_key_path = "without_context.jsonl"
    key_to_check = "context"

    splitter = JSONLKeySplitter(input_path, output_with_key_path, output_without_key_path, key_to_check)
    splitter.split()