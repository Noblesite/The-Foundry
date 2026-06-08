import json
from pathlib import Path
from collections import defaultdict

class JSONLNoiseDetector:
    def __init__(self, input_file: str):
        """
        Initializes the noise detector for JSONL dataset analysis.

        :param input_file: Path to the JSONL file to analyze.
        """
        self.input_file = Path(input_file)
        self.records = []
        self.duplicates = set()
        self.length_issues = []
        self.default_values = defaultdict(int)
        self.metadata_issues = defaultdict(int)

    def load_data(self):
        """Loads JSONL data into memory for analysis."""
        if not self.input_file.exists():
            print(f"⚠️ Warning: {self.input_file} does not exist.")
            return

        seen_records = set()

        with self.input_file.open("r", encoding="utf-8") as file:
            for line in file:
                try:
                    json_obj = json.loads(line.strip())
                    self.records.append(json_obj)

                    # Check for duplicates based on question + context
                    duplicate_key = (json_obj.get("question", ""), json_obj.get("context", ""))
                    if duplicate_key in seen_records:
                        self.duplicates.add(duplicate_key)
                    else:
                        seen_records.add(duplicate_key)

                except json.JSONDecodeError as e:
                    print(f"❌ Skipping invalid JSON line: {e}")

    def check_text_lengths(self):
        """Finds records with unusually short or long fields."""
        for record in self.records:
            q_len = len(record.get("question", ""))
            a_len = len(record.get("answer", ""))
            c_len = len(record.get("context", ""))

            if q_len < 5 or q_len > 500:
                self.length_issues.append(("question", record["question"]))
            if a_len < 5 or a_len > 1000:
                self.length_issues.append(("answer", record["answer"]))
            if c_len > 2000:  # Context can be large but flag extreme cases
                self.length_issues.append(("context", record["context"]))

    def check_default_values(self):
        """Counts occurrences of common placeholders like 'N/A' and 'unknown'."""
        default_terms = {"N/A", "unknown", "", "None"}

        for record in self.records:
            for key in ["question", "answer", "context", "category", "type"]:
                if record.get(key, "") in default_terms:
                    self.default_values[key] += 1

            # Check metadata fields
            metadata = record.get("metadata", {})
            for meta_key, meta_value in metadata.items():
                if isinstance(meta_value, str) and meta_value in default_terms:
                    self.metadata_issues[meta_key] += 1

    def report(self):
        """Generates a report on dataset noise."""
        print("\n📊 **JSONL Noise Report**")
        print(f"📌 Total Records: {len(self.records)}")

        # Duplicates
        print(f"\n🔁 **Duplicate Entries:** {len(self.duplicates)}")
        if len(self.duplicates) > 0:
            print("   Example Duplicate:", next(iter(self.duplicates)))

        # Length Issues
        print(f"\n📏 **Suspicious Length Issues:** {len(self.length_issues)}")
        if len(self.length_issues) > 0:
            print("   Example Issue:", self.length_issues[0])

        # Default Values
        print("\n⚠️ **Common Default Values:**")
        for key, count in self.default_values.items():
            print(f"   - {key}: {count} occurrences")

        # Metadata Issues
        print("\n🔍 **Metadata Issues:**")
        for key, count in self.metadata_issues.items():
            print(f"   - {key}: {count} occurrences of 'N/A' or empty")

        print("\n✅ **Noise Detection Complete!**")

    def run_analysis(self):
        """Runs all noise detection checks."""
        self.load_data()
        self.check_text_lengths()
        self.check_default_values()
        self.report()

# Example usage:
if __name__ == "__main__":
    input_path = "filled_type.jsonl"  # JSONL file to analyze

    detector = JSONLNoiseDetector(input_path)
    detector.run_analysis()