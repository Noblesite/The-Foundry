from transformers import TrainingArguments, get_scheduler
import wandb
import torch
from datetime import datetime
from tqdm import tqdm
from torch.optim import AdamW
import torch.distributed as dist
import torch.nn.parallel
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from utilities.system_stats import SystemStats
import os

class CustomTrainer:
    """
    Custom Trainer class to fine-tune a language model using a streaming dataset.
    Supports mixed precision, WandB logging, and validation after each epoch.
    """

    def __init__(self, model, tokenizer, train_processor, val_processor, wandb_enabled, configs):
        """
        Initializes the trainer with the model, tokenizer, datasets, and training parameters.
        """
        self.wandb_enabled = wandb_enabled
        self.logger = get_logger("CustomTrainer")
        self.path_manager = PathManager()
        self.configs = configs
       
        # Cuda & MPS memory clean up
        self.system_stats = SystemStats(gpu_refresh_interval=1.0, memory_cleanup_interval=0.01)
       
        # Preloaded Model and Tokenizer
        self.model = model
        self.tokenizer = tokenizer

        # Special Characters for Token Estimation
        self.special_chars = set("@/[]|{}#&$%()*+=!<>?^_:;~,`")

        # Iterable Dataset 
        self.training_processor = train_processor
        self.validation_processor = val_processor

        # Setup Training Arguments
        self.context_window_size = configs["context_window"]
        self.epochs = self.configs["epochs"]
        self.learning_rate = self.configs["learning_rate"]
        self.lr_scheduler_type = "cosine"  # TODO: Abstract to configs
        self.batch_size = self.configs["batch_size"]
        self.eval_strategy = "epoch"  # TODO: Abstract to configs
        self.save_strategy = "epoch"  # TODO: Abstract to configs
        self.global_step = 0 
        self.step = 0
        self.save_steps = 100  # TODO: Abstract to configs
        self.save_total_limit = 2  # TODO: Abstract to configs
        self.gradient_accumulation_steps = 4  # TODO: Abstract to configs
        self.logging_steps = 10  # TODO: Abstract to configs
        self.epoch_counter = 0  # TODO: Abstract to configs
        self.fp16 = True  # TODO: Abstract to configs
        self.bf16 = False  # TODO: Abstract to configs
        self.max_grad_norm = 1.0
        self.gradient_checkpointing = True

        # Enable gradient checkpointing if supported by the model
        if self.gradient_checkpointing and hasattr(self.model, "gradient_checkpointing_enable"):
            self.model.gradient_checkpointing_enable()
            self.logger.info("✅ Gradient checkpointing enabled.")

        # Paths for Saving Model and Logs
        self.model_save_base_dir = os.path.join(self.path_manager.get_path("SAVED_MODELS_PATH"), "fine_tuned_models")

    def round_out_records(self, records):
        rounded_records = []
        buffer = []

        for record in records:
            text = record if isinstance(record, str) else record.get("text", "")
            estimated_tokens = self.estimate_token_length_custom(text)

            # If buffer + new record exceeds context size, stop merging
            if sum(self.estimate_token_length_custom(t) for t in buffer) + estimated_tokens > self.context_window_size:
                rounded_records.append(" ".join(buffer))
                buffer = [text]
            else:
                buffer.append(text)

        if buffer:
            rounded_records.append(" ".join(buffer))

        return rounded_records
    
    def chunk_text_sliding_window(self, text: str) -> list:
        max_tokens = self.context_window_size
        estimated_tokens = self.estimate_token_length_custom(text)

        if estimated_tokens <= max_tokens:
            return [text]

        self.logger.info(f"Chunking required: {estimated_tokens} tokens exceed {max_tokens} limit.")

        words = text.split()
        chunks = []
        current_chunk = []
        current_token_count = 0
        overlap_size = int(max_tokens * 0.10)

        for word in words:
            word_token_estimate = int(len(word) * 0.75)
            special_char_count = sum(1 for char in word if char in self.special_chars)
            word_total_tokens = word_token_estimate + special_char_count

            # If adding this word exceeds max_tokens, finalize chunk
            if current_token_count + word_total_tokens > max_tokens:
                chunks.append(" ".join(current_chunk))
                # Retain overlap (only last `overlap_size` words)
                current_chunk = current_chunk[-overlap_size:]
                current_token_count = sum(self.estimate_token_length_custom(w) for w in current_chunk)
            current_chunk.append(word)
            current_token_count += word_total_tokens

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    def estimate_token_length_custom(self, text: str) -> int:
        """
        Estimates the number of tokens in a given text using:
        - 3/4th's rule for standard words.
        - Special character adjustments for known single-token symbols.
        """
        words = text.split()
        special_char_count = sum(1 for char in text if char in self.special_chars)
        word_token_count = int(len(words) * 0.75)
        estimated_tokens = word_token_count + special_char_count
        return estimated_tokens

    def _setup_distributed_training(self):
        """
        Initializes DistributedDataParallel (DDP) for multi-GPU training.
        """
        self.logger.info("🚀 Initializing DistributedDataParallel (DDP)...")

        os.environ["MASTER_ADDR"] = "127.0.0.1"
        os.environ["MASTER_PORT"] = "29500"

        world_size = torch.cuda.device_count()
        os.environ["WORLD_SIZE"] = str(world_size)

        rank = int(os.getenv("RANK", "0"))
        os.environ["RANK"] = str(rank)

        self.logger.info(f"🌍 WORLD_SIZE: {os.environ['WORLD_SIZE']}, RANK: {os.environ['RANK']}")

        dist.init_process_group(backend="nccl", rank=rank, world_size=world_size)
        torch.cuda.set_device(rank)
        self.device = torch.device(f"cuda:{rank}")
        self.model.to(self.device)

        # Use only the current GPU (by rank) for DDP
        self.model = torch.nn.parallel.DistributedDataParallel(
            self.model,
            device_ids=[rank],
            output_device=rank
        )

        self.logger.info(f"✅ Model successfully initialized across {world_size} GPUs.")
        
    def train(self):
        """
        Executes the fine-tuning process using a custom training loop.
        """
        self.logger.info("Starting training process with a streaming dataset...")

        # Setup device (CUDA, MPS, or CPU)
        self.device_type = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        self.device = torch.device(self.device_type)
        self.model.to(self.device)
        self.logger.info(f"🚀 Model moved to {self.device}")

        # Enable gradient checkpointing if supported and enabled
        if self.gradient_checkpointing and hasattr(self.model, "gradient_checkpointing_enable"):
            self.model.gradient_checkpointing_enable()
            self.logger.info("✅ Gradient checkpointing enabled.")

        # Optimizer and Learning Rate Scheduler
        self.optimizer = AdamW(self.model.parameters(), lr=float(self.learning_rate))
        self.num_training_steps = (self.epochs * self.training_processor.total_records) // (self.gradient_accumulation_steps * self.batch_size)
        self.warmup_steps = int(self.configs["warm_up"] * self.num_training_steps)

        self.lr_scheduler = get_scheduler(
            name=self.lr_scheduler_type,
            optimizer=self.optimizer,
            num_warmup_steps=self.warmup_steps,
            num_training_steps=self.num_training_steps,
        )

        # Mixed Precision Setup
        self.use_amp = self.fp16 or self.bf16  # Enable AMP if needed
        self.dtype = torch.float16 if self.fp16 else torch.bfloat16 if self.bf16 else torch.float32
        self.scaler = torch.amp.GradScaler() if self.fp16 and self.device_type == "cuda" else None

        while self.epoch_counter < self.epochs:
            self.logger.info(f"Epoch {self.epoch_counter+1}/{self.epochs}")
            self.model.train()

            progress_bar = tqdm(self.training_processor, desc=f"Epoch {self.epoch_counter+1} Training", unit="batch")
            self.logger.info(f"📊 Total batches available: ({self.training_processor.total_records / self.batch_size})")
            total_loss = 0
            self.step = 0

            for batch in progress_bar:
                self.logger.info(f"🛠️ Processing batch {self.step+1}/{self.training_processor.total_records}")
                self.logger.info(f"📦 Processing batch {self.step} with {len(batch)} records.")

                # Process each record in the batch
                filtered_batch = []
                for record in batch:
                    estimated_tokens = self.estimate_token_length_custom(record)
                    if estimated_tokens > self.context_window_size:
                        self.logger.warning(f"🚨 Record exceeds {self.context_window_size} tokens! Splitting...")
                        filtered_batch.extend(self.chunk_text_sliding_window(record))
                    else:
                        filtered_batch.append(record)

                # Batch tokenization and ensure token count is within limit
                inputs = self.tokenizer(
                    filtered_batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True    
                ).to(self.device)
                token_counts = (inputs["input_ids"] != self.tokenizer.pad_token_id).sum(dim=1)
                if (token_counts > self.context_window_size).any():
                    self.logger.warning(f"🚨 Some tokenized inputs still exceed {self.context_window_size}! Rechunking...")
                    reprocessed_batch = []
                    for idx, record in enumerate(filtered_batch):
                        if token_counts[idx] > self.context_window_size:
                            reprocessed_batch.extend(self.chunk_text_sliding_window(record))
                        else:
                            reprocessed_batch.append(record)
                    filtered_batch = reprocessed_batch
                    inputs = self.tokenizer(
                        filtered_batch,
                        max_length=self.context_window_size,
                        truncation=True,
                        padding=True,
                        return_tensors="pt",
                        return_attention_mask=True    
                    ).to(self.device)

                # Forward pass using mixed precision if enabled
                if self.use_amp:
                    with torch.amp.autocast(self.device_type, dtype=self.dtype):
                        outputs = self.model(
                            input_ids=inputs["input_ids"],
                            attention_mask=inputs["attention_mask"],
                            labels=inputs["input_ids"]
                        )
                else:
                    outputs = self.model(
                        input_ids=inputs["input_ids"],
                        attention_mask=inputs["attention_mask"],
                        labels=inputs["input_ids"]
                    )
                loss = outputs.loss / self.gradient_accumulation_steps

                # Backward pass with gradient scaling if applicable
                if self.scaler:
                    self.scaler.scale(loss).backward()
                else:
                    loss.backward()

                if (self.step + 1) % self.gradient_accumulation_steps == 0:
                    # Apply Gradient Clipping
                    if self.max_grad_norm:
                        torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.max_grad_norm)

                    if self.scaler:
                        self.scaler.step(self.optimizer)
                        self.scaler.update()
                    else:
                        self.optimizer.step()

                    self.optimizer.zero_grad()
                    self.lr_scheduler.step()
                    self.global_step += 1

                    # Log memory after gradient accumulation (if on CUDA)
                    if self.device_type == "cuda":
                        self.logger.info(f"🔥 After Gradient Step {self.step} - CUDA Reserved: {torch.cuda.memory_reserved() / 1e9:.2f} GB, Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")

                total_loss += loss.item()
                progress_bar.set_postfix(loss=loss.item())
                
                # Log memory after forward pass (if on CUDA)
                if self.device_type == "cuda":
                    self.logger.info(f"🔥 After Forward Pass {self.step} - CUDA Reserved: {torch.cuda.memory_reserved() / 1e9:.2f} GB, Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")

                # Step-Level Logging
                if self.global_step % self.logging_steps == 0:
                    self.logger.info(f"Step {self.global_step}: Loss = {loss.item():.4f}, LR = {self.lr_scheduler.get_last_lr()[0]:.6f}")
                    
                # Periodic Checkpointing
                if self.save_strategy == "steps" and self.global_step % self.save_steps == 0:
                    self.save_model_with_timestamp()
                    self.logger.info(f"Checkpoint saved at step {self.global_step}")

                self.step += 1

            avg_train_loss = total_loss / (self.step if self.step > 0 else 1)
            self.logger.info(f"Epoch {self.epoch_counter+1} Training Completed. Average Loss: {avg_train_loss:.4f}")

            # Run validation at epoch end if strategy is "epoch"
            if self.eval_strategy == "epoch":
                self.validate(self.epoch_counter)
            
            # Saving after each Epoch
            if self.save_strategy == "epoch":
                self.save_model_with_timestamp()
                self.logger.info(f"Checkpoint saved at Epoch: {self.epoch_counter}")

            self.epoch_counter += 1

        # Save Final Model
        self.logger.info("Saving final model...")
        self.save_model_with_timestamp()
        self.logger.info("Training completed.")

    def validate(self, epoch):
        """
        Runs validation after each epoch, computing loss on the validation dataset.
        """
        self.logger.info(f"Running validation for Epoch {epoch+1}...")
        self.model.eval()

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

                if self.use_amp:
                    with torch.amp.autocast(self.device_type, dtype=self.dtype):
                        outputs = self.model(
                            input_ids=inputs["input_ids"],
                            attention_mask=inputs["attention_mask"],
                            labels=inputs["input_ids"]
                        )
                else:
                    outputs = self.model(
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
        """
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        model_save_path = os.path.join(self.model_save_base_dir, f"{self.configs['save_name']}_{timestamp}")
        os.makedirs(model_save_path, exist_ok=True)
        self.model.save_pretrained(model_save_path)
        self.tokenizer.save_pretrained(model_save_path)
        self.logger.info(f"✅ Model saved at: {model_save_path}")