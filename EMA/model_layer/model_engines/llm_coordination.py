import asyncio
import torch
import threading
from threading import Event
from transformers import (AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer)
from model_layer.system_prompts import SystemPrompts
from model_layer.model_converstation_history import ConversationMemory
from model_layer.model_tools.file_reader_tool import FileReaderTool

from utilities.logger import get_logger  # Import the logging utility

class LLMCoordiantion:
    def __init__(self, model_name: str, device: str = None, query_chroma_tool=None, converstation_history: ConversationMemory = None):
        """
        Initialize the LLMManager with the specified model and device.
        Automatically selects the best available device if not specified.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.device = device or self._get_device()
        self.logger.info(f"Using device: {self.device}")
        self.stop_event = Event()
        self.query_chroma_tool = query_chroma_tool
        self.file_reader_tool = FileReaderTool();

        if converstation_history:
            self.converstation_history = converstation_history
        else:
            self.converstation_history = ConversationMemory()

        
        
        # ✅ Clear GPU memory before loading model
        #if self.device == "mps":
        #    self.logger.info("🧹 Clearing MPS cache before model initialization...")
        #    torch.mps.empty_cache()
        #elif self.device == "cuda":
        #    self.logger.info("🧹 Clearing CUDA cache before model initialization...")
        #   torch.cuda.empty_cache()

        try:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            self.tokenizer.pad_token = self.tokenizer.eos_token  # ✅ Set EOS as PAD
            self.max_token_length = self.tokenizer.model_max_length
            self.logger.info(f"Tokenizer '{model_name}' loaded with max token length: {self.max_token_length}")

            # ✅ **Chunking & response Settings**
            #self.reserved_tokens = int(self.max_token_length * 0.25)  # Reserve 25% for response
            #self.chunk_size = self.max_token_length - self.reserved_tokens  # 75% for input
            #self.overlap = int(self.max_token_length * 0.10)  # 10% overlap

            practical_max_length = 4096  # Example practical limit
            self.reserved_tokens = int(practical_max_length * 0.25)
            self.chunk_size = practical_max_length - self.reserved_tokens
            self.overlap = int(practical_max_length * 0.10)

            self.logger.info(
                f"Chunking settings → Reserved Tokens: {self.reserved_tokens}, "
                f"Chunk Size: {self.chunk_size}, Overlap: {self.overlap}"
            )

            self.model = AutoModelForCausalLM.from_pretrained(model_name).to(self.device)

            if self.device == "mps":
                self.model = torch.compile(self.model, backend="eager")  # ✅ Forces eager mode
            else:
                self.model = torch.compile(self.model)  # Performance optimization

            self.logger.info(f"Model '{model_name}' loaded successfully on {self.device}!")

        except Exception as e:
            self.logger.error(f"Failed to load model '{model_name}': {e}")
            raise

    @staticmethod
    def _get_device():
        """
        Detect the best available device: CUDA, MPS (for Mac), or CPU.
        """
        if torch.cuda.is_available():
            return "cuda"
        elif torch.backends.mps.is_available():
            return "mps"
        else:
            return "cpu"
    
    def stop_generation(self):
        """Sets the stop flag to cancel ongoing inference."""
        self.stop_event.set()

    def reset_stop_flag(self):
        """Clears the stop flag before starting a new inference."""
        self.stop_event.clear()

    def get_log_probabilities(self, input_text: str):
        """
        Returns log probabilities for the generated text.
        Explicitly moves tensors to the correct device, avoids MPS inductor issues.
        """
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

        inputs = self.tokenizer(input_text, return_tensors="pt").to(device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
        
        # ✅ Ensure logits exist
        logits = outputs.logits if outputs.logits is not None else torch.zeros_like(inputs["input_ids"], dtype=torch.float32).to(device)

        # ✅ Explicitly cast data type for MPS compatibility
        logits = logits.to(torch.float32)

        probs = torch.softmax(logits[:, -1, :], dim=-1)  # ✅ Select last token only
        top_prob, top_token = torch.max(probs, dim=-1)

        return {
            "token": self.tokenizer.decode([top_token.squeeze().item()]),  # ✅ Fix multi-element tensor issue
            "confidence": top_prob.squeeze().item()  # ✅ Fix multi-element tensor issue
        }

    def compute_entropy(self, input_text: str):
        """
        Computes entropy for the generated tokens. Lower entropy = higher confidence.
        Explicitly moves tensors to the correct device.
        """
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

        inputs = self.tokenizer(input_text, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        logits = outputs.logits[:, -1, :].to(device)  # ✅ Ensure only last token is considered
        probs = torch.softmax(logits, dim=-1)
        entropy = -torch.sum(probs * torch.log(probs), dim=-1)  # ✅ Reduce dimension properly

        return entropy.squeeze().item()  # ✅ Fix multi-element tensor issue

    def compute_token_similarity(self, input_text: str, reference_word: str):
        """
        Measures cosine similarity between the generated token and a reference word.
        Explicitly moves tensors to the correct device.
        """
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

        inputs = self.tokenizer(input_text, return_tensors="pt").to(device)
        ref_inputs = self.tokenizer(reference_word, return_tensors="pt").to(device)

        with torch.no_grad():
            output = self.model(**inputs)
            ref_output = self.model(**ref_inputs)

        # ✅ Fix: Use `logits`, since `last_hidden_state` does not exist
        token_embedding = output.logits[:, -1, :].to(device)  
        ref_embedding = ref_output.logits[:, -1, :].to(device)  

        similarity = torch.cosine_similarity(token_embedding, ref_embedding, dim=-1)

        return similarity.squeeze().item()
    #TODO: Start here & updated function to check jsonl file lines
    def execute_with_confidence(self, input_text: str, expected_answer: str, tool_prompt: str = None) -> float:
        """
        Executes the LLM and evaluates confidence using:
        - Log Probabilities
        - Entropy
        - Token Similarity

        Instead of returning a category (High, Medium, Low), it returns a **float score** between **1.0 and 0.01**.

        Higher values = More confident
        Lower values = Less confident
        """
        evaluation_text = f"{tool_prompt}\n{input_text}" if tool_prompt else input_text

        response = self.get_log_probabilities(evaluation_text)
        entropy = self.compute_entropy(evaluation_text)
        similarity = self.compute_token_similarity(evaluation_text, expected_answer)

        log_prob_confidence = response["confidence"]

        self.logger.info(f"📊 Confidence Metrics:\n"
                        f"  - Log Prob Confidence: {log_prob_confidence:.4f}\n"
                        f"  - Entropy: {entropy:.4f}\n"
                        f"  - Token Similarity: {similarity:.4f}")

        # ✅ Normalize confidence score between **1 and 0.01**
        confidence_score = (log_prob_confidence * similarity) / (entropy + 1e-5)  # Prevent division by zero

        # ✅ Ensure confidence stays between 1.0 and 0.01
        confidence_score = max(0.01, min(confidence_score, 1.0))

        self.logger.info(f"🔢 Final Confidence Score: {confidence_score:.4f}")

        return confidence_score

    async def generate_response(self, user_message: str, tool_calls: list = None, use_chroma_tool: bool = False, use_file_tool: bool = True, max_length: int = 1024, temperature: float = 0.01, top_p: float = 0.9, top_k: int = 5):
        """
        Stream tokens from the model in real-time using WebSockets.
        Now includes confidence estimation using:
        1. Log Probabilities
        2. Entropy Calculation
        3. Token Embedding Similarity
        """

        system_prompts = SystemPrompts()

        try:
            # Retrieve ChromaDB context if enabled
            chroma_context = ""
            if use_chroma_tool and self.query_chroma_tool:
                self.logger.info("Calling query_chroma_tool for additional context...")
                tool_output = self.query_chroma_tool._run(user_message)
                if tool_output:
                    chroma_context = f"📌 Retrieved ChromaDB Information:\n{tool_output}"
                    self.logger.debug(f"ChromaDB context: {chroma_context}")

            file_context = ""
            if use_file_tool and self.file_reader_tool:
                self.logger.info("Calling file_read_tool for additional context...")

                # ✅ Pass `execute_with_confidence` dynamically into `_run()`
                self.file_reader_tool._run(execute_with_confidence=self.execute_with_confidence, query=user_message)

                # ✅ Directly retrieve high-confidence records (already filtered in `_run()`)
                tool_output = self.file_reader_tool.get_high_confidence_records()

                if tool_output:
                    file_context = f"📌 Retrieved file Information:\n{tool_output}"
                    self.logger.debug(f"File Reader context: {file_context}")




            messages = [
                {"role": "system", "content": system_prompts.get_system_prompt_by_role("coordination_agent_3")}
            ] + self.converstation_history.get_history() + [{"role": "user", "content": user_message}]

            self.converstation_history.add_message({"role": "user", "content": user_message})
                
            if tool_calls:
                for tool in tool_calls:
                    self.converstation_history.add_message({"role": "system", "content": tool})
                    messages.append({"role": "system", "content": tool})
                    self.logger.debug(f"Tool call added: {tool}")

            if chroma_context:
                self.converstation_history.add_message({"role": "system", "content": chroma_context})
                messages.append({"role": "system", "content": chroma_context})

            # Format messages using tokenizer
            formatted_prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            self.logger.info(f"Processing user messages: {formatted_prompt}")

            # Tokenize input
            inputs = self.tokenizer(
                formatted_prompt,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=self.tokenizer.model_max_length,
                return_attention_mask=True
            ).to(self.device)

            self.logger.info(f"🔢 Tokenized Prompt Size: {inputs['input_ids'].shape[1]} tokens")

            # ✅ Use `TextIteratorStreamer` for proper token streaming
            streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=True, skip_special_tokens=True)

            # ✅ Start generation in a separate thread
            generation_thread = threading.Thread(
                target=self.model.generate,
                kwargs={
                    "input_ids": inputs["input_ids"],
                    "attention_mask": inputs["attention_mask"],
                    "do_sample": True,
                    "temperature": temperature,
                    "top_p": top_p,
                    "top_k": top_k,
                    "repetition_penalty": 1.3,
                    "max_new_tokens": min(512, self.reserved_tokens),
                    "pad_token_id": self.tokenizer.pad_token_id,
                    "eos_token_id": self.tokenizer.eos_token_id,
                    "streamer": streamer
                },
            )
            generation_thread.start()

            # ✅ Capture generated response
            generated_response = ""
            first_token = False
            for token in streamer:
                if not first_token:
                    first_token = True  
                
                if "<|eot_id|>" in token:
                    self.logger.info("🛑 Stopping token detected. Ending stream.")
                    break

                generated_response += token
                yield token  
                await asyncio.sleep(0)  

            if not first_token:
                self.logger.error("❌ No tokens received. Possible issue with model output.")

            # ✅ Ensure thread completes
            generation_thread.join()

            if torch.cuda.is_available() or torch.backends.mps.is_available():
                # ✅ Move tensors to the appropriate device (CUDA, MPS or CPU)
                device = device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

                self.logger.info(f"🔍 Running confidence evaluation on {device.upper()}...")

                # ✅ Confidence Evaluation (Log Probabilities, Entropy, Similarity)
                if generated_response.strip():
                    log_probs = self.get_log_probabilities(generated_response)
                    entropy = self.compute_entropy(generated_response)
                    similarity = self.compute_token_similarity(generated_response, user_message)

                    self.logger.info(f"📊 Confidence Metrics:\n"
                                    f"  - Log Prob Confidence: {log_probs['confidence']:.4f}\n"
                                    f"  - Entropy: {entropy:.4f}\n"
                                    f"  - Token Similarity: {similarity:.4f}")

                    # ✅ Decision-making based on confidence scores
                    if log_probs["confidence"] > 0.9 and entropy < 1.0 and similarity > 0.9:
                        self.logger.info("✅ High confidence - Accepting response.")
                    elif 0.7 <= log_probs["confidence"] <= 0.9 or 1.0 <= entropy <= 2.5 or 0.7 <= similarity <= 0.9:
                        self.logger.info("⚠️ Medium confidence - Running validation (RAG/Tool).")
                    else:
                        self.logger.info("❌ Low confidence - Response might need correction.")

            # Add the models response to history
            if generated_response.strip():
                self.converstation_history.add_message({"role": "assistant", "content": generated_response})

        except Exception as e:
            self.logger.error(f"Error generating response: {e}")
            raise