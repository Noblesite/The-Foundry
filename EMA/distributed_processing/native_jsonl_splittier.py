import json
import yaml
from pathlib import Path
from utilities.logger import get_logger
from utilities.path_manager import PathManager

class NativeJSONLSplitter:
    def __init__(self, input_file: str, output_dir: str, num_parts: int):
        """
        Splits a large JSONL file into `num_parts` based on file size.

        :param input_file: Path to the input JSONL file.
        :param output_dir: Directory where split files will be saved.
        :param num_parts: Desired number of file splits.
        """
        self.logger = get_logger("JSONLSplitter")
        self.path_manager = PathManager()

        config_path = self.path_manager.get_path("DISTRIBUTED_DATA")
        with open(config_path, "r") as file:
            self.config = yaml.safe_load(file)

        tmp_dir = self.config["distributed"]["tmp_distro_dir"]
        output_dir = output_dir + tmp_dir

        self.input_file = Path(input_file)
        self.output_dir = Path(output_dir)
        self.num_parts = max(1, num_parts)  # Ensure at least 1 part

        if not self.output_dir.exists():
            self.output_dir.mkdir(parents=True)

    def split(self):
        """Reads the input JSONL file and splits it into `num_parts` based on file size."""
        if not self.input_file.exists():
            self.logger.error(f"❌ File not found: {self.input_file}")
            return

        total_size = self.input_file.stat().st_size
        if total_size == 0:
            self.logger.warning("⚠️ Input file is empty. Nothing to split.")
            return

        target_size = max(1, total_size // self.num_parts)  # Ensure at least 1 byte per file

        self.logger.info(f"🔄 Splitting {total_size} bytes into {self.num_parts} parts (~{target_size} bytes each)")

        current_file_size = 0
        part_number = 1
        output_file = self._get_output_file(part_number)
        output_f = open(output_file, "w", encoding="utf-8")

        with self.input_file.open("r", encoding="utf-8") as in_f:
            for line in in_f:
                record_size = len(line.encode("utf-8"))

                if current_file_size + record_size > target_size and part_number < self.num_parts:
                    output_f.close()
                    self.logger.info(f"✅ Saved: {output_file} ({current_file_size} bytes)")
                    part_number += 1
                    current_file_size = 0
                    output_file = self._get_output_file(part_number)
                    output_f = open(output_file, "w", encoding="utf-8")

                output_f.write(line)
                current_file_size += record_size

        output_f.close()
        self.logger.info(f"✅ Final split saved: {output_file} ({current_file_size} bytes)")
        self.logger.info("🎉 Splitting complete!")

    def _get_output_file(self, part_number: int):
        """Generates a new output file path for the given part number."""
        return self.output_dir / f"{self.input_file.stem}_part{part_number}.jsonl"