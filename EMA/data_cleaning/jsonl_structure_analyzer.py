import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Set, Any
from utilities.logger import get_logger


class JSONLStructureAnalyzer:
    def __init__(self, input_file: str):
        """
        Initialize with the JSONL file path.

        :param input_file: Path to the input JSONL file.
        """
        self.logger = get_logger("JSONLStructureAnalyzer")
        self.input_file = Path(input_file)
        self.key_frequencies = defaultdict(int)
        self.metadata_keys = defaultdict(int)
        self.example_values = defaultdict(set)
        self.metadata_types = defaultdict(set)  # Tracks data types in metadata fields
        self.inconsistent_types = defaultdict(set)  # Tracks metadata keys with mixed types
        self.missing_keys = defaultdict(int)  # Tracks missing metadata keys
        self.empty_values = defaultdict(int)  # Tracks empty fields
        self.total_records = 0
        self.type_frequencies = defaultdict(int)  # Track frequencies of `type` values

    def analyze_structure(self):
        """
        Scans the JSONL file and collects:
        - Unique keys and their frequencies.
        - Unique metadata keys and their frequencies.
        - Example values for each key.
        - Data types within metadata fields.
        - Inconsistent data types across records.
        - Missing metadata keys.
        - Empty values statistics.
        - Total number of records.
        """
        if not self.input_file.exists():
            self.logger.warning(f"⚠️ Warning: {self.input_file} does not exist.")
            return

        with self.input_file.open("r", encoding="utf-8") as file:
            for line_num, line in enumerate(file, 1):
                try:
                    json_obj = json.loads(line.strip())
                    self.total_records += 1
                    # Track `type` key frequencies
                    type_value = json_obj.get("type", "Unknown")
                    self.type_frequencies[type_value] += 1

                    # Analyze top-level keys
                    for key, value in json_obj.items():
                        self.key_frequencies[key] += 1
                        self.example_values[key].add(self._shorten_value(value))

                    # Analyze metadata keys if present
                    metadata = json_obj.get("metadata", {})
                    if isinstance(metadata, dict):
                        for meta_key, meta_value in metadata.items():
                            self.metadata_keys[meta_key] += 1
                            self.example_values[f"metadata.{meta_key}"].add(self._shorten_value(meta_value))

                            # Track data types
                            value_type = self._get_type(meta_value)
                            self.metadata_types[meta_key].add(value_type)

                            # Detect inconsistent types
                            if len(self.metadata_types[meta_key]) > 1:
                                self.inconsistent_types[meta_key] = self.metadata_types[meta_key]

                            # Track empty values
                            if self._is_empty(meta_value):
                                self.empty_values[meta_key] += 1

                    # Identify missing metadata keys
                    for expected_key in self.metadata_keys:
                        if expected_key not in metadata:
                            self.missing_keys[expected_key] += 1

                except json.JSONDecodeError as e:
                    self.logger.error(f"❌ Skipping invalid JSON at line {line_num}: {e}")

    def _get_type(self, value: Any) -> str:
        """Returns the data type as a string with enhanced recognition."""
        if isinstance(value, list):
            return "list"
        elif isinstance(value, dict):
            return "dict"
        elif isinstance(value, str):
            return "str"
        elif isinstance(value, int):
            return "int"
        elif isinstance(value, float):
            return "float"
        elif value is None:
            return "null"
        return type(value).__name__

    def _is_empty(self, value: Any) -> bool:
        """Checks if a value is empty (`null`, `"N/A"`, `{}`, `[]`)."""
        return value in [None, "N/A", "n/a", "", {}, []]

    def _shorten_value(self, value):
        """Returns a short string representation of the value."""
        if isinstance(value, str) and len(value) > 50:
            return value[:47] + "..."  # Truncate long strings
        if isinstance(value, list):
            return f"List[{len(value)} items]"
        if isinstance(value, dict):
            return f"Dict[{len(value)} keys]"
        return str(value)

    def report(self):
        """Prints a summary of the JSONL structure."""
        self.logger.info("\n📊 JSONL Structure Report")
        self.logger.info(f"📌 Total Records: {self.total_records}")
        self.logger.info("\n📊 Type Value Distribution:")
        for type_value, count in self.type_frequencies.items():
            self.logger.info(f"  - {type_value}: {count}/{self.total_records} ({round((count / self.total_records) * 100, 2)}%)")

        self.logger.info("\n🔑 Key Frequencies:")
        for key, count in self.key_frequencies.items():
            self.logger.info(f"  - {key}: {count}/{self.total_records} ({round((count / self.total_records) * 100, 2)}%)")

        self.logger.info("\n📝 Metadata Keys Frequencies:")
        for key, count in self.metadata_keys.items():
            self.logger.info(f"  - metadata.{key}: {count}/{self.total_records} ({round((count / self.total_records) * 100, 2)}%)")

        self.logger.info("\n🔍 Metadata Key Data Types:")
        for key, types in self.metadata_types.items():
            self.logger.info(f"  - metadata.{key}: {', '.join(types)}")

        self.logger.info("\n🚨 Inconsistent Metadata Types:")
        if not self.inconsistent_types:
            self.logger.info("  ✅ No inconsistent metadata types found!")
        else:
            for key, types in self.inconsistent_types.items():
                self.logger.info(f"  - metadata.{key}: {', '.join(types)} ⚠️")

        self.logger.info("\n⚠️ Missing Metadata Keys:")
        if not self.missing_keys:
            self.logger.info("  ✅ No missing metadata keys!")
        else:
            for key, count in self.missing_keys.items():
                self.logger.info(f"  - metadata.{key}: Missing in {count} records ({round((count / self.total_records) * 100, 2)}%)")

        self.logger.info("\n🛑 Empty Values Count:")
        if not self.empty_values:
            self.logger.info("  ✅ No empty metadata values detected!")
        else:
            for key, count in self.empty_values.items():
                self.logger.info(f"  - metadata.{key}: {count} empty values ({round((count / self.total_records) * 100, 2)}%)")

        self.logger.info("\n🔍 Example Values:")
        for key, examples in self.example_values.items():
            self.logger.info(f"  - {key}: {', '.join(list(examples)[:3])}")  # Show up to 3 example values


# Example usage:
if __name__ == "__main__":
    input_path = "input.jsonl"

    analyzer = JSONLStructureAnalyzer(input_path)
    analyzer.analyze_structure()
    analyzer.report()