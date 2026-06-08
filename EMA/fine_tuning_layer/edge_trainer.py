from transformers import TrainingArguments, get_scheduler
import torch
import math
import time
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
        self.system_stats = SystemStats(gpu_refresh_interval=0.01, memory_cleanup_interval=0.1)
       
        # ✅ Preloaded Model and Tokenizer
        self.model = model
        self.tokenizer = tokenizer

        # Iterable Dataset 
        self.training_processor = train_processor
        self.validation_processor = val_processor

        # ✅ Setup Training Arguments
        self.context_window_size = configs["context_window"]
        self.epochs = self.configs["epochs"]
        self.learning_rate = self.configs["learning_rate"]
        self.lr_scheduler_type = "cosine" #TODO: Abstract to configs
        self.batch_size = self.configs["batch_size"]
        self.eval_strategy = "epoch" #TODO: Abstract to configs
        self.save_strategy = "epoch" #TODO: Abstract to configs
        self.steps_per_epoch = 0
        self.global_step = 0 
        self.step = 0
        self.save_steps = 100 #TODO: Abstract to configs
        self.save_total_limit = 2 #TODO: Abstract to configs
        self.gradient_accumulation_steps = 4 #TODO: Abstract to configs
        self.logging_steps = 10 #TODO: Abstract to csonfigs
        self.epoch_counter = 0 #TODO: Abstract to configs
        self.fp16 = True #TODO: Abstract to configs
        self.bf16 = False #TODO: Abstract to configs
        self.max_grad_norm = 1.0
        self.gradient_checkpointing = False
        self.total_loss = 0

        # ✅ Paths for Saving Model and Logs
        self.model_save_base_dir = self.path_manager.get_path("SAVED_MODELS_PATH") + "/fine_tuned_models/"
        
        self._prep_for_training()

    def round_out_records(self, records):
        rounded_records = []
        buffer = []

        for record in records:
            text = record if isinstance(record, str) else record.get("text", "")
            estimated_tokens = self.estimate_token_length_custom(text)

            # ✅ If buffer + new record exceeds context size, stop merging
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

            # ✅ If adding this word exceeds max_tokens, finalize chunk
            if current_token_count + word_total_tokens > max_tokens:
                chunks.append(" ".join(current_chunk))

                # ✅ Retain overlap (only last `overlap_size` words)
                current_chunk = current_chunk[-overlap_size:]
                current_token_count = sum(self.estimate_token_length_custom(w) for w in current_chunk)

            # ✅ Add word to the current chunk
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
        
        Args:
            text (str): Input text to estimate.

        Returns:
            int: Estimated token count.
        """
       
        # ✅ Split text into words (ignores punctuation but keeps special symbols)
        words = text.split()

        # ✅ Count special characters separately
        special_char_count = sum(1 for char in text if char in self.special_chars)

        # ✅ Apply 3/4th's rule: Assuming each word contributes ~0.75 tokens
        word_token_count = int(len(words) * 0.75)

        # ✅ Estimated total tokens
        estimated_tokens = word_token_count + special_char_count

        return estimated_tokens

    def _setup_distributed_training(self):
        """
        Initializes DistributedDataParallel (DDP) for multi-GPU training.
        Ensures each process is assigned a unique GPU and synchronizes properly.
        """
        self.logger.info("🚀 Initializing DistributedDataParallel (DDP)...")

        os.environ["MASTER_ADDR"] = "127.0.0.1"
        os.environ["MASTER_PORT"] = "29500"

        # ✅ Ensure WORLD_SIZE is set correctly
        world_size = torch.cuda.device_count()
        os.environ["WORLD_SIZE"] = str(world_size)

        # ✅ Ensure unique RANK assignment
        rank = int(os.getenv("RANK", "0"))
        os.environ["RANK"] = str(rank)

        self.logger.info(f"🌍 WORLD_SIZE: {os.environ['WORLD_SIZE']}, RANK: {os.environ['RANK']}")

        # ✅ Initialize process group for DDP
        dist.init_process_group(backend="nccl", rank=rank, world_size=world_size)

        # ✅ Assign GPU based on RANK
        torch.cuda.set_device(rank)
        self.device = torch.device(f"cuda:{rank}")

        # ✅ Move model to assigned GPU
        self.model.to(self.device)

        # ✅ Wrap model in DistributedDataParallel with multiple GPUs
        self.model = torch.nn.parallel.DistributedDataParallel(
            self.model,
            device_ids=list(range(world_size)),  # ✅ Use all available GPUs
            output_device=rank
        )

        self.logger.info(f"✅ Model successfully initialized across {world_size} GPUs.")

    def _prep_for_training(self):

        self.device_type = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        self.device = torch.device(self.device_type)
        self.cpu_device = None
        if self.device_type == "cuda":
            self.cpu_device = torch.device("cpu")
        self.model.to(self.device)
        self.logger.info(f"🚀 Model moved to {self.device}")

        # Enable gradient checkpointing if available
        if self.gradient_checkpointing and hasattr(self.model, 'gradient_checkpointing_enable'):
            self.model.gradient_checkpointing_enable()
            self.logger.info("✅ Gradient checkpointing enabled.")

        # ✅ Optimizer and Learning Rate Scheduler
        self.optimizer = AdamW(self.model.parameters(), lr=float(self.learning_rate))

        #TODO Abstract warm up % to fine tune configs 
        # ✅ Compute total steps
        self.num_training_steps = (self.epochs * self.training_processor.total_records) // (self.gradient_accumulation_steps * self.batch_size)
        self.steps_per_epoch = math.ceil(self.training_processor.total_records / self.batch_size)
        self.warmup_steps = int(self.configs["warm_up"] * self.num_training_steps)

        self.lr_scheduler = get_scheduler(
            name=self.lr_scheduler_type,
            optimizer=self.optimizer,
            num_warmup_steps=self.warmup_steps,
            num_training_steps=self.num_training_steps,
        )

        # ✅ Enable Mixed Precision
        self.use_amp = self.fp16 or self.bf16  # Automatically enable AMP
        self.dtype = torch.float16 if self.fp16 else torch.bfloat16 if self.bf16 else torch.float32

        # ✅ Only use GradScaler when training on CUDA
        self.scaler = torch.amp.GradScaler("cuda") if self.fp16 and self.device_type == "cuda" else None

        self.logger.info(f"Prep for training complete:" 
                         f"\n Device Type: {self.device_type}"
                         f"\n Training Steps: {self.num_training_steps}"
                         f"\n Steps per Epoch: {self.steps_per_epoch}"
                         f"\n Warm up steps: {self.warmup_steps}"
                         f"\n Number of Epochs: {self.epochs}"
                         f"\n And Batch Size of: {self.batch_size}")
        
    def adjust_training_parameters(self):
        """
        Adjusts training parameters to save VRAM based on current CUDA memory usage.
        Halves the batch size and doubles gradient accumulation steps if memory usage exceeds a threshold.
        """
        if self.device_type == "cuda":
            reserved = torch.cuda.memory_reserved() / 1e9  # in GB
            threshold = 1.0  # example threshold in GB
            if reserved > threshold:
                new_batch_size = max(1, self.batch_size // 2)
                new_grad_accum = self.gradient_accumulation_steps * 2
                self.logger.info(f"Adjusting training parameters due to high memory usage. Batch size: {self.batch_size} -> {new_batch_size}, Gradient Accumulation: {self.gradient_accumulation_steps} -> {new_grad_accum}")
                self.batch_size = new_batch_size
                self.gradient_accumulation_steps = new_grad_accum

    def chunk_tokenized_sliding_window(self, tokenized_input, overlap_ratio: float = 0.30):
        """
        Splits a tokenized input (a list of token IDs) into chunks with a configurable overlap.
        The chunking is performed on the CPU, and each chunk is converted to a tensor (with an attention mask)
        and moved to the GPU before being yielded.
        
        Args:
            tokenized_input (list): A list of token IDs.
            overlap_ratio (float): Fraction of max_tokens to overlap between chunks.
        
        Yields:
            dict: A dictionary with keys "input_ids" and "attention_mask" on the GPU.
        """
        max_tokens = self.context_window_size
        total_tokens = len(tokenized_input)

        # If the sequence fits within the context window, yield it as a tensor.
        if total_tokens <= max_tokens:

            inputs = tokenized_input.to(self.device)
            self.throttle_trainer()
            yield inputs
            return

        overlap_size = int(max_tokens * overlap_ratio)
        self.logger.info(f"Chunking required: {total_tokens} tokens exceed {max_tokens} limit.")

        start = 0
        while start < total_tokens:
            self.throttle_trainer()
            end = min(start + max_tokens, total_tokens)

            # Throttle if needed before processing the chunk.
            self.throttle_trainer()

            # Get the current chunk and convert it to a tensor.
            chunk = tokenized_input[start:end]
            
            inputs = chunk.to(self.device)
            self.throttle_trainer()
            yield inputs

            if end == total_tokens:
                del tokenized_input
                break

            start += max_tokens - overlap_size


    def training_dataset_iterator(self):
         
        while self.epoch_counter < self.epochs:
            self.logger.info(f"Epoch {self.epoch_counter+1}/{self.epochs}")
            self.model.train()

            training_iterator = tqdm(self.training_processor, desc=f"Epoch {self.epoch_counter+1} Training", unit="batch")
            self.logger.info(f"📊 Total batches available: ({self.training_processor.total_records / self.batch_size})")

            for batch in training_iterator:
                #self.adjust_training_parameters()
                self.logger.info(f"🛠️ Processing batch {self.step+1}/{self.training_processor.total_records}")
                self.logger.info(f"📦 Processing batch {self.step+1} with {len(batch)} records.")

                self.accumulated_loss = None

                self.throttle_trainer()
                
                self.tokenize_batch(batch)
    
    
    #TODO: abstract sleeptime s
    def throttle_trainer(self):

         while not self.system_stats.is_below_thresholds():
            self.logger.warning(f"🚨 System Resources is above threesholds, throttling.. Step: {self.step+1} \n"
                                f"Memory: {self.system_stats.get_gpu_stats()}")
            time.sleep(10)
        
    def tokenize_batch(self, batch):

        self.throttle_trainer()
        
        inputs = self.tokenizer(
                    batch,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True    
                ).to(self.cpu_device)
        
        token_counts = (inputs["input_ids"] != self.tokenizer.pad_token_id).sum(dim=1)
        self.logger.info(f"🔢 Tokenized batch sizes: {token_counts.tolist()} (Max: {token_counts.max().item()})")
        
        self.throttle_trainer()
                # Reprocess any batch that still exceeds context_window_size
        if (token_counts > self.context_window_size).any():
            self.logger.warning(f"🚨 Some tokenized inputs still exceed {self.context_window_size}! Rechunking...")

          
        for chunk in self.chunk_tokenized_sliding_window(inputs):
            self.throttle_trainer()
            self.model_input_training(chunk)  # Your processing logic here
            self.throttle_trainer()
            
        self.step +=1    
        self.steps_per_epoch -=1
 
    def model_input_training(self, inputs):

        input_ids = inputs["input_ids"]
        attention_mask = inputs["attention_mask"]

        self.logger.debug(f" model_input_training Called on step: {self.step+1}")

        self.throttle_trainer()

        if self.use_amp:
            self.logger.info("Using AMP")
            with torch.amp.autocast(self.device_type, dtype=self.dtype):
                outputs = self.model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    labels=input_ids
                )
        else:
            outputs = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                labels=input_ids
            )

        # Free the inputs to help memory management
        del inputs

        chunk_loss = outputs.loss / self.gradient_accumulation_steps

        # Free the outputs after extracting loss
        del outputs

        if self.accumulated_loss is None:
            self.accumulated_loss = chunk_loss
        else:
            self.accumulated_loss = self.accumulated_loss + chunk_loss

        if self.accumulated_loss is not None:
            if self.scaler:
                self.throttle_trainer()
                self.scaler.scale(self.accumulated_loss).backward()
            else:
                self.accumulated_loss.backward()

        if (self.step + 1) % self.gradient_accumulation_steps == 0:
            self.logger.info(f"🛠️ Gradient accumulation: update model weights on step: {self.step+1}")
            if self.max_grad_norm:
                self.throttle_trainer()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.max_grad_norm)
            if self.scaler:
                self.throttle_trainer()
                self.scaler.step(self.optimizer)
                self.scaler.update()
            else:
                self.throttle_trainer()
                self.optimizer.step()

            self.throttle_trainer()
            self.optimizer.zero_grad()
            self.lr_scheduler.step()
            self.global_step += 1

            if self.device_type == "cuda":
                self.logger.info(f"🔥 After Gradient Step {self.step+1} - CUDA Reserved: {torch.cuda.memory_reserved() / 1e9:.2f} GB, Allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")

            # Clean up accumulated loss to free memory
            del self.accumulated_loss
            self.accumulated_loss = None
        
        # Step-Level Logging
        #if self.global_step % self.logging_steps == 0:
        #    self.logger.info(f"Step {self.global_step}: Loss = {self.accumulated_loss.item():.4f}, LR = {self.lr_scheduler.get_last_lr()[0]:.6f}") 

        if self.steps_per_epoch == 0:

            #avg_train_loss =self.total_loss / (self.step if self.step > 0 else 1)  # ✅ Avoid division by zero
            #self.logger.info(f"Epoch {self.epoch_counter+1} Training Completed. Average Loss: {avg_train_loss:.4f}")

            # ✅ Run validation at epoch end if strategy is "epoch"
            if self.eval_strategy == "epoch":
                self.validate(self.epoch_counter)
                
            # ✅ Saving after each Epoch
            if self.save_strategy == "epoch":
                self.save_model_with_timestamp()
                self.logger.info(f"Checkpoint saved at Epoch: {self.epoch_counter}")

            self.epoch_counter += 1  # ✅ Increment epoch only after all steps are processed
            self.steps_per_epoch = 0

        if self.epoch_counter > self.epochs:

            # ✅ Save Final Model
            self.logger.info("Training completed.")
            self.logger.info("Saving final model...")
            self.save_model_with_timestamp()

        
    def train(self):
        """
        Executes the fine-tuning process using a custom training loop.
        Now leverages gradient accumulation, mixed precision, periodic evaluation, and logging.
        """
        self.logger.info("Starting training process with a streaming dataset...")

        self.training_dataset_iterator()   

    
    def validate(self, epoch):
        """
        Runs validation after each epoch, computing loss on the validation dataset.
        """
        self.logger.info(f"Running validation for Epoch {epoch+1}...")
        self.model.eval()  # ✅ Set model to evaluation mode

        total_val_loss = 0
        num_batches = 0  # ✅ Keep track of number of batches

        progress_bar = tqdm(self.validation_processor, desc=f"Epoch {epoch+1} Validation", unit="batch")

        with torch.no_grad():  # ✅ No gradient calculation during validation
            for step, batch in enumerate(progress_bar):
                # ✅ batch is a list of raw text strings from DatasetProcessor
                inputs = self.tokenizer(
                    batch,
                    max_length=self.context_window_size,
                    truncation=True,
                    padding=True,
                    return_tensors="pt",
                    return_attention_mask=True    
                ).to(self.device)

            
                input_ids = inputs["input_ids"]
                attention_mask = inputs["attention_mask"]

                with torch.amp.autocast(self.device_type, dtype=self.dtype) if self.use_amp else torch.no_grad():
                    outputs = self.model(
                        input_ids=input_ids,
                        attention_mask=attention_mask,
                        labels=input_ids
                    )
                    loss = outputs.loss
                # ✅ Accumulate Validation Loss
                total_val_loss += loss.item()
                num_batches += 1  # ✅ Count processed batches

                progress_bar.set_postfix(loss=loss.item())

                # ✅ Log Step-Level Validation Loss
                self.logger.info(f"Validation Step {step+1}: Loss = {loss.item():.4f}")

        # ✅ Compute Correct Average Validation Loss
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
       
