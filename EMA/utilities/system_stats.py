import psutil
import platform
import torch
import yaml
import atexit
import threading
import time
import gc
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from pynvml import nvmlInit, nvmlDeviceGetHandleByIndex, nvmlDeviceGetMemoryInfo, nvmlDeviceGetCount, nvmlDeviceGetUtilizationRates, nvmlShutdown


class SystemStats:
    """A cross-platform system monitoring class for CPU, memory, and GPU statistics, with automatic cleanup."""

    def __init__(self, gpu_refresh_interval=0.5, memory_cleanup_interval=10):
        """Initialize system stats monitoring and start background cleanup tasks."""
        self.logger = get_logger("SystemStats")
        self.path_manager = PathManager()

        config_path = self.path_manager.get_path("SYS_THRESHOLDS")
        with open(config_path, "r") as file:
            self.config = yaml.safe_load(file)

        self.device_type = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

        # GPU Monitoring Variables
        self.gpu_memory = None
        self.gpu_utilization = None
        self.gpu_refresh_interval = gpu_refresh_interval  # GPU update frequency

        # Memory Cleanup
        self.memory_cleanup_interval = memory_cleanup_interval  # Frequency of memory cleanup (in seconds)

        if self.device_type == "cuda":
            self.initialize_nvml()
            self.start_gpu_monitoring()
            self.start_memory_cleanup()
        elif self.device_type == "mps":
            self.start_memory_cleanup()

    def initialize_nvml(self):
        """Initializes NVML only if CUDA is available."""
        try:
            nvmlInit()
            atexit.register(self.shutdown_nvml)  # Ensure NVML shuts down on exit
        except Exception as e:
            self.logger.error(f"NVML initialization failed: {e}")
            self.device_type = "cpu"  # Fallback to CPU stats only

    def shutdown_nvml(self):
        """Shutdown NVML if it was initialized."""
        if self.device_type == "cuda":
            nvmlShutdown()
            self.logger.info("NVML shutdown automatically on exit.")

    def gpu_monitor_callback(self):
        """Continuously updates GPU memory and utilization in a background thread."""
        while True:
            if self.device_type != "cuda":
                break  # Stop if CUDA is no longer available

            num_gpus = nvmlDeviceGetCount()
            gpu_memory = []
            gpu_utilization = []

            for i in range(num_gpus):
                handle = nvmlDeviceGetHandleByIndex(i)
                mem_info = nvmlDeviceGetMemoryInfo(handle)
                util_info = nvmlDeviceGetUtilizationRates(handle)

                gpu_memory.append({
                    "gpu_index": i,
                    "used_mb": mem_info.used // (1024 * 1024),
                    "total_mb": mem_info.total // (1024 * 1024),
                })
                
                gpu_utilization.append({
                    "gpu_index": i,
                    "utilization": util_info.gpu  # GPU utilization percentage
                })

            self.gpu_memory = gpu_memory  # Update class variable
            self.gpu_utilization = gpu_utilization  # Update class variable

            time.sleep(self.gpu_refresh_interval)  # Avoid excessive NVML calls

    def start_gpu_monitoring(self):
        """Starts a background thread to stream GPU memory and utilization."""
        thread = threading.Thread(target=self.gpu_monitor_callback, daemon=True)
        thread.start()

    def start_memory_cleanup(self):
        """Starts a background thread to clean CPU, CUDA, or MPS memory."""
        thread = threading.Thread(target=self.memory_cleanup_callback, daemon=True)
        thread.start()

    def memory_cleanup_callback(self):
        """Periodically cleans unused memory (CPU, CUDA, or MPS) in a separate thread."""
        while True:
            self.clean_memory()
            time.sleep(self.memory_cleanup_interval)  # Wait before next cleanup

    def clean_memory(self):
        """Cleans unused memory based on the available device type."""
        gc.collect()  # Standard Python garbage collection

        if self.device_type == "mps":
            torch.mps.empty_cache()
        elif self.device_type == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()  # Collect unused IPC memory
        else:
            self.logger.info("🧹 CPU garbage collection completed.")

    def get_cpu_usage(self):
        """Returns CPU usage percentage."""
        return psutil.cpu_percent(interval=0)  # Instantaneous check

    def get_memory_usage(self):
        """Returns memory usage in MB and total system memory in MB."""
        mem = psutil.virtual_memory()
        return {"used_mb": mem.used // (1024 * 1024), "total_mb": mem.total // (1024 * 1024)}

    def get_mps_memory_usage(self):
        """Returns MPS GPU memory usage (macOS)."""
        if self.device_type == "mps":
            return {
                "allocated_memory_mb": torch.mps.current_allocated_memory() // (1024 * 1024),
                "driver_memory_mb": torch.mps.driver_allocated_memory() // (1024 * 1024)
            }
        return "MPS not available"

    def get_gpu_stats(self):
        """Returns latest GPU stats from the background thread."""
        if self.device_type == "cuda" and self.gpu_memory is not None:
            return {
                "memory": self.gpu_memory,
                "utilization": self.gpu_utilization
            }
        elif self.device_type == "mps":
            return self.get_mps_memory_usage()
        return "No GPU detected"

    def get_platform_info(self):
        """Returns the OS name and version."""
        return {
            "system": platform.system(),
            "version": platform.version(),
            "release": platform.release()
        }

    def get_all_stats(self):
        """Aggregates all system stats into a single dictionary."""
        return {
            "cpu_usage": self.get_cpu_usage(),
            "memory": self.get_memory_usage(),
            "gpu": self.get_gpu_stats(),
            "platform": self.get_platform_info(),
        }
    
    def has_multiple_gpus(self) -> bool:
        """Returns True if more than one GPU is available."""
        if self.device_type != "cuda":
            return False  # ✅ Only CUDA supports multiple GPUs
        try:
            return nvmlDeviceGetCount() > 1
        except:
            return False

    def get_least_utilized_gpu(self) -> int:
        """Returns the least utilized GPU based on real-time stats, or 'cpu' if no GPU is available."""
        if self.device_type != "cuda":
            return "cpu"  # ✅ Default to CPU if no CUDA GPUs are available

        try:
            num_gpus = nvmlDeviceGetCount()
            gpu_memory = []
            gpu_utilization = []

            for i in range(num_gpus):
                handle = nvmlDeviceGetHandleByIndex(i)
                mem_info = nvmlDeviceGetMemoryInfo(handle)
                util_info = nvmlDeviceGetUtilizationRates(handle)

                gpu_memory.append({"gpu_index": i, "used_mb": mem_info.used, "total_mb": mem_info.total})
                gpu_utilization.append({"gpu_index": i, "utilization": util_info.gpu})

            # ✅ Combine memory & utilization data
            gpu_info = [
                (gpu["gpu_index"], gpu["used_mb"] / gpu["total_mb"], util["utilization"])
                for gpu, util in zip(gpu_memory, gpu_utilization)
            ]

            # ✅ Select GPU with lowest memory usage and utilization
            optimal_gpu = min(gpu_info, key=lambda x: (x[1], x[2]))[0]
            return optimal_gpu

        except Exception as e:
            self.logger.error(f"Error selecting least utilized GPU: {e}")
    
    def is_below_thresholds(self) -> bool:
        """
        Checks if system resource usage is below the configured thresholds.
        Returns True if at least one GPU is below the threshold, False otherwise.
        """
        thresholds = self.config["system"]

        # ✅ Get current system usage
        cpu_usage = self.get_cpu_usage() / 100  # Convert to decimal
        memory_usage = self.get_memory_usage()["used_mb"] / self.get_memory_usage()["total_mb"]  # Convert to decimal

        # ✅ Handle Multiple GPUs
        if self.device_type == "cuda" and self.gpu_memory:
            below_threshold_gpus = [
                gpu for gpu in self.gpu_memory
                if (gpu["used_mb"] / gpu["total_mb"]) < thresholds["gpu"]
            ]
            gpu_usage_below = len(below_threshold_gpus) > 0  # ✅ At least one GPU must be below threshold
        elif self.device_type == "mps":
            gpu_usage_below = memory_usage < thresholds["memory"]  # ✅ MPS shares system memory
        else:
            gpu_usage_below = True  # ✅ No GPU means we ignore this check

        # ✅ Return True only if ALL resources are within limits
        return cpu_usage < thresholds["cpu"] and memory_usage < thresholds["memory"] and gpu_usage_below