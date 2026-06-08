import json
from pathlib import Path

class JSONLDeduplicator:
    def __init__(self, input_file: str, output_file: str):
        """
        Deduplicates a JSONL dataset by removing exact duplicates of (question + context + answer).

        :param input_file: Path to the input JSONL file.
        :param output_file: Path to save the deduplicated JSONL file.
        """
        self.input_file = Path(input_file)
        self.output_file = Path(output_file)

    def deduplicate(self):
        """
        Reads JSONL data, removes exact duplicates, and writes the cleaned dataset.
        """
        unique_entries = set()
        total_records = 0
        duplicates_removed = 0

        with self.input_file.open("r", encoding="utf-8") as in_f, \
                self.output_file.open("w", encoding="utf-8") as out_f:

            for line in in_f:
                try:
                    json_obj = json.loads(line.strip())
                    key_tuple = (json_obj["question"], json_obj["context"], json_obj["answer"])  # Deduplication key

                    if key_tuple not in unique_entries:
                        unique_entries.add(key_tuple)
                        out_f.write(json.dumps(json_obj, ensure_ascii=False) + "\n")
                    else:
                        duplicates_removed += 1

                    total_records += 1

                except json.JSONDecodeError as e:
                    print(f"❌ Skipping invalid JSON line: {e}")

        print(f"✅ Deduplication complete!")
        print(f"📌 Total Records Processed: {total_records}")
        print(f"🗑️ Duplicates Removed: {duplicates_removed}")
        print(f"📂 Cleaned dataset saved to: {self.output_file}")

# Example usage:
if __name__ == "__main__":
    input_path = "meta_one_jsonl_to_rule_them_all.jsonl"  # Input dataset
    output_path = "deduplicated_one_jsonl_to_rule_them_all.jsonl"  # Deduplicated dataset

    deduplicator = JSONLDeduplicator(input_path, output_path)
    deduplicator.deduplicate()