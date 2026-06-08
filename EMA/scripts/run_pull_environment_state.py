import os
import subprocess
from utilities.logger import get_logger

logger = get_logger(__name__)

def run_pull_environment_state():
    """
    Executes the pull_omnissa_enviroment_state.py script from the data_layer directory.
    """
    script_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "../data_layer/pull_omnissa_enviroment_state.py"
    )
    try:
        subprocess.run(["python", script_path], check=True)
        logger.info("✅ Environment state successfully pulled.")
    except subprocess.CalledProcessError as e:
        logger.error(f"❌ Failed to pull environment state. Error: {e}")
    except FileNotFoundError:
        logger.error(f"❌ Script not found at path: {script_path}")

if __name__ == "__main__":
    run_pull_environment_state()