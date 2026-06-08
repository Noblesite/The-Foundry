import json
import pickle
from pathlib import Path
import pandas as pd
import logging
from utilities.path_manager import PathManager

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class JSONLToDataset:
    def __init__(self, input_path, output_path):
        self.input_path = Path(input_path)
        self.output_path = Path(output_path)

    def validate_jsonl(self, line):
        """Validates and parses a JSONL line."""
        try:
            record = json.loads(line)
            if isinstance(record, dict):
                return record
            else:
                logger.warning("Invalid record (not a dictionary): %s", line)
        except json.JSONDecodeError as e:
            logger.error("JSON decoding error: %s", e)
        return None

    def read_jsonl(self):
        """Reads and validates JSONL file."""
        if not self.input_path.exists():
            logger.error("Input file %s does not exist.", self.input_path)
            return []

        logger.info("Reading JSONL file: %s", self.input_path)
        records = []
        with self.input_path.open('r', encoding='utf-8') as f:
            for line in f:
                validated_record = self.validate_jsonl(line)
                if validated_record:
                    records.append(validated_record)

        logger.info("Loaded %d valid records from JSONL file.", len(records))
        return records

    def convert_to_dataframe(self, records):
        """Converts the list of records to a Pandas DataFrame."""
        try:
            df = pd.DataFrame(records)
            logger.info("Converted records to DataFrame with %d rows and %d columns.", len(df), len(df.columns))
            return df
        except Exception as e:
            logger.error("Error converting records to DataFrame: %s", e)
            return None

    def save_to_pickle(self, dataframe):
        """Saves the DataFrame to a pickle file."""
        try:
            with self.output_path.open('wb') as f:
                pickle.dump(dataframe, f)
            logger.info("Saved DataFrame to pickle file: %s", self.output_path)
        except Exception as e:
            logger.error("Error saving DataFrame to pickle file: %s", e)

    def process_jsonl(self):
        """Main processing function."""
        records = self.read_jsonl()
        if not records:
            logger.warning("No valid records found. Exiting.")
            return

        dataframe = self.convert_to_dataframe(records)
        if dataframe is not None:
            self.save_to_pickle(dataframe)

if __name__ == "__main__":
    path_manager = PathManager()
    input_file = path_manager.get_path("OMNISSA_STATIC_DATASET_PATH_API")
    output_file = path_manager.get_path("OMNISSA_API_DATASET")

    processor = JSONLToDataset(input_file, output_file)
    processor.process_jsonl()
