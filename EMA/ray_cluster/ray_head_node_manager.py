#!/usr/bin/env python3

import os
import sys
import socket
import yaml
import subprocess
import psutil
from utilities.path_manager import PathManager

class RayHeadNodeManager:
    def __init__(self):
        """Initialize the Ray Head Node with system resource allocation."""
        self.total_ram_gb = psutil.virtual_memory().total // (1024 ** 3)
        self.num_cpus = psutil.cpu_count(logical=True)
        
        self._load_config()

        self.memory_percentage = self.config["head_node_resources"]["ray_obj_mem_perc"]
        self.memory_cap_gb = self.config["head_node_resources"]["ray_obj_mem_cap"]
        
        # ✅ Assign ~50% of RAM to Object Store (configurable with a cap at 32GB)
        self.object_store_memory_gb = min((self.total_ram_gb * self.memory_percentage) // 100, self.memory_cap_gb)
        self.object_store_memory_bytes = self.object_store_memory_gb * (1024 ** 3)

        self.node_ip = self._get_ip_address()
        self.hostname = self._get_hostname()

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

    def _get_ip_address(self):
        """Retrieve the first active non-loopback IP address."""
        try:
            for interface, addrs in psutil.net_if_addrs().items():
                for addr in addrs:
                    if addr.family == socket.AF_INET and not addr.address.startswith(("127.", "0.")):
                        return addr.address  # First valid IP found
        except Exception as e:
            print(f"⚠️ Error getting IP from network interfaces: {e}")

        return "127.0.0.1"  # Fallback to localhost

    def _get_hostname(self):
        """Retrieve the current machine's hostname."""
        return socket.gethostname()

    def start(self):
        """Start Ray Head Node with allocated system resources."""
        print(f"✅ Ray Head Node resolved IP: {self.node_ip}")
        print(f"✅ Assigned Hostname as Ray Resource: node:{self.hostname}")
        print(f"🔧 Allocating {self.num_cpus} CPUs, {self.object_store_memory_gb}GB Object Store Memory")

        subprocess.run(["ray", "stop", "--force"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        os.environ["RAY_ENABLE_WINDOWS_OR_OSX_CLUSTER"] = "1"
        os.environ["RAY_ENABLE_RECORD_ACTOR_TASK_LOGGING"] = "1"
        os.environ["RAY_worker_register_timeout_seconds"] = "60"
        os.environ["RAY_heartbeat_timeout_milliseconds"] = "60000"

        subprocess.run([
            "ray", "start", "--head", "--port=6379",
            f"--node-ip-address={self.node_ip}",
            "--dashboard-host=0.0.0.0",
            "--dashboard-port=8265",
            f"--num-cpus={self.num_cpus}",  # ✅ Dynamically assign CPUs
            f"--object-store-memory={self.object_store_memory_bytes}",
            f"--resources={{\"node:{self.hostname}\": 1}}"
        ])

        print(f"✅ Ray Dashboard: http://{self.node_ip}:8265")
        print(f"🚀 Head Node: {self.num_cpus} CPUs, {self.object_store_memory_gb} GB Object Store Memory")


if __name__ == "__main__":
    manager = RayHeadNodeManager()
    manager.start()