import json
import os
import datetime
from utilities.path_manager import PathManager

path_manager = PathManager()

CONVERSATION_LOG = path_manager.get_path("CONVERSATION_LOGGING_PATH")
os.makedirs(CONVERSATION_LOG, exist_ok=True)

def log_conversation(user_input, model_output, retrieval_metadata=None):
    timestamp = datetime.datetime.now().isoformat()
    log_entry = {
        "timestamp": timestamp,
        "user_input": user_input,
        "model_output": model_output,
        "retrieval_metadata": retrieval_metadata or {},
    }
    log_file = os.path.join("CONVERSATION_LOG")

    with open(log_file, "a") as f:
        f.write(json.dumps(log_entry) + "\n")