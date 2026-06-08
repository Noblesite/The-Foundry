import os
import sys
import subprocess
from uvicorn import run
from scripts.run_path_config import resolve_paths

# Add the project root to PYTHONPATH to ensure imports work
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

def start_frontend():
    """Starts the frontend using `npm run dev`"""
    frontend_path = os.path.join(os.path.dirname(__file__), "./frontend")  # Adjust this to match your frontend path
    subprocess.Popen(["npm", "run", "dev"], cwd=frontend_path, stdout=sys.stdout, stderr=sys.stderr)

if __name__ == "__main__":
    # Resolve paths
    resolve_paths()
    
    # Start the frontend
    start_frontend()

    # Run the FastAPI application
    run("backend.api_server:app", host="127.0.0.1", port=8000, reload=True)