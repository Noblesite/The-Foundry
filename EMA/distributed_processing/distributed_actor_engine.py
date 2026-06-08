import ray
import time
from utilities.logger import get_logger
from utilities.system_stats import SystemStats
from distributed_processing.cluster_resources_worker import ClusterResource  # ✅ Import ClusterResource

class DistributedActorEngine:
    """Manages dynamic actor allocation and execution across all Ray worker nodes."""

    def __init__(self, actor_class, num_actors=None, max_retries=3):
        """
        Initializes the Distributed Actor Engine.
        
        :param actor_class: The Ray actor class to distribute.
        :param num_actors: Number of actors to spawn (None = auto-calculate).
        :param max_retries: Maximum retry attempts if an actor fails.
        """
        self.logger = get_logger("DistributedActorEngine")
        self.system_stats = SystemStats()
        self.actor_class = actor_class
        self.actors = {}
        self.futures = []
        self.max_retries = max_retries

        # ✅ Use ClusterResource to get worker nodes (filtered, structured data)
        self.cluster_resource = ClusterResource()
        self.nodes = list(self.cluster_resource.collect_node_stats().keys())  

        # Auto-scale based on available CPUs if not specified
        self.num_actors = num_actors or max(1, self.system_stats.get_available_cpus() // 4)
        self.logger.info(f"📡 Distributing {self.num_actors} actors across {len(self.nodes)} nodes.")

    def deploy_actors(self, *args, **kwargs):
        """Deploys the actors dynamically across available nodes, with retry handling."""
        cluster_resources = self.cluster_resource.collect_node_stats()

        for i, (node_name, node_info) in enumerate(cluster_resources.items()):
            num_cpus = max(1, node_info["cpu_count"] // 2)
            num_gpus = max(0, node_info["gpu_count"])

            self.logger.info(f"🚀 Deploying Actor {i+1}/{len(cluster_resources)} on Node {node_name} with {num_cpus} CPUs and {num_gpus} GPUs")

            self._start_actor(node_name, num_cpus, num_gpus, *args, **kwargs)

    def _start_actor(self, node_name, num_cpus, num_gpus, *args, **kwargs):
        """Attempts to start an actor with retry logic."""
        retries = 0
        while retries < self.max_retries:
            try:
                actor = self.actor_class.options(
                    num_cpus=num_cpus,
                    num_gpus=num_gpus,
                    resources={f"node:{node_name}": 0.1}
                ).remote(*args, **kwargs)

                self.actors[node_name] = actor
                self.logger.info(f"✅ Actor started successfully on {node_name}")
                return
            except Exception as e:
                retries += 1
                self.logger.error(f"❌ Actor deployment failed on {node_name} (Attempt {retries}/{self.max_retries}): {e}")
                time.sleep(5)  # Short delay before retry

        self.logger.error(f"❌ Failed to start actor on {node_name} after {self.max_retries} attempts.")

    def execute(self, method_name, *args, **kwargs):
        """Executes a method on all actors and tracks the results, retrying failed actors."""
        self.futures = []
        failed_actors = []

        for node_name, actor in self.actors.items():
            try:
                self.futures.append(getattr(actor, method_name).remote(*args, **kwargs))
            except Exception as e:
                self.logger.error(f"❌ Execution failed for actor on {node_name}: {e}")
                failed_actors.append(node_name)

        # Retry failed actors
        for node_name in failed_actors:
            self.logger.info(f"🔄 Retrying actor restart on {node_name}")
            cluster_resources = self.cluster_resource.collect_node_stats()
            node_info = cluster_resources.get(node_name)

            if node_info:
                self._start_actor(node_name, node_info["cpu_count"] // 2, node_info["gpu_count"], *args, **kwargs)

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