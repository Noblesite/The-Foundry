from distributed_processing.distribute_file_Engine import DistributeFileEngine
from distributed_processing.distributed_zero_shot_processor import DistributedZeroShotProcessor
from distributed_processing.dataset_cleanup_actor import DatasetCleanupActor
from distributed_processing.distributed_actor_engine import DistributedActorEngine
from distributed_processing.cluster_resources_worker import ClusterResource
import ray

from utilities.path_manager import PathManager
from utilities.logger import get_logger


path_manager = PathManager()
logger = get_logger("distributed_cleaning_pipeline")


def wso_distribute_dataset():
    dirty_wso_dataset_file = path_manager.get_path("WSO_DISTRIBUTED_DIRTY_DATA_SET")
    wso_dataset_dir = path_manager.get_path("WSO_DISTRIBUTED_DATA_SET_DIR")
    wso_worker_dataset_dir = "WSO_DISTRIBUTED_NODE_DATA"
    distro_file_engine = DistributeFileEngine(input_file=dirty_wso_dataset_file, output_dir=wso_dataset_dir, path_manager_path=wso_worker_dataset_dir)
    distro_file_engine.distribute_and_split()

def wso_zero_shot_filter():
    wso_worker_dataset_dir = "WSO_DISTRIBUTED_NODE_DATA" 
    # Create the engine
    actor_engine = DistributedActorEngine(DistributedZeroShotProcessor, num_actors=5)
    # Deploy the actors
    actor_engine.deploy_actors(dataset_dir=wso_worker_dataset_dir, output_path_dir=wso_worker_dataset_dir)
    # Run dataset processing across all actors
    actor_engine.execute("process_dataset")
    # Wait for all tasks to complete
    results = actor_engine.wait_for_completion()
    # Cleanup all actors
    actor_engine.cleanup()

def get_cluster_resources():
    cluster_resource = ClusterResource()
    resources = cluster_resource.collect_node_stats()
    logger.info(f"Cluster resources: {resources}")

    for i, (node_name, node_info) in enumerate(resources.items()):
        num_cpus = max(1, node_info["cpu_count"] // 2)  # ✅ Assign based on available CPUs
        num_gpus = max(0, node_info["gpu_count"])  # ✅ Use GPU if available

        logger.info(f"🚀 Deploying Actor {i+1}/{len(resources)} on Node {node_name} with {num_cpus} CPUs and {num_gpus} GPUs")

#TODO - Walk through the code & debug
def clean_and_agrogate_dataset():

        # Initialize Ray cluster
    ray.init(address="auto", ignore_reinit_error=True)

    # Define expected dataset parts (modify based on actual dataset configuration)
    expected_parts = [f"filtered_part{i}.jsonl" for i in range(1, 6)]  # Example for 5 parts

    # Initialize and deploy the Cleanup Actors using DistributedActorEngine
    cleanup_engine = DistributedActorEngine(DatasetCleanupActor, num_actors=len(expected_parts))
    cleanup_engine.deploy_actors("DISTRIBUTED_TEMP_DIR", "FINAL_DATASET_DIR")

    # Step 1: Check for missing dataset parts
    cleanup_engine.execute("check_missing_parts", expected_parts)
    missing_parts_per_actor = cleanup_engine.wait_for_completion()

    # Step 2: Request missing parts from peers
    cleanup_engine.execute("request_missing_parts", missing_parts_per_actor, cleanup_engine.actors)
    cleanup_engine.wait_for_completion()

    # Step 3: Consolidate the dataset on each node
    cleanup_engine.execute("consolidate_dataset", expected_parts)
    cleanup_engine.wait_for_completion()

    # Cleanup actors after execution
    cleanup_engine.cleanup()

    print("✅ Dataset aggregation and cleanup completed successfully!")

#get_cluster_resources()

#wso_distribute_dataset()

wso_zero_shot_filter()

