import ray

@ray.remote
class NodeResourceWorker:
    """Ray worker to retrieve node IP addresses."""
    
    def get_node_ips(self):
        """Returns the list of alive node IPs in the Ray cluster."""
        return [node["NodeManagerAddress"] for node in ray.nodes() if node["Alive"]]