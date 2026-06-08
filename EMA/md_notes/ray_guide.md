# Setting Up a Ray Cluster for Distributed Processing

This guide provides step-by-step instructions to set up and manage a Ray cluster for distributed processing. Follow these steps to configure your head node, add worker nodes, and monitor the cluster.

---

## 1. Start the Head Node

The head node orchestrates the cluster and distributes work among the worker nodes.

### Command:
```bash
ray start --head --port=6379
```

### Notes:
- `--head`: Indicates this is the head node.
- `--port`: Specifies the port for the Ray cluster (default is `6379`).

### Verify:
```bash
ray status
```
- Confirms the head node is running and shows cluster details.

---

## 2. Find the Head Node Address

When the head node starts, Ray prints the address for workers to connect. It looks like this:

```
Ray cluster starting on node 192.168.1.100:6379
```

- Copy the address (`192.168.1.100:6379`) for use when adding workers.

---

## 3. Start Worker Nodes

On each additional machine, run the following command to add a worker to the cluster:

### Command:
```bash
ray start --address='192.168.1.100:6379'
```

### Notes:
- Replace `192.168.1.100:6379` with the actual address of the head node.
- This connects the worker node to the head node.

---

## 4. Verify the Cluster

After adding workers, check the cluster status from the head node:

### Command:
```bash
ray status
```

### Expected Output:
- Details about all nodes in the cluster, including their resource capacities (e.g., CPUs, GPUs).

---

## 5. Run Your Distributed Script

Now that the cluster is ready, you can run your distributed script. Ray will automatically distribute tasks across all available nodes.

### Example Command:
```bash
python distributed_processing.py
```

### Notes:
- Ensure the script uses Ray for distributed task management.

---

## 6. Stop the Cluster

### Stop a Worker Node:
Run this command on the worker machine:
```bash
ray stop
```

### Stop the Head Node:
Run this command on the head machine:
```bash
ray stop
```

### Notes:
- Stop the worker nodes before stopping the head node to avoid orphaned processes.

---

## Additional Tips

### 1. Firewalls:
Ensure that ports used by Ray (default: `6379`, `8265` for the dashboard) are open on all machines.

### 2. Environment Consistency:
- All nodes should have the same Python version and installed dependencies.
- Use tools like `conda`, `venv`, or Docker to maintain consistency.

### 3. Ray Dashboard:
- Open the dashboard on the head node at `http://<head-node-ip>:8265` to monitor the cluster.

---

You now have a fully operational Ray cluster! Use this guide as a quick reference for setup and management.