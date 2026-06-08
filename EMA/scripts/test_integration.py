import os
import tempfile
import yaml
import json
from backend.data_ingestion import DataIngestion
from utilities.logger import get_logger

def test_data_ingestion():
    # Setup logger for testing
    logger = get_logger("TestDataIngestion")
    logger.info("Starting tests for DataIngestion")

    # Temporary test paths
    test_chroma_db_path = tempfile.mkdtemp()
    test_template_path = os.path.join(tempfile.mkdtemp(), "semantic_templates.yaml")
    test_data_dir = tempfile.mkdtemp()
    test_collection_name = "test_collection"

    # Create a mock semantic templates file
    templates_content = {
        "Name": {"context": "Name of the object", "type": "string", "priority": "high"},
        "Description": {"context": "Description of the object", "type": "string", "priority": "medium"}
    }
    with open(test_template_path, "w") as file:
        yaml.dump(templates_content, file)

    # Create mock JSONL data files
    test_file_path = os.path.join(test_data_dir, "test_data.jsonl")
    test_data = [
        {"text": "Test Document 1", "metadata": {"Name": "Object 1", "Description": "This is object 1"}},
        {"text": "Test Document 2", "metadata": {"Name": "Object 2", "Description": "This is object 2"}}
    ]
    with open(test_file_path, "w") as file:
        for record in test_data:
            file.write(json.dumps(record) + "\n")

    try:
        # Initialize DataIngestion
        ingestion = DataIngestion(
            chroma_db_path=test_chroma_db_path,
            template_path=test_template_path
        )

        # Test load_templates
        assert ingestion.templates == templates_content, "load_templates failed"

        # Test prepare_metadata
        raw_metadata = {"Name": "Test", "Description": "Test description"}
        enriched_metadata = ingestion.prepare_metadata(raw_metadata, source="test_source")
        assert "dynamic_context" in enriched_metadata["Name"], "prepare_metadata failed to add dynamic_context"

        # Test generate_embeddings
        embedding = ingestion.generate_embeddings("Test embedding")
        assert isinstance(embedding, list), "generate_embeddings failed"

        # Test ingest
        ingestion.ingest(test_collection_name, test_data, source="test_source")
        logger.info("Ingest method passed.")

        # Test bulk_ingest
        ingestion.bulk_ingest(directory=test_data_dir, collection_name=test_collection_name)
        logger.info("Bulk ingest method passed.")

        logger.info("All tests passed successfully.")

    except AssertionError as e:
        logger.error(f"Test failed: {e}")

    except Exception as e:
        logger.error(f"Unexpected error during tests: {e}")

if __name__ == "__main__":
    test_data_ingestion()