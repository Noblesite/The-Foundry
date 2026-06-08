import os
import psutil
from multiprocessing import cpu_count

def get_dynamic_settings(default_batch_size=100, default_workers=4):
    """
    Dynamically calculate batch size and workers based on available system resources.
    """
    # Get total and available memory
    mem_info = psutil.virtual_memory()
    total_memory = mem_info.total / (1024 ** 3)  # Convert to GB
    available_memory = mem_info.available / (1024 ** 3)  # Convert to GB

    # Get available CPU cores
    cpu_cores = cpu_count()

    # Set batch size (adjust based on available memory)
    if available_memory < 4:  # Low memory system
        batch_size = min(50, default_batch_size)
    elif available_memory < 8:  # Moderate memory system
        batch_size = min(100, default_batch_size)
    else:  # High memory system
        batch_size = default_batch_size

    # Set worker count (adjust based on CPU cores)
    if cpu_cores <= 2:  # Low CPU system
        workers = min(2, default_workers)
    elif cpu_cores <= 4:  # Moderate CPU system
        workers = min(4, default_workers)
    else:  # High CPU system
        workers = default_workers

    return batch_size, workers