import requests
import json
from utilities.logger import get_logger

# Initialize Logger
logger = get_logger(__name__)

# API Server Base URL
BASE_URL = "http://localhost:8000"  # Ensure the API server is running locally on port 8000
HEADERS = {"Content-Type": "application/json"}


def test_query_endpoint():
    """
    Test the /query/ endpoint of the API server.
    """
    logger.info("Testing /query/ endpoint...")

    payload = {"query": "How many devices are enrolled in Workspace ONE?"}

    try:
        response = requests.post(f"{BASE_URL}/query/", json=payload, headers=HEADERS)
        logger.debug(f"Raw /query/ Response: {response.text}")
        if response.status_code == 200:
            try:
                data = response.json()
                logger.info(f"✅ /query/ Response: {json.dumps(data, indent=2)}")
            except ValueError as e:
                logger.error(f"❌ Error parsing JSON from /query/: {e}")
        else:
            logger.error(f"❌ /query/ returned status code {response.status_code}: {response.text}")
    except Exception as e:
        logger.error(f"❌ Error testing /query/: {e}")


def test_chat_endpoint():
    """
    Test the /chat/ endpoint of the API server.
    """
    logger.info("Testing /chat/ endpoint...")

    payload = {"text": "What products does DeviceId 841 have?."}

    try:
        response = requests.post(f"{BASE_URL}/chat/", json=payload, headers=HEADERS)
        logger.debug(f"Raw /chat/ Response: {response.text}")
        if response.status_code == 200:
            try:
                data = response.json()
                logger.info(f"✅ /chat/ Response: {json.dumps(data, indent=2)}")
            except ValueError as e:
                logger.error(f"❌ Error parsing JSON from /chat/: {e}")
        else:
            logger.error(f"❌ /chat/ returned status code {response.status_code}: {response.text}")
    except Exception as e:
        logger.error(f"❌ Error testing /chat/: {e}")


def test_feedback_endpoint():
    """
    Test the /feedback/ endpoint of the API server.
    """
    logger.info("Testing /feedback/ endpoint...")

    payload = {
        "query": "What is device compliance?",
        "llm_response": "Device compliance ensures devices meet policy requirements.",
        "user_feedback": "The response was accurate and helpful."
    }

    try:
        response = requests.post(f"{BASE_URL}/feedback/", json=payload, headers=HEADERS)
        logger.debug(f"Raw /feedback/ Response: {response.text}")
        if response.status_code == 200:
            try:
                data = response.json()
                logger.info(f"✅ /feedback/ Response: {json.dumps(data, indent=2)}")
            except ValueError as e:
                logger.error(f"❌ Error parsing JSON from /feedback/: {e}")
        else:
            logger.error(f"❌ /feedback/ returned status code {response.status_code}: {response.text}")
    except Exception as e:
        logger.error(f"❌ Error testing /feedback/: {e}")


if __name__ == "__main__":
    logger.info("🚀 Starting API Server Flow Tests...")
    test_query_endpoint()
    test_chat_endpoint()
    test_feedback_endpoint()
    logger.info("✅ API Server Flow Tests Completed.")