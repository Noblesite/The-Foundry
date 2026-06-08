import os
import signal
import subprocess
import sys
import asyncio
import psutil
from contextlib import suppress

# Paths (Adjust based on your project)
FASTAPI_SERVER = "backend.api_server:app"
NODE_SERVER_PATH = os.path.join(os.path.dirname(__file__), "frontend")

# Store process references
fastapi_process = None
node_process = None

async def start_servers():
    global fastapi_process, node_process

    # Start FastAPI server
    fastapi_process = subprocess.Popen(
        ["uvicorn", FASTAPI_SERVER, "--host", "0.0.0.0", "--port", "8000", "--reload"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    print("[✅] FastAPI Server started on port 8000")

    # Start Node.js server
    node_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=NODE_SERVER_PATH,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    print("[✅] Node.js Frontend started on port 3000")

async def shutdown_servers():
    global fastapi_process, node_process

    print("\n[⚠️] Initiating graceful shutdown...")

    # Stop FastAPI process
    if fastapi_process:
        print("[🔄] Stopping FastAPI server...")
        fastapi_process.terminate()
        with suppress(Exception):
            fastapi_process.wait(timeout=5)
        print("[✅] FastAPI server stopped.")

    # Stop Node.js process
    if node_process:
        print("[🔄] Stopping Node.js server...")
        node_process.terminate()
        with suppress(Exception):
            node_process.wait(timeout=5)
        print("[✅] Node.js server stopped.")

    # Kill orphaned processes
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        if any("uvicorn" in cmd for cmd in proc.info["cmdline"] or []) or \
           any("node" in cmd for cmd in proc.info["cmdline"] or []):
            proc.terminate()
            with suppress(Exception):
                proc.wait(timeout=5)

    print("[🚀] All servers shut down gracefully.")

def handle_exit(sig, frame):
    """Handles shutdown signals (CTRL+C, SIGTERM)."""
    loop = asyncio.get_event_loop()
    loop.run_until_complete(shutdown_servers())
    sys.exit(0)

# Attach signal handlers
signal.signal(signal.SIGINT, handle_exit)  # CTRL+C
signal.signal(signal.SIGTERM, handle_exit)  # System stop

# Run script
if __name__ == "__main__":
    try:
        asyncio.run(start_servers())
    except KeyboardInterrupt:
        handle_exit(None, None)