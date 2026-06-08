import ray
import time
from utilities.logger import get_logger
from utilities.system_stats import SystemStats
from distributed_processing.cluster_resources_worker import ClusterResource

ray.init(address="auto", ignore_reinit_error=True)

class DirectedNodeActorEngine:
    """Manages actor allocation with explicit node control."""

    def __init__(self, node_actor_map, max_retries=1):
        """
        :param node_actor_map: A dictionary mapping node names to actor classes.
        :param max_retries: Maximum retry attempts if an actor fails.
        """
        self.logger = get_logger("DirectedNodeActorManager")
        self.system_stats = SystemStats()
        self.cluster_resource = ClusterResource()
        self.actors = {}
        self.node_actor_map = node_actor_map  # 🔥 Node-Actor Mapping
        self.max_retries = max_retries

    def deploy_actors(self, *args, **kwargs):
        """Deploys actors to specific nodes."""
        cluster_resources = self.cluster_resource.collect_node_stats()

        for node_name, actor_class in self.node_actor_map.items():
            node_info = cluster_resources.get(node_name)
            if not node_info:
                self.logger.error(f"❌ Node {node_name} not found in cluster. Skipping.")
                continue
            
            num_cpus = max(1, node_info["cpu_count"])
            num_gpus = max(0, node_info["gpu_count"])

            self.logger.info(f"🚀 Deploying {actor_class.__class__.__name__} on {node_name} ({num_cpus} CPUs, {num_gpus} GPUs)")

            self._start_actor(node_name, actor_class, num_cpus, num_gpus, *args, **kwargs)

    def _start_actor(self, node_name, actor_class, num_cpus, num_gpus, *args, **kwargs):
        """Attempts to start an actor on a specific node with retry logic."""
        retries = 0
        while retries < self.max_retries:
            try:
                actor = actor_class.options(
                    num_cpus=num_cpus,
                    num_gpus=num_gpus,
                    resources={f"node:{node_name}": 0.1}  # 🔥 Explicit Node Control
                ).remote(*args, **kwargs)  # ✅ Pass node_name as an argument

                self.actors[node_name] = actor
                self.logger.info(f"✅ {actor_class.__class__.__name__} started successfully on {node_name}")
                return
            except Exception as e:
                retries += 1
                self.logger.error(f"❌ {actor_class.__class__.__name__} failed on {node_name} (Attempt {retries}/{self.max_retries}): {e}")
                time.sleep(60)

        self.logger.error(f"❌ Failed to start {actor_class.__class__.__name__} on {node_name} after {self.max_retries} attempts.")

    def execute(self, method_name, *args, **kwargs):
        """Executes a method on all assigned actors."""
        self.futures = []

        for node_name, actor in self.actors.items():
            try:
                self.futures.append(getattr(actor, method_name).remote(*args, **kwargs))
            except Exception as e:
                self.logger.error(f"❌ Execution failed for actor on {node_name}: {e}")

    def wait_for_completion(self, timeout=None):
        """Waits for all futures to complete."""
        start_time = time.time()
        ready, not_ready = ray.wait(self.futures, num_returns=len(self.futures), timeout=timeout)

        if not_ready:
            self.logger.warning(f"⏳ Some tasks did not complete within {timeout}s.")

        self.logger.info(f"✅ All tasks completed in {time.time() - start_time:.2f}s.")
        return ray.get(ready)

    def cleanup(self):
        """Cleans up all actors after execution."""
        self.logger.info("🧹 Cleaning up actors...")
        for actor in self.actors.values():
            ray.kill(actor)
        self.actors.clear()