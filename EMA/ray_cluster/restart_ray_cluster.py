import paramiko
import sys
import time
import os
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
import socket
import yaml
from utilities.path_manager import PathManager
from utilities.logger import get_logger



class RayClusterManager:
    def __init__(self):
        """Initialize the RayClusterManager and load node configurations dynamically from YAML."""
       
        load_dotenv()
        self.path_manager = PathManager()
        self.logger = get_logger("RayClusterManager")
        self._load_config()

        self.ssh_user = os.getenv("SSH_USER")  
        self.ssh_password = os.getenv("SSH_PASSWORD")      

        # ✅ Retrieve node hostnames from YAML
        self.head_node_hostname = self.config["nodes"]["head_node"]
        self.worker_nodes_hostnames = self.config["nodes"]["worker_nodes"]

        # ✅ Resolve hostnames to IPs
        self.head_node_ip = self._resolve_hostname(self.head_node_hostname)
        self.worker_nodes_ips = [self._resolve_hostname(node) for node in self.worker_nodes_hostnames]

    
        # ✅ Store dynamically retrieved paths
        self.python_exec_path = self._get_remote_python_exec_path(self.head_node_ip)
        self.project_root = self._get_remote_project_root(self.head_node_ip)

    def _load_config(self):
        """Load Ray cluster configurations from YAML file."""
        config_path = self.path_manager.get_path("RAY_CLUSTER_CONFIG")

        try:
            with open(config_path, "r") as file:
                self.config = yaml.safe_load(file)
        except Exception as e:
            print(f"⚠️ Failed to load Ray configuration: {e}")
            sys.exit(1)

    def _resolve_hostname(self, hostname):
        """Resolve a hostname to an IP address dynamically."""
        try:
            return socket.gethostbyname(hostname)
        except socket.gaierror:
            self.logger.error(f"❌ Failed to resolve {hostname}")
            return None

    def _run_ssh_command(self, node, command):
        """Execute SSH command on a node with virtual environment activation."""
        try:
            self.logger.info(f"🔧 Connecting to {node}...")
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            client.connect(node, username=self.ssh_user, password=self.ssh_password, timeout=10)

            # ✅ Ensure the virtual environment is activated before running the command
            activate_venv_cmd = "source /home/noblesite/Projects/EMA/venv/bin/activate"
            full_command = f"{activate_venv_cmd} && {command}"

            self.logger.info(f"🚀 Running command on {node}: {full_command}")
            stdin, stdout, stderr = client.exec_command(f"bash -c '{full_command}'")
            output = stdout.read().decode("utf-8").strip()
            error = stderr.read().decode("utf-8").strip()

            client.close()

            if error:
                self.logger.error(f"❌ Error on {node}: {error}")
            else:
                self.logger.info(f"✅ Success on {node}: {output}")

            return output

        except Exception as e:
            self.logger.error(f"❌ SSH connection failed for {node}: {str(e)}")
            return None

    def _get_remote_python_exec_path(self, node_ip):
        """Retrieve the Python executable path dynamically from a remote node."""
        command = "echo $(which python3)"
        return self._run_ssh_command(node_ip, command)

    def _get_remote_project_root(self, node_ip):
        """Retrieve the EMA project root directory dynamically from a remote node."""
        command = "echo $(dirname $(dirname $(realpath $(which python3))))"
        return self._run_ssh_command(node_ip, command)

    def _get_worker_script_path(self, script_name):
        """Retrieve the full path to a worker script dynamically."""
        return f"/home/noblesite/Projects/EMA/EMA/ray_cluster/{script_name}"

    def stop_ray_cluster(self):
        """Stop Ray cluster by killing worker and head node processes."""
        self.logger.info("🔻 Stopping Ray workers...")
        with ThreadPoolExecutor() as executor:
            executor.map(lambda node_ip: self._run_ssh_command(node_ip, "pkill -f ray_worker.py"), self.worker_nodes_ips)

        self.logger.info("🔻 Stopping Ray head node...")
        self._run_ssh_command(self.head_node_ip, "pkill -f ray_head_node_manager.py")

    def start_ray_cluster(self):
        """Start Ray cluster using Python scripts instead of CLI commands."""
        self.logger.info("🚀 Starting Ray head node...")

        head_script = self._get_worker_script_path("ray_head_node_manager.py")
        self._run_ssh_command(self.head_node_ip, f"{self.python_exec_path} {head_script}")

        time.sleep(5)  # Give the head node a moment to start

        self.logger.info("🚀 Starting Ray worker nodes...")
        with ThreadPoolExecutor() as executor:
            executor.map(
                lambda node_ip: self._run_ssh_command(node_ip, f"{self.python_exec_path} {self._get_worker_script_path('ray_worker.py')}"),
                self.worker_nodes_ips
            )

    def check_cluster_status(self):
        """Check Ray cluster status."""
        self.logger.info("🔍 Checking cluster status...")
        status = self._run_ssh_command(self.head_node_ip, "ray status")
        self.logger.info(f"📊 Cluster Status:\n{status}")

    def restart_cluster(self):
        """Restart Ray cluster."""
        self.logger.info("🔄 Restarting Ray cluster...")

        self.stop_ray_cluster()
        time.sleep(5)  # Short delay before restarting

        self.start_ray_cluster()
        time.sleep(5)

        self.check_cluster_status()
        self.logger.info("✅ Ray cluster restart completed!")


if __name__ == "__main__":
    cluster_manager = RayClusterManager()
    cluster_manager.restart_cluster()