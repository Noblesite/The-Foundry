from dotenv import load_dotenv
import os
import requests
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from key_context import KeyContext
from utilities.logger import get_logger
from utilities.path_manager import PathManager

# Load environment variables
load_dotenv()
path_manager = PathManager()
logger = get_logger(__name__)
# Constants
API_URL = os.getenv('AIRWATCH_API_URL')
API_KEY = os.getenv('AIRWATCH_API_KEY')
API_TENANT = os.getenv('AW_TENANT_CODE')
PARENT_OG = os.getenv('AW_PARENT_OG_ID')
OUTPUT_DIRECTORY = path_manager.get_path("DEVELOPMENT_DATASET_PATH")

if not os.path.exists(OUTPUT_DIRECTORY):
    os.makedirs(OUTPUT_DIRECTORY)

# Load key context at the start of the script
KeyContext.load_context(path_manager.get_path("KEY_CONTEXT_PATH")) 

# Functions
def flatten_json(data, parent_key='', sep='_'):
    """Recursively flatten a nested JSON object."""
    items = {}
    if isinstance(data, list):
        for i, item in enumerate(data):
            items.update(flatten_json(item, f"{parent_key}_{i}" if parent_key else str(i)))
    elif isinstance(data, dict):
        for key, value in data.items():
            new_key = f"{parent_key}{sep}{key}" if parent_key else key
            items.update(flatten_json(value, new_key, sep))
    else:
        items[parent_key] = data
    return items

def enrich_data_with_context(data, parent_key: str):
    """Enrich each record with contextual information for semantic searches."""
    enriched_data = []
    for record in data:
        enriched_record = {}
        for key, value in record.items():
            context = KeyContext.get_context(key, parent_key)
            if context == "No context available for this key.":
                logger.debug(f"Missing context for key '{key}' under parent '{parent_key}'")
            enriched_record[key] = {
                "value": value,
                "context": context
            }
        enriched_data.append(enriched_record)
    return enriched_data

def fetch_airwatch_data(endpoint, parent_key=None, enrich=False):
    """Fetch data from AirWatch API and flatten or enrich each record."""
    full_url = f"{API_URL}/{endpoint}"
    response = requests.get(full_url, headers={
        "Authorization": f"Basic {API_KEY}",
        "aw-tenant-code": API_TENANT,
        "Content-Type": "application/json"
    })
    if response.status_code == 200:
        try:
            raw_data = response.json()
            flattened = [flatten_json(record) for record in (raw_data if isinstance(raw_data, list) else raw_data.get(next(iter(raw_data)), []))]
            return enrich_data_with_context(flattened, parent_key) if enrich else flattened
        except json.JSONDecodeError:
            logger.error(f"❌ Error decoding JSON response from {endpoint}")
    else:
        logger.error(f"❌ Error fetching {endpoint}: {response.status_code} - {response.text}")
    return []

def save_to_jsonl(data, filename):
    """Save data as a JSONL file with each flattened or enriched record on a new line."""
    if not data:
        logger.warning(f"⚠️ No data available for {filename}")
        return
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(OUTPUT_DIRECTORY, f"{filename}_{timestamp}.jsonl")
    with open(filepath, "w") as f:
        for record in data:
            f.write(json.dumps(record) + "\n")
    logger.info(f"✅ {filename} saved to {filepath}")

def collect_airwatch_state(enrich=False):
    """Collect AirWatch state data and save as flattened or enriched JSONL."""
    endpoints = {
        "devices": (f"mdm/devices/extensivesearch?organizationgroupid={PARENT_OG}", "Devices"),
        "profiles": (f"mdm/profiles/search?organizationgroupid={PARENT_OG}", "Profiles"),
        "products": (f"mdm/products/search?organizationgroupid={PARENT_OG}", "Products"),
        "smart_groups": (f"mdm/smartgroups/search?organizationgroupid={PARENT_OG}", "SmartGroups"),
        "tags": (f"mdm/tags/search?organizationgroupid={PARENT_OG}", "Tags"),
        "custom_attribute": (f"mdm/devices/customattribute/search?organizationgroupid={PARENT_OG}", "CustomAttributes"),
        "organization_groups": (f"system/groups/{PARENT_OG}/children", "OrganizationGroup"),
        "users": (f"system/users/search?locationgroupId={PARENT_OG}", "Users"),
        "user_groups": (f"system/usergroups/search?organizationgroupid={PARENT_OG}", "UserGroups"),
        "admins": (f"system/admins/search?organizationgroupid={PARENT_OG}", "Administrators"),
        "applications": (f"mam/apps/search?locationgroupid={PARENT_OG}&includeAppsFromChildOgs=True", "Applications")
    }

    with ThreadPoolExecutor(max_workers=11) as executor:
        futures = {
            data_type: executor.submit(fetch_airwatch_data, endpoint, parent_key, enrich)
            for data_type, (endpoint, parent_key) in endpoints.items()
        }
        for data_type, future in futures.items():
            save_to_jsonl(future.result(), data_type)

if __name__ == "__main__":
    collect_airwatch_state(enrich=True)
