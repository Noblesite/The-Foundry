import pickle
import pandas as pd
import logging
from utilities.path_manager import PathManager
from utilities.logger import get_logger

# Set up logging

logger = get_logger(__name__)

def validate_pickle_file(pickle_path, required_columns=None):
    """
    Validates the structure and data integrity of a pickle file containing a Pandas DataFrame.

    Args:
        pickle_path (str): Path to the pickle file.
        required_columns (list): List of columns that must exist in the DataFrame.

    Returns:
        None
    """
    try:
        # Load the pickle file
        with open(pickle_path, 'rb') as f:
            data = pickle.load(f)

        # Check if the loaded object is a DataFrame
        if not isinstance(data, pd.DataFrame):
            logger.error("The file does not contain a Pandas DataFrame.")
            return

        logger.info("Loaded DataFrame with %d rows and %d columns.", len(data), len(data.columns))

        # Check for required columns
        if required_columns:
            missing_columns = [col for col in required_columns if col not in data.columns]
            if missing_columns:
                logger.error("Missing required columns: %s", missing_columns)
            else:
                logger.info("All required columns are present.")

        # Display a sample of the data
        logger.info("Sample rows:")
        logger.info("%s", data.head())

        # Check for null values
        null_counts = data.isnull().sum()
        if null_counts.any():
            logger.warning("Null values detected in the following columns:")
            logger.warning("%s", null_counts[null_counts > 0])
        else:
            logger.info("No null values detected.")

        # Log every row in the DataFrame
        logger.info("Logging every row in the DataFrame:")
        for index, row in data.iterrows():
            logger.info("Row %d: %s", index, row.to_dict())

    except FileNotFoundError:
        logger.error("The file %s does not exist.", pickle_path)
    except Exception as e:
        logger.error("An error occurred while validating the pickle file: %s", e)

if __name__ == "__main__":
    path_manager = PathManager()    
    # Path to the pickle file
    pickle_file_path = path_manager.get_path("OMNISSA_API_DATASET")  # Replace with your pickle file path

    # Define required columns (adjust based on your dataset)
    required_cols = [
        "api_category", "api_name", "functionality", "description",
        "method", "url", "headers", "variables",
        "query_parameters", "request_body", "responses", "context"
    ]

    # Validate the pickle file
    validate_pickle_file(pickle_file_path, required_columns=required_cols)
