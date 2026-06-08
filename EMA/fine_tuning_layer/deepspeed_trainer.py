from transformers import AutoModelForCausalLM, AutoTokenizer
from deepspeed.ops.adam import DeepSpeedCPUAdam
import yaml
import torch
from peft import LoraConfig, get_peft_model
from datetime import datetime
from tqdm import tqdm
import torch.distributed as dist
import torch.nn.parallel
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from utilities.system_stats import SystemStats
from fine_tuning_layer.dataset_processor import DatasetProcessor
import deepspeed
import os

#deepspeed --num_gpus=2 deepspeed_trainer.py

class DeepSpeedTrainer:
    """
    Custom Trainer class to fine-tune a language model using a streaming dataset,
    integrated with DeepSpeed for improved memory efficiency and distributed training.
    Supports mixed precision, WandB logging, and validation after each epoch.
    """

    def __init__(self, train_dataset_path: str, val_dataset_path: str):
        """
        Initializes the trainer with the model, tokenizer, datasets, and training parameters.
        """
        self.logger = get_logger("DeepSpeedTrainer")
        self.path_manager = PathManager()

        config_path = self.path_manager.get_path("FINE_TUNING")
        with open(config_path, "r") as file:
            self.configs = yaml.safe_load(file)

        # Initialize tokenizer once
        self.tokenizer = AutoTokenizer.from_pretrained(self.configs["model_name"])
        self.tokenizer.pad_token = self.tokenizer.eos_token  # Ensure proper padding

        # Initialize LoRA Config
        lora_config = LoraConfig(
            r=self.configs["lora"]["r"],
            lora_alpha=self.configs["lora"]["alpha"],
            lora_dropout=self.configs["lora"]["dropout"],
            bias=self.configs["lora"]["bias"],
            target_modules=self.configs["lora"]["target_modules"]  # Dynamically set from YAML
        )

        # Restore Quantization Logic
        quantization_enabled = self.configs.get("quantization", {}).get("enable", False)
        quant_bits = self.configs.get("quantization", {}).get("bits", 16)
        compute_dtype = torch.float16 if self.configs.get("quantization", {}).get("compute_dtype", "float16") == "float16" else torch.bfloat16
        device_map = self.configs.get("quantization", {}).get("device_map", "auto")

        self.logger.info(f"Quantization Enabled: {quantization_enabled}")
        self.logger.info(f"Bits: {quant_bits}")
        self.logger.info(f"Compute dtype: {compute_dtype}")
        self.logger.info(f"Device map: {device_map}")

        # Configure quantization settings
        quantization_kwargs = {"torch_dtype": compute_dtype, "device_map": device_map}

        if quantization_enabled:
            if quant_bits == 4:
                quantization_kwargs["load_in_4bit"] = True
                self.logger.info("Using 4-bit quantization.")
            elif quant_bits == 8:
                quantization_kwargs["load_in_8bit"] = True
                self.logger.info("Using 8-bit quantization.")
            elif quant_bits == 16:
                self.logger.info("Using full precision (16-bit).")
            else:
                raise ValueError(f"Unsupported quantization bit size: {quant_bits}")
            model = AutoModelForCausalLM.from_pretrained(self.configs["model_name"], **quantization_kwargs)
        else:
            model = AutoModelForCausalLM.from_pretrained(self.configs["model_name"])

        # Apply LoRA after quantization
        self.model = get_peft_model(model, lora_config)
        model.config.use_cache = False  # Disable cache for gradient checkpointing

        VAL_TUNE_CHECKPOINTS = self.path_manager.get_path("FINE_TUNE_CHECKPOINTS") + "/val_checkpoint.txt"
        TRAIN_CHECKPOINTS = self.path_manager.get_path("FINE_TUNE_CHECKPOINTS") + "/train_checkpoint.txt"

        # Initialize dataset processors
        self.training_processor = DatasetProcessor(
            dataset_path=train_dataset_path,
            check_point=TRAIN_CHECKPOINTS,
            context_window_size=self.configs["context_window"],
            batch_size=self.configs["batch_size"]
        )
        self.validation_processor  = DatasetProcessor(
            dataset_path=val_dataset_path,
            check_point=VAL_TUNE_CHECKPOINTS,
            context_window_size=self.configs["context_window"],
            batch_size=self.configs["batch_size"]
        )
       
        # Cuda & MPS memory clean up
        self.system_stats = SystemStats(gpu_refresh_interval=1.0, memory_cleanup_interval=0.01)

        # Setup Training Arguments
        self.context_window_size = self.configs["context_window"]
        self.epochs = self.configs["epochs"]
        self.learning_rate = self.configs["learning_rate"]
        self.lr_scheduler_type = "cosine"  # TODO: Abstract to configs
        self.batch_size = self.configs["batch_size"]
        self.eval_strategy = "epoch"  # TODO: Abstract to configs
        self.save_strategy = "epoch"  # TODO: Abstract to configs
        self.save_strategy_steps = "steps"  # TODO: Abstract to configs
        self.global_step = 0 
        self.step = 0
        self.save_steps = 1000  # TODO: Abstract to configs
        self.save_total_limit = 2  # TODO: Abstract to configs
        self.gradient_accumulation_steps = 4  # TODO: Abstract to configs
        self.logging_steps = 10  # TODO: Abstract to configs
        self.epoch_counter = 0  # TODO: Abstract to configs
        self.fp16 = False  # TODO: Abstract to configs
        self.bf16 = True  # TODO: Abstract to configs
        self.max_grad_norm = 1.0
        self.gradient_checkpointing = True

        # Enable gradient checkpointing if supported by the model
        if self.gradient_checkpointing and hasattr(self.model, "gradient_checkpointing_enable"):
            self.model.gradient_checkpointing_enable()
            self.logger.info("✅ Gradient checkpointing enabled.")

        # Paths for Saving Model and Logs
        self.model_save_base_dir = os.path.join(self.path_manager.get_path("SAVED_MODELS_PATH"), "fine_tuned_models")
        
        # DeepSpeed will wrap the model and optimizer in _prep_for_training()
        self._prep_for_training()
    

    def _prep_for_training(self):
        """
        Prepares training by setting up the device, optimizer, and initializing DeepSpeed.
        """
        # Setup device using local rank for distributed training.
        local_rank = int(os.environ.get("LOCAL_RANK", 0))
        self.device = torch.device("cuda", local_rank)
        self.logger.info(f" Model moved to {self.device}")
        self.model.to(self.device)

        # Re-enable gradient checkpointing (if needed)
        if self.gradient_checkpointing and hasattr(self.model, "gradient_checkpointing_enable"):
            self.model.gradient_checkpointing_enable()
            self.logger.info("✅ Gradient checkpointing enabled.")

        # Verify training_processor.total_records exists and is valid
        if not hasattr(self.training_processor, "total_records") or not self.training_processor.total_records:
            error_msg = "training_processor.total_records is not available or invalid. Please check dataset configuration."
            self.logger.error(error_msg)
            raise ValueError(error_msg)

        # Compute training steps and warmup steps BEFORE building ds_config.
        self.num_training_steps = (self.epochs * self.training_processor.total_records) // (self.gradient_accumulation_steps * self.batch_size)
        self.warmup_steps = int(self.configs["warm_up"] * self.num_training_steps)

        # Create optimizer using DeepSpeed's CPU optimizer
        self.optimizer = DeepSpeedCPUAdam(self.model.parameters(), lr=float(self.learning_rate))

        # Build DeepSpeed configuration
        ds_config = {
            "train_batch_size": self.batch_size * self.gradient_accumulation_steps,
            "gradient_accumulation_steps": self.gradient_accumulation_steps,
            "gradient_clipping": self.max_grad_norm,
            "zero_verbose": 3,  # Enables detailed logging for ZeRO operations
            "steps_per_print": self.logging_steps,
            # Autotuning configuration
            "autotuning": {
                "enabled": False,
                "trials": 5,
                "batch_size": self.batch_size,
                "steps": 100
            },
            
            # Optimizer configuration using DeepSpeed CPU Adam
            "optimizer": {
                "type": "DeepSpeedCPUAdam",
                "params": {
                    "lr": self.learning_rate,
                    "betas": [0.9, 0.999],
                    "eps": 1e-8,
                    "weight_decay": 0.1
                }
            },
            
            # Scheduler configuration (DeepSpeed scheduler)
            "scheduler": {
                "type": "WarmupLR",
                "params": {
                    "warmup_min_lr": 0,
                    "warmup_max_lr": float(self.learning_rate),
                    "warmup_num_steps": self.warmup_steps
                }
            },
            
            # FP16 training and Automatic Mixed Precision (AMP)
            "fp16": {
                "enabled": self.fp16,
                "loss_scale": 0,
                "loss_scale_window": 1000,
                "hysteresis": 1,
                "min_loss_scale": 1
            },
            "bf16": {
                "enabled": self.bf16,
                "loss_scale": 0,
                "loss_scale_window": 1000,
                "hysteresis": 1,
                "min_loss_scale": 1
            },
            
            # ZeRO Optimizations for FP16 Training with offloading
            "zero_optimization": {
                "stage": 3,
                #"offload_param": {
                #    "device": "cpu",
                #    "pin_memory": True,
                #    "buffer_count": 4,         # Updated from 5 to 2
                #    "buffer_size": 50000000,     # Updated from 100000000 to 50000000
                #    "max_in_cpu": 20000000000      # Updated from 1000000000 to 500000000
                #},
                "offload_optimizer": {
                    "device": "cpu",
                    "pin_memory": True,
                    "buffer_count": 4,         # Updated from 4 to 2
                    "pipeline_read": True,
                    "pipeline_write": True,
                    "fast_init": False,
                    "ratio": 1.0
                },
                "overlap_comm": True,
                "contiguous_gradients": True
                # "zero_allow_untested_optimizer": False  (commented out)
            },
            
            # Activation Checkpointing
            "activation_checkpointing": {
                "partition_activations": True,
                "cpu_checkpointing": True,    # Updated from False to True
                "contiguous_memory_optimization": True,
                "synchronize_checkpoint_boundary": True,
                "profile": False
            },
            
            # Sparse attention configuration
            "sparse_attention": {
                "enabled": True,
                "block": 16
            },
            
            # Data Efficiency options
            "data_efficiency": {
                "enabled": True
            },
            
            # Layer Reduction options
            #"layer_reduction": {
            #    "enabled": True,
            #    "reduction_factor": 0.5
            #},
            
            # Pruning options
            #"sparse_pruning": {
            #    "enabled": True,
            #    "pruning_type": "magnitude",
            #    "prune_ratio": 0.25
            #},
            #"row_pruning": {
            #    "enabled": True,
            #    "prune_ratio": 0.3
            #},
            #"channel_pruning": {
            #    "enabled": True,
            #    "prune_ratio": 0.3
            #},
            #"head_pruning": {
            #    "enabled": True,
            #    "prune_ratio": 0.2
            #},
            
            # Checkpoint options
            "checkpoint": {
                "save_optimizer_states": True,
                "save_zero_checkpoint": True,
                "save_interval": 1000
            },
            
            # Data Type option
            "data_type": "fp16" if self.fp16 else ("bf16" if self.bf16 else "fp32"),
            
            # Additional DeepSpeed configurations
            "load_from_fp32_weights": True,
            "ignore_unused_parameters": True,
            "memory_efficient_linear": True

              # Weight and Activation Quantization
            #"weight_quantization": {
            #    "enabled": False,
            #    "bits": 8
            #},
            #"activation_quantization": {
            #    "enabled": False,
            #    "bits": 8
            #},
        }

        # Initialize DeepSpeed; this wraps the model and optimizer.
        try:
            self.model_engine, self.optimizer, _, _ = deepspeed.initialize(
                model=self.model,
                optimizer=self.optimizer,
                config=ds_config
            )
        except Exception as e:
            self.logger.error("DeepSpeed initialization failed.", exc_info=True)
            raise e

        # Mixed Precision Setup: DeepSpeed will handle AMP if fp16 is enabled.
        self.use_amp = self.fp16 or self.bf16
        self.dtype = torch.float16 if self.fp16 else (torch.bfloat16 if self.bf16 else torch.float32)
        
        if self.device.type == "cuda":
            torch.cuda.empty_cache()

        self.logger.info(f"Prep for training complete:"
                         f"\n Device: {self.device}"
                         f"\n Training Steps: {self.num_training_steps}"
                         f"\n Warmup steps: {self.warmup_steps}"
                         f"\n Epochs: {self.epochs}"
                         f"\n Batch Size: {self.batch_size}")

    def train(self):
        """
        Simplified training loop using DeepSpeed engine's built-in methods for forward, backward, and optimization.
        """
        self.logger.info("Starting training process with DeepSpeed engine...")
        self.logger.info(f"Model running on device: {self.device}")
        
        global_step = 0
        for epoch in range(self.epochs):
            self.logger.info(f"Epoch {epoch+1}/{self.epochs}")
            self.model_engine.train()
            progress_bar = tqdm(self.training_processor, desc=f"Epoch {epoch+1} Training", unit="batch")
            
            for batch in progress_bar:
                # Tokenize the filtered batch
                inputs = self.tokenizer(
                    batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True
                ).to(self.device)
                
                # Forward pass using DeepSpeed engine (handles AMP, gradient accumulation, etc.)
                outputs = self.model_engine(
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    labels=inputs["input_ids"]
                )
                loss = outputs.loss
                # Backward pass and weight update via DeepSpeed engine
                self.model_engine.backward(loss)
                self.model_engine.step()
                
                global_step += 1
                progress_bar.set_postfix(loss=loss.item())
                if global_step % self.logging_steps == 0:
                    self.logger.info(f"Step {global_step}: Loss = {loss.item():.4f}")
                
                if self.save_strategy_steps == "steps" and global_step % self.save_steps == 0:
                    self.save_model_with_timestamp()
                    self.logger.info(f"Checkpoint saved at step {global_step}")
                    
           
            if self.save_strategy == "epoch":
                self.save_model_with_timestamp()
                self.logger.info(f"Checkpoint saved at Epoch: {epoch+1}")
            #if self.eval_strategy == "epoch":
                #self.validate(epoch)
        
        self.logger.info("Saving final model...")
        self.save_model_with_timestamp()
        self.logger.info("Training completed.")

    def validate(self, epoch):
        """
        Runs validation after each epoch, computing loss on the validation dataset.
        """
        self.logger.info(f"Running validation for Epoch {epoch+1}...")
        self.model_engine.eval()
        total_val_loss = 0
        num_batches = 0
        progress_bar = tqdm(self.validation_processor, desc=f"Epoch {epoch+1} Validation", unit="batch")
        with torch.no_grad():
            for step, batch in enumerate(progress_bar):
                inputs = self.tokenizer(
                    batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True    
                ).to(self.device)
             
                outputs = self.model_engine(
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    labels=inputs["input_ids"]
                )
                loss = outputs.loss
                total_val_loss += loss.item()
                num_batches += 1
                progress_bar.set_postfix(loss=loss.item())
                self.logger.info(f"Validation Step {step+1}: Loss = {loss.item():.4f}")
        avg_val_loss = total_val_loss / num_batches if num_batches > 0 else float("inf")
        self.logger.info(f"Epoch {epoch+1} Validation Completed. Average Loss: {avg_val_loss:.4f}")
    
    def save_model_with_timestamp(self):
        """
        Saves the model and tokenizer with a timestamped name.
        DeepSpeed checkpointing is used to save the engine state.
        """
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            model_save_path = os.path.join(self.model_save_base_dir, f"{self.configs['save_name']}_{timestamp}")
            os.makedirs(model_save_path, exist_ok=True)
            # DeepSpeed saves a checkpoint (model engine state) and you may also save the tokenizer.
            self.model_engine.save_checkpoint(model_save_path)
            self.tokenizer.save_pretrained(model_save_path)
            self.logger.info(f"✅ Model saved at: {model_save_path}")
        except Exception as e:
            self.logger.error("Failed to save checkpoint.", exc_info=True)
            raise e

if __name__ == "__main__":
    path_manager = PathManager()

    train_dataset_path = path_manager.get_path("WSO_TRAIN_DS")
    val_dataset_path = path_manager.get_path("WSO_VAL_DS")
    trainer = DeepSpeedTrainer(train_dataset_path=train_dataset_path, val_dataset_path=val_dataset_path)
    trainer.train()