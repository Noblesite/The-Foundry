import json
import random
from pathlib import Path
from utilities.logger import get_logger


class JSONLDatasetPreparer:
    def __init__(self, input_file: str, train_output: str, val_output: str, val_ratio: float = 0.1, seed: int = 42, min_shuffles: int = 3, max_shuffles: int = 7):
        """
        Prepares and shuffles the dataset, then splits it into training and validation sets.

        :param input_file: Path to the input JSONL file.
        :param train_output: Path to save the training dataset.
        :param val_output: Path to save the validation dataset.
        :param val_ratio: Percentage of the dataset to use for validation (default 10%).
        :param seed: Random seed for reproducibility.
        :param min_shuffles: Minimum number of shuffles.
        :param max_shuffles: Maximum number of shuffles.
        """
        self.logger = get_logger("JSONLDatasetPreparer")
        self.input_file = Path(input_file)
        self.train_output = Path(train_output)
        self.val_output = Path(val_output)
        self.val_ratio = val_ratio
        self.seed = seed
        self.min_shuffles = min_shuffles
        self.max_shuffles = max_shuffles
        self.dataset = []


    def load_and_shuffle(self):
        """Loads and aggressively shuffles the dataset."""
        if not self.input_file.exists():
            self.logger.error(f"❌ File not found: {self.input_file}")
            return

        with self.input_file.open("r", encoding="utf-8") as f:
            self.dataset = [json.loads(line.strip()) for line in f]

        self.logger.info(f"📌 Loaded {len(self.dataset)} records.")

        # Aggressive shuffling strategy
        random.seed(self.seed)
        num_shuffles = random.randint(self.min_shuffles, self.max_shuffles)
        self.logger.info(f"🔀 Performing {num_shuffles} rounds of shuffling.")
        for _ in range(num_shuffles):
            random.shuffle(self.dataset)

        self.logger.info("✅ Dataset aggressively shuffled.")

    def split_dataset(self):
        """Splits dataset into training and validation sets, ensuring metadata consistency."""
        val_size = int(len(self.dataset) * self.val_ratio)
        train_set = self.dataset[val_size:]
        val_set = self.dataset[:val_size]

        # Clean metadata and remove answers in validation set
        for entry in val_set:
            entry["answer"] = "N/A"
        
        self.logger.info(f"📂 Train set: {len(train_set)} records")
        self.logger.info(f"📂 Validation set (answers removed): {len(val_set)} records")

        # Save datasets
        with self.train_output.open("w", encoding="utf-8") as f:
            for record in train_set:
                f.write(json.dumps(record) + "\n")

        with self.val_output.open("w", encoding="utf-8") as f:
            for record in val_set:
                f.write(json.dumps(record) + "\n")

        self.logger.info(f"✅ Train dataset saved to: {self.train_output}")
        self.logger.info(f"✅ Validation dataset saved to: {self.val_output}")

# Example usage:
if __name__ == "__main__":
    input_file = "stand_one_jsonl_to_rule_them_all.jsonl"
    train_output = "train_dataset.jsonl"
    val_output = "val_dataset.jsonl"

    preparer = JSONLDatasetPreparer(input_file, train_output, val_output)
    preparer.load_and_shuffle()
    preparer.split_dataset()