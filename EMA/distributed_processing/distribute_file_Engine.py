import ray
import yaml
import socket
from pathlib import Path
import zstandard as zstd  # ✅ Fast compression for large files

from distributed_processing.node_resource_worker import NodeResourceWorker
from distributed_processing.native_jsonl_splittier import NativeJSONLSplitter
from distributed_processing.distribute_files_worker import DistributeFilesWorker
from distributed_processing.data_splititing_worker import JSONLSplitterWorker
from utilities.path_manager import PathManager
from utilities.logger import get_logger
from distributed_processing.cluster_resources_worker import ClusterResource  # ✅ Updated Cluster Resource Class


class DistributeFileEngine:
    """Manages the distribution and splitting of large JSONL datasets across a Ray cluster."""

    def __init__(self, input_file: str, output_dir: str, path_manager_path: str):
        self.logger = get_logger("DistributeFile")
        self.path_manager = PathManager()
        self.input_file = input_file
        self.output_dir = output_dir
        self.remote_node_directory = path_manager_path
        self.num_of_nodes = 0  # Will be dynamically updated

    def distribute_and_split(self):
        """Main entry point for distributing and splitting the dataset."""
        self._get_cluster_resources()
        self._split_distributed_file()
        self._send_data_to_nodes()

    #TODO remove the head node from the list of node resources
    def _get_cluster_resources(self):
        """Collects available cluster resources and stores structured node data."""
        self.logger.info("📡 Retrieving cluster resources...")

        # ✅ Use the updated ClusterResource class
        cluster_resource = ClusterResource()
        self.node_stats = cluster_resource.collect_node_stats()

        # ✅ Extract node hostnames for worker assignment
        self.node_hostnames = list(self.node_stats.keys())
        self.num_of_nodes = len(self.node_hostnames)

        if self.num_of_nodes == 0:
            self.logger.error("❌ No active nodes found! Aborting.")
            return

        self.logger.info(f"✅ Found {self.num_of_nodes} active nodes: {self.node_hostnames}")

    def _split_distributed_file(self):
        """Splits the input dataset into chunks based on the number of nodes."""
        if self.num_of_nodes == 0:
            self.logger.error("❌ No nodes available for splitting. Aborting.")
            return

        splitter = NativeJSONLSplitter(self.input_file, self.output_dir, self.num_of_nodes)
        splitter.split()

    def _send_data_to_nodes(self):
        """Distributes split JSONL files across Ray nodes as compressed Zstd data for faster transmission."""

        config_path = self.path_manager.get_path("DISTRIBUTED_DATA")
        with open(config_path, "r") as file:
            self.config = yaml.safe_load(file)

        tmp_dir = self.config["distributed"]["tmp_distro_dir"]
        self.split_output_dir = self.output_dir + tmp_dir

        self.output_files = list(Path(self.split_output_dir).glob("*.jsonl"))  # Get all split files
        if not self.output_files:
            self.logger.warning("⚠️ No files found to distribute. Skipping.")
            return

        self.logger.info(f"🚀 Compressing and distributing {len(self.output_files)} split files to nodes (parallel mode).")

        # ✅ Ensure Ray is initialized
        if not ray.is_initialized():
            ray.init(ignore_reinit_error=True)

        if self.num_of_nodes == 0:
            self.logger.error("❌ No active nodes found! Aborting file distribution.")
            return

        if len(self.output_files) > self.num_of_nodes:
            self.logger.warning(f"⚠️ More files ({len(self.output_files)}) than nodes ({self.num_of_nodes}), some nodes will receive multiple files.")

        # ✅ Create a worker on each available node using hostnames
        workers = {
            hostname: DistributeFilesWorker.options(
                resources={node_info["resource_key"]: 1},  # ✅ Use structured resource key
                max_restarts=3,
                max_task_retries=5
            ).remote()
            for hostname, node_info in self.node_stats.items()
        }

        # ✅ Compress files before sending
        compressed_files = []
        file_map = {}  # ✅ Track file assignments for verification

        for file_path in self.output_files:
            compressed_file_path = file_path.with_suffix(".jsonl.zst")

            self.logger.info(f"📦 Compressing {file_path.name} → {compressed_file_path.name}...")
            with open(file_path, "rb") as f_in, open(compressed_file_path, "wb") as f_out:
                compressor = zstd.ZstdCompressor(level=9)  
                f_out.write(compressor.compress(f_in.read()))

            compressed_files.append(compressed_file_path)

        # ✅ Send files to nodes in parallel
        futures = []
        for index, file_path in enumerate(compressed_files):
            if not file_path.exists():
                self.logger.warning(f"⚠️ Warning: {file_path} does not exist. Skipping.")
                continue

            hostname = self.node_hostnames[index % self.num_of_nodes]  
            worker = workers[hostname]  

            self.logger.info(f"📤 Sending {file_path.name} to worker on {hostname}...")

            with file_path.open("rb") as f:
                file_bytes = f.read()

            # ✅ Track file assignments for verification
            file_map[hostname] = file_path.name  

            # ✅ Send full compressed file in parallel
            futures.append(worker.process_file.remote(file_bytes, file_path.name, self.remote_node_directory))

        # ✅ Wait for all workers to finish and confirm receipt
        results = ray.get(futures)

        # ✅ Log completion
        success_count = sum(1 for res in results if "✅" in res)
        if success_count != len(results):
            self.logger.error(f"❌ Some workers failed. Success: {success_count}/{len(results)}")
        else:
            self.logger.info(f"✅ All {len(results)} files successfully distributed.")

        # ✅ Proceed to node-level splitting if all files were sent
        self.logger.info("🚀 Proceeding to node-level splitting...")

        # ✅ Release all worker actors
        for worker in workers.values():
            ray.kill(worker)
        self.logger.info("🧹 Released all file distribution worker actors.")

        self._split_data_at_node_level()

    def _split_data_at_node_level(self):
        """Splits distributed files at the node level by assigning workers to specific nodes."""

        if not ray.is_initialized():
            ray.init(ignore_reinit_error=True)

        if self.num_of_nodes == 0:
            self.logger.error("❌ No available nodes found. Aborting node-level splitting.")
            return

        self.logger.info(f"🚀 Spawning {self.num_of_nodes} JSONLSplitterWorker instances on separate nodes.")

        # ✅ Create one worker per node
        workers = {
            hostname: JSONLSplitterWorker.options(resources={self.node_stats[hostname]["resource_key"]: 1}).remote(self.remote_node_directory)
            for hostname in self.node_hostnames
        }

        # ✅ Dispatch split tasks to workers
        futures = []
        for hostname, worker in workers.items():
            self.logger.info(f"📂 Assigning JSONL splitting task to worker on {hostname}...")
            future = worker.split.remote()
            futures.append(future)

        # ✅ Wait for all workers to finish processing
        results = ray.get(futures)

        self.logger.info(f"✅ Finished splitting data on {len(results)} nodes.")

        # ✅ Release all worker actors
        for worker in workers.values():
            ray.kill(worker)
        self.logger.info("🧹 Released all file distribution worker actors.")