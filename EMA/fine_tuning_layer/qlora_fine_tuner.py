#qlora_fine_tuner.py
import os
import torch
from dotenv import load_dotenv
import yaml
import wandb
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from fine_tuning_layer.edge_trainer import CustomTrainer
from utilities.logger import get_logger
from fine_tuning_layer.dataset_processor import DatasetProcessor
from utilities.path_manager import PathManager

class QLoRAFineTuner:
    def __init__(self, train_dataset_path: str, val_dataset_path: str):
        self.path_manager = PathManager()

        config_path = self.path_manager.get_path("FINE_TUNING")
        with open(config_path, "r") as file:
            self.config = yaml.safe_load(file)

        # Initialize logger
        self.logger = get_logger("QLoRAFineTuner")

        # ✅ Initialize tokenizer once
        tokenizer = AutoTokenizer.from_pretrained(self.config["model_name"])
        tokenizer.pad_token = tokenizer.eos_token  # Ensure proper padding

        # ✅ Initialize LoRA Config
        lora_config = LoraConfig(
            r=self.config["lora"]["r"],
            lora_alpha=self.config["lora"]["alpha"],
            lora_dropout=self.config["lora"]["dropout"],
            bias=self.config["lora"]["bias"],
            target_modules=self.config["lora"]["target_modules"]  # ✅ Dynamically set from YAML
            
        )

        # ✅ Restore Quantization Logic
        quantization_enabled = self.config.get("quantization", {}).get("enable", False)
        quant_bits = self.config.get("quantization", {}).get("bits", 16)
        compute_dtype = torch.float16 if self.config.get("quantization", {}).get("compute_dtype", "float16") == "float16" else torch.bfloat16
        device_map = self.config.get("quantization", {}).get("device_map", "auto")

        self.logger.info(f"Quantization Enabled: {quantization_enabled}")
        self.logger.info(f"Bits: {quant_bits}")
        self.logger.info(f"Compute dtype: {compute_dtype}")
        self.logger.info(f"Device map: {device_map}")

        # ✅ Configure quantization settings
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

            model = AutoModelForCausalLM.from_pretrained(self.config["model_name"], **quantization_kwargs)
        else:
            model = AutoModelForCausalLM.from_pretrained(self.config["model_name"])

        # ✅ Apply LoRA after quantization
        model = get_peft_model(model, lora_config)

        VAL_TUNE_CHECKPOINTS = self.path_manager.get_path("FINE_TUNE_CHECKPOINTS") + "/val_checkpoint.txt"
        TRAIN_CHECKPOINTS = self.path_manager.get_path("FINE_TUNE_CHECKPOINTS") + "/train_checkpoint.txt"
        # Initialize dataset processors
        train_dataset_processor = DatasetProcessor(dataset_path=train_dataset_path, check_point=TRAIN_CHECKPOINTS, context_window_size=self.config["context_window"], batch_size=self.config["batch_size"])
        val_dataset_processor = DatasetProcessor(dataset_path=val_dataset_path, check_point=VAL_TUNE_CHECKPOINTS, context_window_size=self.config["context_window"], batch_size=self.config["batch_size"])

        # Initialize WandB
        self.init_wandb()

        # ✅ Initialize Trainer with preloaded model & tokenizer
        self.logger.info("Initializing trainer...")
        self.trainer = CustomTrainer(
            model=model,  # ✅ Pass preloaded model
            tokenizer=tokenizer,  # ✅ Pass preloaded tokenizer
            train_processor=train_dataset_processor,
            val_processor=val_dataset_processor,
            wandb_enabled=self.wandb_enabled,
            configs=self.config,
        )
    
    def init_wandb(self):
        """
        Initialize WandB logging.
        """
        load_dotenv()  # Load environment variables from .env
        wandb_api_key = os.getenv("WB_TOKEN")  # Fetch API key

        self.wandb_enabled = self.config["wandb"].get("enable", False)
        
        if self.wandb_enabled:
            if not wandb_api_key:
                self.logger.error("WandB API key not found. Make sure it is set in .env")
                return
            
            wandb.login(key=wandb_api_key)  # Explicit login

            wandb.init(
                project=self.config["wandb"].get("project_name", "default_project"),
                name=f"{self.config['model_name']}-run-{self.config.get('run_id', 'default')}",
                entity=self.config["wandb"].get("entity", None),
                config=self.config
            )
            self.logger.info("Weights & Biases logging initialized.")

    def train(self):
        """
        Fine-tune the model with LoRA.
        """
        self.logger.info("Starting fine-tuning...")
        self.trainer.train()  # ✅ Uses the preloaded model

        if self.wandb_enabled:
            wandb.finish()

        self.logger.info(f"Fine-tuning complete. Model saved.")