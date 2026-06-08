import os
import yaml
from pathlib import Path

class PathManager:
    def __init__(self, config_path="configs/path_config.yaml"):
        BASE_DIR = Path(__file__).resolve().parent.parent
        config_path = BASE_DIR / "configs" / "path_config.yaml"
        self.base_dir = BASE_DIR
        self.config_path = Path(config_path)
        self.config = self.load_config()

    def load_config(self):
        """
        Load the YAML configuration file.
        """
        with open(self.config_path, "r") as file:
            return yaml.safe_load(file)

    def get_path(self, key: str) -> str:
        """
        Retrieve the path associated with a given key.
        """
        override = os.getenv(f"EMA_{key}")
        path = override or self.config["paths"].get(key)
        if path is None:
            return None

        resolved_path = Path(path)
        if not resolved_path.is_absolute():
            resolved_path = self.base_dir / resolved_path
        return str(resolved_path)

    def validate_paths(self):
        """
        Validate that all paths in the configuration exist.
        """
        for key, path in self.config["paths"].items():
            if not Path(path).exists():
                raise FileNotFoundError(f"Path for {key} does not exist: {path}")
        print("✅ All paths are valid.")

# Example usage
if __name__ == "__main__":
    pm = PathManager()
    print(pm.get_path("CHROMA_DB_PATH"))
    pm.validate_paths()
