import ray
import os
import signal
import sys
from time import sleep
from utilities.logger import get_logger  # Replace with your logger setup if needed

# Initialize logger
logger = get_logger(__name__)

# === Graceful Shutdown Function ===
def shutdown_cluster():
    """
    Gracefully shut down the Ray cluster.
    """
    try:
        # Initialize Ray if not already connected
        if not ray.is_initialized():
            ray.init(address="auto")

        # Log connected resources
        resources = ray.cluster_resources()
        logger.info(f"Connected to Ray cluster. Resources: {resources}")

        # Get all active actors
        active_actors = ray.util.list_named_actors(all_namespaces=True)
        logger.info(f"Active actors: {active_actors}")

        # Gracefully terminate actors
        for actor_name in active_actors:
            try:
                logger.info(f"Shutting down actor: {actor_name}")
                actor = ray.get_actor(actor_name)
                if hasattr(actor, "shutdown"):
                    ray.get(actor.shutdown.remote())  # Call actor-specific shutdown method
                ray.kill(actor)  # Terminate the actor
            except Exception as e:
                logger.error(f"Failed to shut down actor {actor_name}: {e}")

        # Log active tasks
        logger.info("Cancelling remaining tasks...")
        ray.util.cancel_all_jobs()

        # Ensure Ray workers are terminated
        logger.info("Stopping Ray cluster gracefully...")
        ray.shutdown()

        # Stop Ray head and workers if running locally
        os.system("ray stop")
        logger.info("Ray cluster stopped successfully.")
    except Exception as e:
        logger.error(f"Error during Ray cluster shutdown: {e}")
    finally:
        logger.info("Cluster shutdown process complete.")

# === Signal Handler for Graceful Shutdown ===
def signal_handler(sig, frame):
    logger.warning("Interrupt received! Gracefully shutting down the Ray cluster...")
    shutdown_cluster()
    sys.exit(0)

# === Main Execution ===
if __name__ == "__main__":
    # Capture interrupt signals for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    logger.info("Graceful shutdown script running. Press Ctrl+C to stop.")

    try:
        # Simulate a running process (replace with monitoring logic if needed)
        while True:
            sleep(5)
    except KeyboardInterrupt:
        logger.warning("Shutdown script interrupted by user. Exiting...")