import ray
import os
import json
import glob
from pathlib import Path
from utilities.logger import get_logger
from utilities.path_manager import PathManager

@ray.remote(num_cpus=2)
class DatasetCleanupActor:
    def __init__(self, temp_dir: str, final_dir: str):
        """
        Aggregates and consolidates the filtered dataset from multiple nodes.
        
        :param temp_dir: Temporary directory where filtered parts exist.
        :param final_dir: Permanent directory for the consolidated dataset.
        """
        self.logger = get_logger("DatasetCleanupActor")
        self.path_manager = PathManager()

        # Ensure paths are correctly set
        self.temp_dir = Path(self.path_manager.get_path(temp_dir))
        self.final_dir = Path(self.path_manager.get_path(final_dir))

        # Ensure directories exist
        self.final_dir.mkdir(parents=True, exist_ok=True)
        self.logger.info(f"📂 Cleanup Actor Initialized. Temp: {self.temp_dir}, Final: {self.final_dir}")

    def list_available_parts(self):
        """Lists dataset parts available in the temp directory."""
        files = [f.name for f in self.temp_dir.glob("*.jsonl")]
        self.logger.info(f"📜 Available dataset parts: {files}")
        return files

    def check_missing_parts(self, expected_parts):
        """
        Checks for missing dataset parts.
        
        :param expected_parts: List of expected dataset part filenames.
        :return: List of missing dataset parts.
        """
        available_parts = set(self.list_available_parts())
        missing_parts = [part for part in expected_parts if part not in available_parts]

        if missing_parts:
            self.logger.warning(f"⚠️ Missing dataset parts: {missing_parts}")
        else:
            self.logger.info("✅ All dataset parts are present.")

        return missing_parts

    def request_missing_parts(self, missing_parts, peer_actors):
        """
        Requests missing parts from other nodes.
        
        :param missing_parts: List of missing dataset parts.
        :param peer_actors: List of Ray actor references (other DatasetCleanupActors).
        """
        for missing_part in missing_parts:
            for peer in peer_actors:
                try:
                    self.logger.info(f"🔄 Requesting {missing_part} from peer {peer}")
                    part_data = ray.get(peer.fetch_dataset_part.remote(missing_part))
                    if part_data:
                        self._save_part(missing_part, part_data)
                        break  # Stop requesting once part is retrieved
                except Exception as e:
                    self.logger.error(f"❌ Failed to fetch {missing_part} from peer: {e}")

    def fetch_dataset_part(self, part_name):
        """
        Provides the requested dataset part if available.
        
        :param part_name: Name of the dataset part to fetch.
        :return: JSONL data as a string if found, else None.
        """
        part_path = self.temp_dir / part_name
        if part_path.exists():
            with open(part_path, "r", encoding="utf-8") as f:
                return f.read()
        self.logger.warning(f"⚠️ Requested part {part_name} not found.")
        return None

    def consolidate_dataset(self, expected_parts):
        """
        Merges all dataset parts into a single JSONL file in the final directory.
        """
        final_dataset_path = self.final_dir / "consolidated_dataset.jsonl"

        with open(final_dataset_path, "w", encoding="utf-8") as out_f:
            for part in expected_parts:
                part_path = self.temp_dir / part
                if part_path.exists():
                    with open(part_path, "r", encoding="utf-8") as in_f:
                        out_f.writelines(in_f.readlines())

        self.logger.info(f"🎉 Final dataset saved at {final_dataset_path}")

    def _save_part(self, part_name, data):
        """Saves a received dataset part."""
        part_path = self.temp_dir / part_name
        with open(part_path, "w", encoding="utf-8") as f:
            f.write(data)
        self.logger.info(f"✅ Saved received dataset part: {part_name}")