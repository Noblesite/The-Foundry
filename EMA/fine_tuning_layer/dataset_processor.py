from torch.utils.data import DataLoader, IterableDataset
import json
import os
import time
import queue
from utilities.logger import get_logger
from glob import glob
from utilities.system_stats import SystemStats

class DatasetProcessor(IterableDataset):
    def __init__(self, dataset_path: str, check_point: str, batch_size=1, context_window_size=8192):
        """
        Initializes the dataset processor.

        Args:
            dataset_path (str): Path to a dataset file or directory.
            batch_size (int): Number of examples processed per batch.
            context_window_size (int): Maximum number of tokens allowed per record (sliding window).
        """
        self.logger = get_logger("DatasetProcessor")

        self.dataset_path = dataset_path
        self.batch_size = batch_size
   
        # ✅ Load dataset files
        self.dataset_files = self._get_dataset_files()

        # ✅ Count total records for warmup calculations
        self.total_records = self._count_total_records()

        self.current_file_index = 0
        self.data_cache = []
        self._load_next_file()

    def _count_total_records(self):
        """
        Counts the total number of records across all dataset files.
        Stores the result in `self.total_records`.
        """
        total_records = 0
        for file_path in self.dataset_files:
            try:
                with open(file_path, "r") as f:
                    file_record_count = sum(1 for _ in f)  # ✅ Count lines (records)
                    total_records += file_record_count
            except Exception as e:
                self.logger.error(f"Error reading file {file_path} for record count: {e}")

        self.logger.info(f"Total records in dataset: {total_records}")
        return total_records

    def _get_dataset_files(self):
        """
        Determines whether the dataset_path is a single file or directory.
        If a directory, gathers all JSONL files in sorted order.
        """
        if os.path.isdir(self.dataset_path):
            files = sorted(glob(os.path.join(self.dataset_path, "*.jsonl")))
            if not files:
                self.logger.error(f"No JSONL files found in directory: {self.dataset_path}")
                raise FileNotFoundError("Dataset directory is empty.")
            self.logger.info(f"Found {len(files)} dataset files in directory.")
            return files
        elif os.path.isfile(self.dataset_path):
            return [self.dataset_path]
        else:
            self.logger.error(f"Invalid dataset path: {self.dataset_path}")
            raise FileNotFoundError(f"Dataset path {self.dataset_path} does not exist.")

    def _load_next_file(self):
        """
        Loads the next dataset file into memory.
        """
        if self.current_file_index >= len(self.dataset_files):
            self.logger.info("All dataset files have been processed.")
            self.data_cache = []  # ✅ Empty cache to signal end of data
            return

        file_path = self.dataset_files[self.current_file_index]
        self.logger.info(f"Loading dataset file into memory: {file_path}")

        try:
            with open(file_path, "r") as f:
                self.data_cache = [json.loads(line.strip()) for line in f]
            
            self.logger.info(f"Loaded {len(self.data_cache)} records into memory.")
            self.current_file_index += 1  # ✅ Move to the next file for future calls

        except Exception as e:
            self.logger.error(f"Error reading dataset file {file_path}: {e}")
            self.data_cache = []  # Empty cache on failure
    
    def __iter__(self):
        """
        Iterates over the in-memory dataset in batches.
        Each record is assumed to be a JSON object with a "chunk_text" field.
        Yields:
            List[str]: A batch of text chunks.
        """
        while self.data_cache or self.current_file_index < len(self.dataset_files):
            if not self.data_cache:
                self._load_next_file()

            batch = []
            while self.data_cache and len(batch) < self.batch_size:
                example = self.data_cache.pop(0)
                # For the new dataset structure, we expect each record to have a "chunk_text" field.
                chunk = example.get("chunk_text", "")
                if not chunk:
                    self.logger.warning("Record missing 'chunk_text'; skipping record.")
                else:
                    batch.append(chunk)
            
            if batch:
                yield batch

    def prepare_qa_dataset(self, batch_size=1, num_workers=0):
        """
        Prepares a PyTorch DataLoader.
        Returns a DataLoader object that yields raw text.

        Args:
            batch_size (int): Not used here, dataset handles its own batching.
            num_workers (int): Number of workers for DataLoader.

        Returns:
            DataLoader: Streaming data loader for raw text batches.
        """
        return DataLoader(
            dataset=self,
            batch_size=None,  # ✅ DataLoader must NOT batch, batching happens in __iter__()
            num_workers=num_workers,
            pin_memory=True,
        )