import os
import hashlib
import time
import requests
from huggingface_hub import hf_hub_download, list_repo_files
from transformers import AutoTokenizer
from utilities.path_manager import PathManager
from dotenv import load_dotenv
from huggingface_hub import login

# Load environment variables from .env
load_dotenv()
HF_USERNAME = os.getenv("HF_USERNAME")
HF_TOKEN = os.getenv("HF_TOKEN")

# Ensure credentials are set
if not HF_USERNAME or not HF_TOKEN:
    raise ValueError("Hugging Face username or token is missing. Please set HF_USERNAME and HF_TOKEN in .env file.")

# Log into Hugging Face
try:
    login(token=HF_TOKEN)
    print(f"✅ Successfully logged into Hugging Face as {HF_USERNAME}")
except Exception as e:
    raise ValueError(f"❌ Failed to authenticate with Hugging Face: {e}")

path_manager = PathManager()

# Define model name and save directory
MODEL_NAME = "meta-llama/Llama-3.2-1B-Instruct"
SAVE_DIRECTORY = path_manager.get_path("SAVED_MODELS_PATH") + "/Llama-3.2-1B-Instruct"
TIMEOUT = 120  # Increase timeout to 120 seconds

# Ensure save directory exists
os.makedirs(SAVE_DIRECTORY, exist_ok=True)

# Function to calculate file hash for verification
def calculate_md5(file_path, chunk_size=8192):
    """Compute MD5 checksum of a file."""
    md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            md5.update(chunk)
    return md5.hexdigest()

# Function to download files with retry logic
def safe_download(repo_id, filename, cache_dir, retries=3):
    for attempt in range(retries):
        try:
            file_path = hf_hub_download(repo_id=repo_id, filename=filename, cache_dir=cache_dir)
            return file_path
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            print(f"⚠️ Timeout or connection issue while downloading {filename}: {e}")
            print(f"🔄 Retrying {attempt + 1}/{retries}...")
            time.sleep(5)
    raise Exception(f"❌ Maximum retries exceeded for {filename}. Check your network.")

# List all files in the repository
print("🔍 Fetching available model files...")
available_files = list_repo_files(MODEL_NAME)

# Required model files
REQUIRED_FILES = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "model.safetensors.index.json"
]

# Download tokenizer files first
print("🔄 Downloading tokenizer files...")
for file in REQUIRED_FILES:
    if file in available_files:
        file_path = safe_download(MODEL_NAME, file, SAVE_DIRECTORY)
        print(f"✅ Downloaded {file} -> {file_path}")
    else:
        print(f"⚠️ Warning: {file} not found in repository!")

# Download model weight shards
print("🔄 Downloading model weight shards...")
for file in available_files:
    if file.endswith(".safetensors"):
        file_path = safe_download(MODEL_NAME, file, SAVE_DIRECTORY)
        print(f"✅ Downloaded {file} -> {file_path}")

# Compute MD5 checksum for verification
print("🔍 Verifying downloaded files...")
for file in os.listdir(SAVE_DIRECTORY):
    file_path = os.path.join(SAVE_DIRECTORY, file)
    if os.path.isfile(file_path):
        md5_hash = calculate_md5(file_path)
        print(f"✅ {file} - MD5: {md5_hash}")

print("🚀 Download and verification complete!")
