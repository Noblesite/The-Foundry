#distributed_fine_tuner.py
import os
import ray
import subprocess

ray.init(address="auto", ignore_reinit_error=True)

@ray.remote
class DistributedQLoRAFineTuner:
    def __init__(self, num_nodes:int, node_rank: int, node_gpus: int ):
        from utilities.path_manager import PathManager

        self.path_manager = PathManager()
        self.fine_tuning_dir = self.path_manager.get_path("FINE_TUNE_DIR")
        
        self.node_rank = node_rank
        self.node_gpus = node_gpus
        self.num_nodes =num_nodes


    def launch_training(self):
        command = [
            "deepspeed",
            f"--num_nodes={self.num_nodes}",
            f"--num_gpus={self.node_gpus}",
            f"--node_rank={self.node_rank}",
            f"{self.fine_tuning_dir}/deepspeed_pipeline_trainer.py"
        ]
        result = subprocess.run(command, capture_output=True, text=True)

        return result
       


       