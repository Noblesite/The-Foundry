#!/usr/bin/env python3

import os
import sys
import subprocess
import socket
import psutil
import yaml
from utilities.path_manager import PathManager
from utilities.logger import get_logger

class RayWorkerNode:
    def __init__(self):
        """Initialize RayWorker with dynamic resource allocation."""
        
        self.logger = get_logger("RayWorkerNode")   
        self.total_ram_gb = psutil.virtual_memory().total // (1024 ** 3)
        self.num_cpus = psutil.cpu_count(logical=True)

        # Load configurations
        self._load_config()
        self.head_node_hostname = self.config["nodes"]["head_node"]
         # ✅ Assign memory based on YAML config (default: 30% of RAM, cap at 16GB)
        self.memory_percentage = self.config["worker_node_resources"]["ray_obj_mem_perc"]
        self.memory_cap_gb = self.config["worker_node_resources"]["ray_obj_mem_cap"]
        
        self.object_store_memory_gb = min((self.total_ram_gb * self.memory_percentage) // 100, self.memory_cap_gb)
        self.object_store_memory_bytes = self.object_store_memory_gb * (1024 ** 3)

        self.node_ip = self._get_ip_address()
        self.hostname = self._get_hostname()

        self._resolve_head_node_ip()

    def _load_config(self):
        """Load Ray cluster configurations from YAML file."""
        path_manager = PathManager()
        config_path = path_manager.get_path("RAY_CLUSTER_CONFIG")

        try:
            with open(config_path, "r") as file:
                self.config = yaml.safe_load(file)
        except Exception as e:
            self.logger.error(f"⚠️ Failed to load Ray configuration: {e}")
            sys.exit(1)

    def _get_hostname(self):
        """Retrieve the current machine's hostname."""
        return socket.gethostname()
    
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

    def _resolve_head_node_ip(self):
        """Retrieve the IP address of the Ray head node."""
        try:
            if self.head_node_hostname:
                self.head_node_ip = socket.gethostbyname(self.head_node_hostname)
                if not self.head_node_ip or self.head_node_ip.startswith(("127.", "0.")):
                    raise ValueError("Invalid IP resolved")
        except (socket.gaierror, ValueError) as e:
            self.logger.error(f"❌ Failed to resolve head node IP: {e}")
            sys.exit(1)

    def start(self):
        """Start Ray worker and connect to the head node with assigned resources."""
        if not self.head_node_ip:
            self.logger.error("❌ Head node IP is not resolved. Exiting.")
            sys.exit(1)

        self.logger.info(f"✅ Resolved Head Node IP: {self.head_node_ip}")
        self.logger.info(f"✅ Worker Node Hostname: {self.hostname}")
        self.logger.info(f"🔧 Allocating {self.num_cpus} CPUs, {self.object_store_memory_gb}GB Object Store Memory")

        os.environ["RAY_ENABLE_WINDOWS_OR_OSX_CLUSTER"] = "1"
        os.environ["RAY_ENABLE_RECORD_ACTOR_TASK_LOGGING"] = "1"
        # 🟢 Mac-Specific Optimization
        if sys.platform == "darwin":
            os.environ["RAY_ENABLE_MAC_LARGE_OBJECT_STORE"] = "1"
        
        os.environ["RAY_worker_register_timeout_seconds"] = "60"
        os.environ["RAY_heartbeat_timeout_milliseconds"] = "60000"

        subprocess.run(["ray", "stop", "--force"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        result = subprocess.run([
            "ray", "start",
            f"--address={self.head_node_ip}:6379",
            f"--num-cpus={self.num_cpus}",
            f"--object-store-memory={self.object_store_memory_bytes}",
            f"--resources={{\"node:{self.hostname}\": 1}}"
        ])

        if result.returncode == 0:
            self.logger.info(f"🚀 Successfully connected to the Ray cluster with {self.num_cpus} CPUs, {self.object_store_memory_gb} GB Object Store!")
            self.logger.info(f"🔹 Assigned Hostname as Ray Resource: node:{self.hostname}")
        else:
            self.logger.error("❌ Failed to start Ray worker.")

if __name__ == "__main__":
    worker = RayWorkerNode()
    worker.start()