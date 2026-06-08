import yaml
import sys
import ray
from utilities.path_manager import PathManager
from utilities.logger import get_logger

ray.init(address="auto", ignore_reinit_error=True)

@ray.remote
def get_node_stats():
    """Ray remote function for each node to report its system stats."""
    from utilities.system_stats import SystemStats 
    stats = SystemStats()
    return stats.get_all_stats()

class ClusterResource:
    """Manages and dynamically allocates compute resources across all Ray nodes."""

    def __init__(self):
        self.logger = get_logger("ClusterResource")
        self.path_manager = PathManager()
        self._load_config()
        self.head_node_hostname = self.config["nodes"]["head_node_hn"]
        self.node_stats = {}

    def _load_config(self):
        """Load Ray cluster configurations from YAML file."""
        path_manager = PathManager()
        config_path = path_manager.get_path("RAY_CLUSTER_CONFIG")

        try:
            with open(config_path, "r") as file:
                self.config = yaml.safe_load(file)
        except Exception as e:
            print(f"⚠️ Failed to load Ray configuration: {e}")
            sys.exit(1)

    def collect_node_stats(self):
        """Queries all Ray nodes, extracts structured node data, and filters active worker nodes."""
        self.logger.info("📡 Collecting system stats from all nodes...")

        nodes = ray.nodes()
        #self.logger.debug(f"Raw values from ray.nodes(): {nodes}")

        active_nodes = {}
        for node in nodes:
            if not node["Alive"]:
                continue  # Skip dead nodes

            node_ip = node["NodeManagerAddress"]
            node_hostname = node["NodeManagerHostname"]
            resources = node["Resources"]

            node_resource_key = next((key for key in resources.keys() if key.startswith("node:")), None)
            if not node_resource_key:
                self.logger.warning(f"⚠️ No resource key found for {node_hostname} ({node_ip}), skipping.")
                continue

            if node_hostname == self.head_node_hostname:
                self.logger.info(f"🛑 Skipping head node: {node_hostname} ({node_ip})")
                continue

            # ✅ Extract CPU & GPU count
            cpu_count = int(resources.get("CPU", 0))
            gpu_count = int(resources.get("GPU", 0))

            active_nodes[node_hostname] = {
                "ip": node_ip,
                "hostname": node_hostname,
                "resource_key": node_resource_key,
                "resources": resources,
                "cpu_count": cpu_count,
                "gpu_count": gpu_count,  # ✅ Now we have GPU info dynamically!
            }

        self.node_stats = active_nodes
        self.logger.info(f"✅ Collected stats for {len(active_nodes)} active worker nodes.")
        return active_nodes