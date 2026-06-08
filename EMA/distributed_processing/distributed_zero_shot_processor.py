import sys
import time
import ray
import json
import yaml
import threading
from pathlib import Path

ray.init(address="auto", ignore_reinit_error=True)

@ray.remote
class DistributedZeroShotProcessor:
    def __init__(self, dataset_dir: str, output_path_dir: str):
        from utilities.logger import get_logger
        from utilities.system_stats import SystemStats
        from utilities.path_manager import PathManager

        self.path_manager = PathManager()
        self.logger = get_logger("DistributedZeroShotProcessor")

        self.dataset_index = 0
        self.model_index = 0
        self.filter_engine = {}  

        self._load_config()
        
        self.system_stats = SystemStats(gpu_refresh_interval=0.5)

        tmp_dir = self.path_manager.get_path(dataset_dir)
        tmp_dir2 = self.path_manager.get_path(output_path_dir) 
        
        self.dataset_dir = tmp_dir + self.config["distributed"]["tmp_distro_dir"]
        self.output_dir = tmp_dir2 + self.config["distributed"]["filter_distro_dir"]
        self.logger.info(f"📂 Dataset directory: {self.dataset_dir} & Cleaned dataset directory {self.output_dir }")
        self._get_dataset_files()
        self._check_clean_dataset_dir()
        
    def _load_config(self):
        """Load Ray cluster configurations from YAML file."""
        config_path = self.path_manager.get_path("DISTRIBUTED_DATA")

        try:
            with open(config_path, "r") as file:
                self.config = yaml.safe_load(file)
        except Exception as e:
            self.logger.error(f"⚠️ Failed to load Ray configuration: {e}")
            sys.exit(1)
    
    def _get_dataset_files(self):
        """Get all split dataset files."""
        self.dataset_files = list(Path(self.dataset_dir).glob("*.jsonl"))

    def _check_clean_dataset_dir(self):
        """Ensure the output directory exists."""
        save_dir = Path(self.output_dir)
        save_dir.mkdir(parents=True, exist_ok=True)  

    def process_dataset_single_gpu(self):
        """Processes datasets using multiple Zero-Shot models per node."""

        def schedule_next():
            """Schedules the next model dynamically with a timer."""
            if self.dataset_index < len(self.dataset_files):
                self.timer = threading.Timer(60.0, schedule_next)
                self.timer.start()

                if self.system_stats.is_below_thresholds():
                   self._next_dataset_and_model()
                         
            else:
                if hasattr(self, "timer") and self.timer:
                    self.timer.cancel()  # ✅ Safe cancellation
                    self.logger.info("✅ All datasets processed. Timer stopped.")

        schedule_next()
    #TODO only here for saving
    def process_dataset(self):
        """Processes datasets using multiple Zero-Shot models per node."""

        def schedule_next():
            """Schedules the next model dynamically with a timer."""
            if self.dataset_index < len(self.dataset_files):
                self.timer = threading.Timer(60.0, schedule_next)
                self.timer.start()

                if self.system_stats.is_below_thresholds():
                    if self.system_stats.has_multiple_gpus():
                        self._next_dataset_and_model(self.system_stats.get_least_utilized_gpu())
                    else:
                        self._next_dataset_and_model() 
            else:
                if hasattr(self, "timer") and self.timer:
                    self.timer.cancel()  # ✅ Safe cancellation
                    self.logger.info("✅ All datasets processed. Timer stopped.")

        schedule_next()

    def _next_dataset_and_model(self, deviceId: int = None):
        """Manages multiple Zero-Shot models per node dynamically."""
        from model_layer.zero_shot_filter_engine import ZeroShotFilterEngine

        dataset_path = self._get_a_dataset_path()
        if dataset_path:  
            self.logger.info(f"🚀 Processing {dataset_path} on {ray.get_runtime_context().get_node_id() }")

            if deviceId:
                model = ZeroShotFilterEngine(config=self.config["filtering"], deviceId=deviceId)

            else:
                model = ZeroShotFilterEngine(config=self.config["filtering"])

            model_key = self.model_index
            self.filter_engine[model_key] = model
            self.model_index +=1
            
            try:
                self._process_dataset(dataset_path, model_key)
            except Exception as e:
                self.logger.error(f"❌ Error processing {dataset_path}: {e}")
                self.dataset_index -= 1  # ✅ Rollback index on failure
                
    def _process_dataset(self, dataset_path: str, model_key: int):
        """Loads dataset, applies filtering, and saves the cleaned version."""
        self.logger.info(f"📂 Processing dataset: {dataset_path}")

        filtered_data = []
        with open(dataset_path, "r") as file:
            for line in file:
                qa_pair = json.loads(line.strip())
                decision, confidence, label = self.filter_engine[model_key].filter(qa_pair)
                
                if decision == "keep":
                    filtered_data.append(qa_pair)
                #else:
                    #self._log_rejection(qa_pair, confidence, decision, label)
        
        output_filename = Path(dataset_path).stem + "_filtered.jsonl"
        output_path = Path(self.output_dir) / output_filename

        self.logger.info(f"📂 Writing {len(filtered_data)} records to {output_path}")

        with open(output_path, "w") as file:
            for record in filtered_data:
                file.write(json.dumps(record) + "\n")  # ✅ Write each record as a separate JSON line

        self.logger.info(f"✅ Filtering complete. Saved to {output_path}")
        
        self.logger.info(f"✅ Removing model with key: {model_key}")
        self.filter_engine.pop(model_key)   # ✅ Remove when done
        
    def _get_a_dataset_path(self):
        """Retrieves the next dataset file for processing."""
        if self.dataset_index >= len(self.dataset_files):
            return None
        dataset_path = self.dataset_files[self.dataset_index]
        self.dataset_index += 1
        return dataset_path
    
    def _log_rejection(self, qa_pair, confidence, reason, label):
        """Logs rejected or borderline cases."""
        self.logger.info(f"❌ Rejected QA Pair - Confidence: {confidence:.2f}, Reason: {reason} Label{label} \n {qa_pair}")