import ray

ray.init(address="auto", ignore_reinit_error=True)

@ray.remote(num_cpus=8)
class JSONLSplitterWorker:
    def __init__(self, path_manager_input_dir: str, max_size_mb: int = 500):
        """
        Splits a large JSONL file into smaller chunks (~500MB each).

        :param path_manager_input_dir: PathManager key for the input directory containing JSONL files.
        :param max_size_mb: Maximum file size for each split (default: 500MB).
        """
        import json
        import os
        import yaml
        from pathlib import Path
        from utilities.logger import get_logger
        from utilities.path_manager import PathManager

        self.path_manager = PathManager()
        self.logger = get_logger("JSONLSplitterWorker")

        config_path = self.path_manager.get_path("DISTRIBUTED_DATA")
        with open(config_path, "r") as file:
            self.config = yaml.safe_load(file)

        # ✅ Get the directory where the JSONL file(s) should be located
        self.input_file_dir = Path(self.path_manager.get_path(path_manager_input_dir))

        # ✅ Dynamically find the JSONL file
        jsonl_files = list(self.input_file_dir.glob("*.jsonl"))
        
        if not jsonl_files:
            self.logger.error(f"❌ No JSONL files found in {self.input_file_dir}")
            raise FileNotFoundError(f"No JSONL files found in {self.input_file_dir}")

        # ✅ Take the first JSONL file (you can modify this logic if needed)
        self.input_file = jsonl_files[0]
        self.logger.info(f"📂 Found JSONL file: {self.input_file}")

        # ✅ Set the output directory
        self.output_dir = Path(self.path_manager.get_path(path_manager_input_dir) + self.config["distributed"]["tmp_distro_dir"])
        self.max_size_bytes = max_size_mb * 1024 * 1024  # Convert MB to Bytes
        self.part_number = 1

        # ✅ Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def split(self):
        """
        Reads the input JSONL file and writes records into separate ~500MB files.
        """
        if not self.input_file.exists():
            self.logger.error(f"❌ File not found: {self.input_file}")
            return

        self.logger.info(f"🔄 Splitting {self.input_file} into {self.max_size_bytes} byte chunks...")
        current_file_size = 0
        output_file = self._get_output_file()
        output_f = open(output_file, "w", encoding="utf-8")

        with self.input_file.open("r", encoding="utf-8") as in_f:
            for line in in_f:
                record_size = len(line.encode("utf-8"))

                # Check if adding this record exceeds the size limit
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