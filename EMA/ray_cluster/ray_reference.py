#!/usr/bin/env python3
"""
Ray Reference Script for noblesite Cluster

This script demonstrates all Ray decorators, including:
- Task parallelism (`@ray.remote`)
- Actor management (`@ray.remote` on classes)
- Custom resource constraints (`@ray.remote(resources={})`)
- Scheduling strategies (`@ray.remote(scheduling_strategy=...)`)
- Dynamic scaling (`@ray.remote(num_cpus=X, num_gpus=Y)`)
- Environment isolation (`@ray.remote(runtime_env={})`)
"""

import ray
import time
import os
import socket

# 🚀 Connect to the Ray Cluster
ray.init(address="auto")

# 🟢 List Available Nodes
def list_nodes():
    print("\n🔹 **Available Nodes in Cluster:**")
    for node in ray.nodes():
        print(f"Node: {node['NodeManagerAddress']}, Resources: {node['Resources']}")


# ✅ 1. Basic Task Execution (`@ray.remote`)
@ray.remote
def basic_task():
    """Simple task that returns the hostname."""
    return f"Task executed on: {socket.gethostname()}"

# ✅ 2. Task with Arguments (`@ray.remote`)
@ray.remote
def add_numbers(a: int, b: int):
    """Adds two numbers."""
    return f"{a} + {b} = {a + b}"

# ✅ 3. Assigning Tasks to Specific Workers (`@ray.remote(resources={})`)
@ray.remote(resources={"worker-1": 1})
def run_on_worker_one():
    """This task will only execute on 'noblesite-node-one.local'."""
    return f"Running on: {socket.gethostname()}"

# ✅ 4. Running a Task on the Head Node (`@ray.remote(resources={})`)
@ray.remote(resources={"head-node": 1})
def run_on_head():
    """Forces execution on the head node."""
    return f"Running on: {socket.gethostname()}"

# ✅ 5. Running a Function with Multiple Outputs (`@ray.remote(num_returns=N)`)
@ray.remote(num_returns=2)
def split_result():
    """Returns two separate values."""
    return "First Output", "Second Output"

# ✅ 6. Running a Task with CPU & GPU Constraints (`@ray.remote(num_cpus=X, num_gpus=Y)`)
@ray.remote(num_cpus=2, num_gpus=1)
def heavy_computation():
    """Simulates a GPU-accelerated task."""
    return f"Executed on: {socket.gethostname()} using 2 CPUs & 1 GPU"

# ✅ 7. Creating an Actor (`@ray.remote` on a Class)
@ray.remote
class Counter:
    """A persistent actor that maintains state across calls."""
    def __init__(self):
        self.count = 0

    def increment(self):
        """Increments the counter."""
        self.count += 1
        return self.count

# ✅ 8. Running an Actor with Concurrency (`@ray.remote(max_concurrency=N)`)
@ray.remote(max_concurrency=5)
class ConcurrentActor:
    """An actor that can handle multiple requests in parallel."""
    def process(self, value):
        time.sleep(2)
        return f"Processed {value} on {socket.gethostname()}"

# ✅ 9. Running an Actor on a Specific Node (`@ray.remote(resources={})`)
@ray.remote(resources={"worker-2": 1})
class WorkerTwoActor:
    """Actor that only runs on 'noblesite-node-two.local'."""
    def get_info(self):
        return f"Actor running on: {socket.gethostname()}"

# ✅ 10. Using a Specific Scheduling Strategy (`scheduling_strategy="NODE_AFFINITY"`)
@ray.remote(scheduling_strategy="NODE_AFFINITY", node_id="noblesite-node-three.local")
def run_on_node_three():
    """This task is pinned to run only on 'noblesite-node-three.local'."""
    return f"Running on: {socket.gethostname()}"

# ✅ 11. Running Tasks in a Custom Virtual Environment (`runtime_env={}`)
@ray.remote(runtime_env={"pip": ["numpy", "pandas"]})
def isolated_task():
    """Runs inside an isolated virtual environment with numpy & pandas installed."""
    import numpy as np
    return np.zeros(5)

# ✅ 12. Running a Task That Requires Multiple Calls Before Restarting (`max_calls=N`)
@ray.remote(max_calls=10)
def limited_lifetime_task():
    """Runs only 10 times before a fresh worker is used."""
    return f"Executed on: {socket.gethostname()}"

# ✅ 13. Running a Background Process (`@ray.remote(runtime_env={"working_dir": "path/"})`)
@ray.remote(runtime_env={"working_dir": "/tmp/"})
def background_task():
    """Executes inside a temporary working directory."""
    os.system("touch /tmp/testfile")
    return "Created /tmp/testfile"

# ✅ 14. Running Tasks in Parallel (`ray.get()` with List Comprehension)
def run_parallel_tasks():
    """Executes multiple tasks in parallel and retrieves results."""
    results = ray.get([basic_task.remote() for _ in range(5)])
    for res in results:
        print(res)


# 🟢 Main Execution Block
if __name__ == "__main__":
    list_nodes()

    print("\n🔹 Running Basic Task...")
    print(ray.get(basic_task.remote()))

    print("\n🔹 Running Task with Arguments...")
    print(ray.get(add_numbers.remote(5, 10)))

    print("\n🔹 Running a Task on 'noblesite-node-one.local'...")
    print(ray.get(run_on_worker_one.remote()))

    print("\n🔹 Running a Task on the Head Node...")
    print(ray.get(run_on_head.remote()))

    print("\n🔹 Running a Function with Multiple Outputs...")
    output1, output2 = ray.get(split_result.remote())
    print(f"Output 1: {output1}, Output 2: {output2}")

    print("\n🔹 Running a Task with CPU & GPU Constraints...")
    print(ray.get(heavy_computation.remote()))

    print("\n🔹 Running a Parallel Task...")
    run_parallel_tasks()

    print("\n🔹 Using an Actor...")
    counter = Counter.remote()
    print(ray.get(counter.increment.remote()))
    print(ray.get(counter.increment.remote()))

    print("\n🔹 Running an Actor on 'noblesite-node-two.local'...")
    worker_actor = WorkerTwoActor.remote()
    print(ray.get(worker_actor.get_info.remote()))

    print("\n🔹 Running a Task on 'noblesite-node-three.local'...")
    print(ray.get(run_on_node_three.remote()))

    print("\n🔹 Running a Task in an Isolated Environment...")
    print(ray.get(isolated_task.remote()))

    print("\n🔹 Running a Background Task...")
    print(ray.get(background_task.remote()))

    print("\n✅ Done! All tasks executed successfully.")