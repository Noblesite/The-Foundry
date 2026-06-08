from transformers import AutoModelForCausalLM, AutoTokenizer
import torch.distributed as dist
import deepspeed.comm as deepspeed_comm
from deepspeed.ops.adam import DeepSpeedCPUAdam
from deepspeed.pipe import PipelineModule, LayerSpec
import torch.nn as nn
import deepspeed
import torch
import torch.nn.functional as F
import yaml
import os
import difflib
import inspect
from datetime import datetime
from tqdm import tqdm
from dotenv import load_dotenv
from peft import LoraConfig, get_peft_model
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from utilities.system_stats import SystemStats
from fine_tuning_layer.dataset_processor import DatasetProcessor
from huggingface_hub import login

#deepspeed --num_nodes=2 --num_gpus=2 --node_rank=0 deepspeed_pipeline_trainer.py
#deepspeed --num_nodes=2 --num_gpus=2 --node_rank=0 deepspeed_pipeline_trainer.py
#deepspeed --num_gpus=2 deepspeed_pipeline_trainer.py

class DeepSpeedPipelineTrainer:
    """
    Trainer class for fine-tuning a language model using DeepSpeed pipeline parallelism.
    It wraps the model into a PipelineModule so that layers are partitioned across GPUs.
    """

    def __init__(self, train_dataset_path: str, val_dataset_path: str):
        self.logger = get_logger("DeepSpeedPipelineTrainer")
        self.path_manager = PathManager()

        # Load configuration from YAML file.
        config_path = self.path_manager.get_path("FINE_TUNING")
        with open(config_path, "r") as config_file:
            self.configs = yaml.safe_load(config_file)

        load_dotenv()

        HF_USERNAME = os.getenv("HF_USERNAME")
        HF_TOKEN = os.getenv("HF_TOKEN")
     
        # Ensure credentials are set
        if not HF_USERNAME or not HF_TOKEN:
            raise ValueError("Hugging Face username or token is missing. Please set HF_USERNAME and HF_TOKEN in .env file.")

        # Log into Hugging Face
        try:
            login(token=HF_TOKEN)
            print(f"✅ Successfully logged into Hugging Face as {HF_USERNAME}")
        except Exception as e:
            raise ValueError(f"❌ Failed to authenticate with Hugging Face: {e}")
        
        self.model_directory = os.path.join(
            self.path_manager.get_path("SAVED_MODELS_PATH"),
            self.configs["model_name"],
        )

        # Initialize tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_directory, local_files_only=True)
        self.tokenizer.pad_token = self.tokenizer.eos_token

        # Setup LoRA configuration
        self.lora_configuration = LoraConfig(
            r=self.configs["lora"]["r"],
            lora_alpha=self.configs["lora"]["alpha"],
            lora_dropout=self.configs["lora"]["dropout"],
            bias=self.configs["lora"]["bias"],
            target_modules=self.configs["lora"]["target_modules"]
        )

        # Quantization settings
        quantization_enabled = self.configs.get("quantization", {}).get("enable", False)
        quantization_bits = self.configs.get("quantization", {}).get("bits", 16)
        compute_dtype = torch.float16 if self.configs.get("quantization", {}).get("compute_dtype", "float16") == "float16" else torch.bfloat16
        device_map = self.configs.get("quantization", {}).get("device_map", "auto")

        self.logger.info(f"Quantization Enabled: {quantization_enabled}")
        self.logger.info(f"Quantization Bits: {quantization_bits}")
        self.logger.info(f"Compute dtype: {compute_dtype}")
        self.logger.info(f"Device map: {device_map}")

        quantization_kwargs = {"torch_dtype": compute_dtype, "device_map": device_map}

        # Load model with quantization options if enabled
        if quantization_enabled:
            if quantization_bits == 4:
                quantization_kwargs["load_in_4bit"] = True
                self.logger.info("Using 4-bit quantization.")
            elif quantization_bits == 8:
                quantization_kwargs["load_in_8bit"] = True
                self.logger.info("Using 8-bit quantization.")
            elif quantization_bits == 16:
                self.logger.info("Using full precision (16-bit).")
            else:
                raise ValueError(f"Unsupported quantization bit size: {quantization_bits}")
            base_model = AutoModelForCausalLM.from_pretrained(self.model_directory, local_files_only=True, **quantization_kwargs)
        else:
            base_model = AutoModelForCausalLM.from_pretrained(self.model_directory, local_files_only=True)

        self.base_model = base_model

        # Dataset processors for training and validation
        train_checkpoint_path = os.path.join(self.path_manager.get_path("FINE_TUNE_CHECKPOINTS"), "train_checkpoint.txt")
        val_checkpoint_path = os.path.join(self.path_manager.get_path("FINE_TUNE_CHECKPOINTS"), "val_checkpoint.txt")
        self.training_processor = DatasetProcessor(
            dataset_path=train_dataset_path,
            check_point=train_checkpoint_path,
            context_window_size=self.configs["context_window"],
            batch_size=self.configs["batch_size"]
        )
        self.validation_processor = DatasetProcessor(
            dataset_path=val_dataset_path,
            check_point=val_checkpoint_path,
            context_window_size=self.configs["context_window"],
            batch_size=self.configs["batch_size"]
        )

        self.system_stats = SystemStats(gpu_refresh_interval=1.0, memory_cleanup_interval=0.01)

        # Training hyperparameters and flags
        self.context_window_size = self.configs["context_window"]
        self.epochs = self.configs["epochs"]
        self.learning_rate = self.configs["learning_rate"]
        self.batch_size = self.configs["batch_size"]
        self.gradient_accumulation_steps = self.configs.get("gradient_accumulation_steps", 4)
        self.logging_steps = self.configs.get("logging_steps", 10)
        self.fp16 = self.configs.get("fp16", True)
        self.bf16 = self.configs.get("bf16", False)
        self.max_grad_norm = self.configs.get("max_grad_norm", 1.0)
        self.pipeline_parallel_size = self.configs.get("pipeline_parallel_size", 2)

        self.model_save_base_dir = os.path.join(self.path_manager.get_path("SAVED_MODELS_PATH"), "fine_tuned_models")
        
        # Prepare for training (setup device, partition model, etc.)
        self._prep_for_training()

    def introspect_model(self):
        """
        Uses Python introspection to get all non-callable attributes of the model.
        This can help you explore the model's architecture programmatically.
        """
        # Use inspect to retrieve all members that are not callable
        members = inspect.getmembers(self.base_model, lambda a: not(inspect.isroutine(a)))
        # Filter out built-in attributes
        attrs = {name: value for name, value in members if not (name.startswith('__') and name.endswith('__'))}
        
        self.logger.info("Introspecting model attributes:")
        for name in sorted(attrs.keys()):
            self.logger.info(f"{name}: {attrs[name]}")
        
        return attrs
    
    def fuzzy_get_attribute(self, obj, target_names, logger, default=None, cutoff=0.8):
        """
        Returns the attribute of 'obj' whose name is a fuzzy match to one of the target_names.
        If no match is found above the cutoff, returns default.
        """
        attributes = [attr for attr in dir(obj) if not attr.startswith('_')]
        for target in target_names:
            matches = difflib.get_close_matches(target, attributes, n=1, cutoff=cutoff)
            if matches:
                matched_attr = matches[0]
                logger.info(f"Fuzzy matched attribute '{matched_attr}' for target '{target}'.")
                return getattr(obj, matched_attr)
        logger.warning(f"No fuzzy match found for targets: {target_names}.")
        return default

    def build_pipeline_layers_from_introspection(self, model_attributes: dict):
        """
        Dynamically builds pipeline layers by introspecting the model attributes dictionary.
        Uses fuzzy matching to handle edge cases and variations in attribute naming.
        """
        pipeline_layers = []
        
        # Determine transformer module: try matching 'model' or 'transformer'
        transformer_module = None
        transformer_module = self.fuzzy_get_attribute(self.base_model, ["transformer", "model"], self.logger)
        if transformer_module is None:
            error_msg = "No transformer module found using fuzzy matching on ['transformer', 'model']."
            self.logger.error(error_msg)
            raise AttributeError(error_msg)
        
        self.logger.info(f"Using transformer module from attribute: {transformer_module}")
        
        # Get embedding layer: try 'wte' or 'embed_tokens'
        embed_layer = self.fuzzy_get_attribute(transformer_module, ["wte", "embed_tokens"], self.logger)
        if embed_layer is not None:
            pipeline_layers.append(embed_layer)
            self.logger.info("Added embedding layer.")
        else:
            self.logger.warning("No embedding layer found (tried 'wte' and 'embed_tokens').")
        
        # Get positional embedding: try 'wpe' or similar
        pos_embed_layer = self.fuzzy_get_attribute(transformer_module, ["wpe", "pos_embedding", "position_embeddings"], self.logger)
        if pos_embed_layer is not None:
            pipeline_layers.append(pos_embed_layer)
            self.logger.info("Added positional embedding layer.")
        else:
            self.logger.warning("No positional embedding layer found (tried 'wpe', 'pos_embedding', 'position_embeddings').")
        
        # Get transformer blocks: look for a ModuleList typically stored in 'h'
        transformer_blocks = self.fuzzy_get_attribute(transformer_module, ["h", "layers"], self.logger)
        if transformer_blocks is None or not isinstance(transformer_blocks, nn.ModuleList):
            error_msg = "No ModuleList of transformer blocks found (tried 'h' or 'layers')."
            self.logger.error(error_msg)
            raise AttributeError(error_msg)
        
        num_layers = len(transformer_blocks)
        self.logger.info(f"Found {num_layers} transformer block layers in ModuleList.")
        
        # Optionally, you might want to use the model's config to determine how many layers to use.
        # For example, using fuzzy matching on the model_attributes['config'] for "num_hidden_layers".
        num_hidden_layers = None
        if "config" in model_attributes:
            config_obj = model_attributes["config"]
            # Try to retrieve num_hidden_layers directly
            if hasattr(config_obj, "num_hidden_layers"):
                num_hidden_layers = getattr(config_obj, "num_hidden_layers")
            else:
                # Fuzzy matching for key in the config's dict if it's a dictionary
                if isinstance(config_obj, dict):
                    matches = difflib.get_close_matches("num_hidden_layers", list(config_obj.keys()), n=1, cutoff=0.8)
                    if matches:
                        num_hidden_layers = config_obj[matches[0]]
            if num_hidden_layers is not None:
                self.logger.info(f"Using 'num_hidden_layers' from config: {num_hidden_layers}")
            else:
                self.logger.warning("Could not determine 'num_hidden_layers' from config; defaulting to all layers.")
        
        # If we didn't get a valid number, default to all transformer blocks.
        if num_hidden_layers is None or num_hidden_layers > num_layers:
            num_hidden_layers = num_layers
        
        # Add the transformer blocks up to num_hidden_layers
        for i in range(num_hidden_layers):
            pipeline_layers.append(transformer_blocks[i])
            self.logger.info(f"Added transformer block layer {i}.")
        
        # Get final normalization layer: try 'ln_f' or 'norm'
        norm_layer = self.fuzzy_get_attribute(transformer_module, ["ln_f", "norm", "final_norm"], self.logger)
        if norm_layer is not None:
            pipeline_layers.append(norm_layer)
            self.logger.info("Added final normalization layer.")
        else:
            self.logger.warning("No final normalization layer found (tried 'ln_f', 'norm', 'final_norm').")
        
        # Optionally add the head: try 'lm_head'
        head_layer = self.fuzzy_get_attribute(self.base_model, ["lm_head", "head"], self.logger)
        if head_layer is not None:
            pipeline_layers.append(head_layer)
            self.logger.info("Added language modeling head layer.")
        else:
            self.logger.warning("No language modeling head layer found (tried 'lm_head', 'head').")
        
        self.logger.info(f"Pipeline layers built successfully. Total layers: {len(pipeline_layers)}")
        return pipeline_layers

    def _prep_for_training(self):
        """
        Prepares training by setting up the device, optimizer, partitioning the model for pipeline parallelism,
        and initializing DeepSpeed with the pipeline configuration.
        """

        if not dist.is_initialized():
            dist.init_process_group(backend="nccl")
        
       
        if not deepspeed_comm.is_initialized():
            deepspeed_comm.init_distributed()

        local_rank = int(os.environ.get("LOCAL_RANK", 0))
        self.device = torch.device("cuda", local_rank)
        self.logger.info(f" Model moved to {self.device}")

        # Use introspection on the underlying base model (if wrapped)
        model_attributes = self.introspect_model()
        
        # Build the pipeline layers from the base model.
        pipeline_layers = self.build_pipeline_layers_from_introspection(model_attributes=model_attributes)
        
        pipeline_model = PipelineModule(layers=pipeline_layers, num_stages=self.pipeline_parallel_size)
          
        self.logger.info("!!!!!!Applying LoRA configuration to the pipeline model.!!!!!!!")
        pipeline_model = get_peft_model(pipeline_model, self.lora_configuration)
            # Apply LoRA modifications
  
        self.pipeline_model = pipeline_model

        self.pipeline_model.to(self.device)
        self.base_model = None

        # Calculate training and warmup steps based on dataset size
        if not hasattr(self.training_processor, "total_records") or not self.training_processor.total_records:
            error_message = "training_processor.total_records is not available or invalid. Please check dataset configuration."
            self.logger.error(error_message)
            raise ValueError(error_message)

        self.num_training_steps = (self.epochs * self.training_processor.total_records) // (self.gradient_accumulation_steps * self.batch_size)
        self.warmup_steps = int(self.configs["warm_up"] * self.num_training_steps)

        # Create optimizer
        self.optimizer = DeepSpeedCPUAdam(self.pipeline_model.parameters(), lr=float(self.learning_rate))

        # Build DeepSpeed configuration with pipeline parallelism settings.
        ds_config = {
            "train_batch_size": self.batch_size * self.gradient_accumulation_steps,
            "gradient_accumulation_steps": self.gradient_accumulation_steps,
            "gradient_clipping": self.max_grad_norm,
            "zero_verbose": 3,  # Enables detailed logging for ZeRO operations
            "steps_per_print": self.logging_steps,
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
            "fp16": {
                "enabled": self.fp16,
                "loss_scale": 0,
                "loss_scale_window": 1000,
                "hysteresis": 1,
                "min_loss_scale": 1
            },
            "bf16": {
                "enabled": self.bf16
            },
            "zero_optimization": {
                "stage": 3,
                "offload_param": {
                    "device": "cpu",
                    "pin_memory": True,
                    "buffer_count": 2,
                    "buffer_size": 50000000,
                    "max_in_cpu": 16000000000
                },
                "offload_optimizer": {
                    "device": "cpu",
                    "pin_memory": True,
                    "buffer_count": 2,
                    "pipeline_read": True,
                    "pipeline_write": True,
                    "fast_init": False,
                    "ratio": 1.0
                },
                "overlap_comm": True,
                "contiguous_gradients": True
            },
            # Pipeline-specific configuration section (if needed)
            "pipeline": {
                "seed_layers": None,  # Optionally specify layers to be seeded identically across stages.
                "activation_checkpoint_interval": 1
            },
            "scheduler": {
                "type": "WarmupLR",
                "params": {
                    "warmup_min_lr": 0,
                    "warmup_max_lr": float(self.learning_rate),
                    "warmup_num_steps": self.warmup_steps
                }
            },
            "checkpoint": {
                "save_optimizer_states": True,
                "save_zero_checkpoint": True,
                "save_interval": 1000
            },
            "data_type": "fp16" if self.fp16 else ("bf16" if self.bf16 else "fp32"),
            "load_from_fp32_weights": True,
            "ignore_unused_parameters": True,
            "memory_efficient_linear": True
        }

        # Initialize DeepSpeed; this wraps the pipeline module and optimizer.
        try:
            self.pipeline_engine, self.optimizer, _, _ = deepspeed.initialize(
                model=self.pipeline_model,
                optimizer=self.optimizer,
                config=ds_config
            )
        except Exception as initialization_exception:
            self.logger.error("DeepSpeed initialization failed.", exc_info=True)
            raise initialization_exception

        self.use_amp = self.fp16 or self.bf16
        self.dtype = torch.float16 if self.fp16 else (torch.bfloat16 if self.bf16 else torch.float32)
      
        self.logger.info(f"Prep for training complete:"
                         f"\n Device: {self.device}"
                         f"\n Training Steps: {self.num_training_steps}"
                         f"\n Warmup steps: {self.warmup_steps}"
                         f"\n Epochs: {self.epochs}"
                         f"\n Batch Size: {self.batch_size}"
                         f"\n Pipeline Parallel Size: {self.pipeline_parallel_size}")

    def train(self):
        """
        Simplified training loop using the DeepSpeed pipeline engine's forward, backward, and optimization methods.
        """
        self.logger.info("Starting training process with DeepSpeed pipeline engine...")
        self.logger.info(f"Model running on device: {self.device}")

        global_step = 0
        for current_epoch in range(self.epochs):
            self.logger.info(f"Epoch {current_epoch + 1}/{self.epochs}")
            self.pipeline_engine.train()
            progress_bar = tqdm(self.training_processor, desc=f"Epoch {current_epoch + 1} Training", unit="batch")

            for batch in progress_bar:
                # Tokenize the batch
                inputs = self.tokenizer(
                    batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True
                ).to(self.device)

                # Forward pass through the pipeline engine
                outputs = self.pipeline_engine(
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    labels=inputs["input_ids"]
                )
                loss = outputs.loss
                self.pipeline_engine.backward(loss)
                self.pipeline_engine.step()

                global_step += 1
                progress_bar.set_postfix(loss=loss.item())
                if global_step % self.logging_steps == 0:
                    self.logger.info(f"Step {global_step}: Loss = {loss.item():.4f}")

            # Optionally save checkpoint after each epoch
            self.save_model_with_timestamp()
            self.logger.info(f"Checkpoint saved at Epoch: {current_epoch + 1}")

            # Optionally run validation per epoch
            self.validate(current_epoch)
        
        self.logger.info("Saving final model...")
        self.save_model_with_timestamp()
        self.logger.info("Training completed.")

    def validate(self, epoch_index: int):
        """
        Runs validation after each epoch.
        """
        self.logger.info(f"Running validation for Epoch {epoch_index + 1}...")
        self.pipeline_engine.eval()
        total_validation_loss = 0.0
        batch_count = 0
        progress_bar = tqdm(self.validation_processor, desc=f"Epoch {epoch_index + 1} Validation", unit="batch")
        with torch.no_grad():
            for step_index, batch in enumerate(progress_bar):
                inputs = self.tokenizer(
                    batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True
                ).to(self.device)
                outputs = self.pipeline_engine(
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    labels=inputs["input_ids"]
                )
                loss = outputs.loss
                total_validation_loss += loss.item()
                batch_count += 1
                progress_bar.set_postfix(loss=loss.item())
                self.logger.info(f"Validation Step {step_index + 1}: Loss = {loss.item():.4f}")

        average_validation_loss = total_validation_loss / batch_count if batch_count > 0 else float("inf")
        self.logger.info(f"Epoch {epoch_index + 1} Validation Completed. Average Loss: {average_validation_loss:.4f}")

    def save_model_with_timestamp(self):
        """
        Saves the pipeline engine checkpoint and tokenizer with a timestamped name.
        """
        try:
            current_timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            model_save_directory = os.path.join(self.model_save_base_dir, f"{self.configs['save_name']}_{current_timestamp}")
            os.makedirs(model_save_directory, exist_ok=True)
            self.pipeline_engine.save_checkpoint(model_save_directory)
            self.tokenizer.save_pretrained(model_save_directory)
            self.logger.info(f"✅ Model saved at: {model_save_directory}")
        except Exception as save_exception:
            self.logger.error("Failed to save checkpoint.", exc_info=True)
            raise save_exception

if __name__ == "__main__":
    path_manager = PathManager()
    train_dataset_path = path_manager.get_path("WSO_TRAIN_DS")
    val_dataset_path = path_manager.get_path("WSO_VAL_DS")
    trainer = DeepSpeedPipelineTrainer(train_dataset_path=train_dataset_path, val_dataset_path=val_dataset_path)
    trainer.train()
