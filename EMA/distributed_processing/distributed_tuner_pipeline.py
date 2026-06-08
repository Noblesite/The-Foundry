from distributed_processing.distributed_fine_tuner import DistributedQLoRAFineTuner
from distributed_processing.directed_node_actor_engine import DirectedNodeActorEngine
from utilities.path_manager import PathManager
from utilities.logger import get_logger

class DistributedTunerPipeline:
    def __init__(self):
        """
        Initializes the distributed tuner pipeline.
        """
        self.path_manager = PathManager()
        self.logger = get_logger("DistributedTunerPipeline")

    def parallel_node_training(self, node_name: str, num_nodes:int, node_rank: int, node_gpus: int ):
        """
        Trains a single node using the specified model.
        """
        # Map Node & Actor
        node_actor_map = {node_name: DistributedQLoRAFineTuner}
        # Create the engine
        actor_engine = DirectedNodeActorEngine(node_actor_map=node_actor_map)
        # Deploy the actors
        actor_engine.deploy_actors(num_nodes=num_nodes, node_rank=node_rank, node_gpus=node_gpus)
        # Run dataset processing across all actors
        actor_engine.execute("launch_training")
        # Wait for all tasks to complete
        results = actor_engine.wait_for_completion()

        if results.returncode != 0:
            print(f"Error: {results.stderr}")
        else:
            print(f"Success: {results.stdout}")
        
        actor_engine.cleanup()

        self.logger.info(f"{node_name} started training.") 

if __name__ == "__main__":
  

    distributed_tuner_pipeline = DistributedTunerPipeline()

    distributed_tuner_pipeline.parallel_node_training(node_name="noblesite-head-node", num_nodes=3, node_rank=0, node_gpus=2)
    distributed_tuner_pipeline.parallel_node_training(node_name="noblesite-node-one", num_nodes=3, node_rank=1, node_gpus=1)
    distributed_tuner_pipeline.parallel_node_training(node_name="noblesite-node-three", num_nodes=3, node_rank=2, node_gpus=1)

 