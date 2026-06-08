import asyncio
import torch
import threading
from threading import Event
from transformers import (AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer)
import torch._dynamo

from utilities.logger import get_logger  # Import the logging utility

class LLMManager:
    def __init__(self, model_name: str, device: str = None, query_chroma_tool=None):
        """
        Initialize the LLMManager with the specified model and device.
        Automatically selects the best available device if not specified.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.device = device or self._get_device()
        self.logger.info(f"Using device: {self.device}")
        self.stop_event = Event()
        self.query_chroma_tool = query_chroma_tool

        # ✅ Clear GPU memory before loading model
        #if self.device == "mps":
        #    self.logger.info("🧹 Clearing MPS cache before model initialization...")
        #    torch.mps.empty_cache()
        #elif self.device == "cuda":
        #    self.logger.info("🧹 Clearing CUDA cache before model initialization...")
        #   torch.cuda.empty_cache()

        try:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            self.max_token_length = self.tokenizer.model_max_length
            self.logger.info(f"Tokenizer '{model_name}' loaded with max token length: {self.max_token_length}")

            # ✅ **Chunking Settings**
            self.reserved_tokens = int(self.max_token_length * 0.25)  # Reserve 25% for response
            self.chunk_size = self.max_token_length - self.reserved_tokens  # 75% for input
            self.overlap = int(self.max_token_length * 0.10)  # 10% overlap

            self.logger.info(
                f"Chunking settings → Reserved Tokens: {self.reserved_tokens}, "
                f"Chunk Size: {self.chunk_size}, Overlap: {self.overlap}"
            )

            self.model = AutoModelForCausalLM.from_pretrained(model_name).to(self.device)
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
        """
        inputs = self.tokenizer(input_text, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        logits = outputs.logits[:, -1, :]
        probs = torch.softmax(logits, dim=-1)
        top_prob, top_token = torch.max(probs, dim=-1)
        return {"token": self.tokenizer.decode([top_token.item()]), "confidence": top_prob.item()}

    def compute_entropy(self, input_text: str):
        """
        Computes entropy for the generated tokens. Lower entropy = higher confidence.
        """
        inputs = self.tokenizer(input_text, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        logits = outputs.logits[:, -1, :]
        probs = torch.softmax(logits, dim=-1)
        entropy = -torch.sum(probs * torch.log(probs))
        return entropy.item()

    def compute_token_similarity(self, input_text: str, reference_word: str):
        """
        Measures cosine similarity between the generated token and a reference word.
        """
        inputs = self.tokenizer(input_text, return_tensors="pt").to(self.device)
        ref_inputs = self.tokenizer(reference_word, return_tensors="pt").to(self.device)

        with torch.no_grad():
            output = self.model(**inputs)
            ref_output = self.model(**ref_inputs)

        token_embedding = output.last_hidden_state[:, -1, :]
        ref_embedding = ref_output.last_hidden_state[:, -1, :]

        return F.cosine_similarity(token_embedding, ref_embedding).item()

    def execute_with_confidence(self, input_text: str, expected_answer: str):
        """
        Executes the LLM and evaluates confidence using log probabilities, entropy, and similarity.
        Based on confidence, the response is returned, validated, or rejected.
        """
        response = self.get_log_probabilities(input_text)
        entropy = self.compute_entropy(input_text)
        similarity = self.compute_token_similarity(input_text, expected_answer)

        log_prob_confidence = response["confidence"]

        print(f"Log Prob Confidence: {log_prob_confidence:.4f}")
        print(f"Entropy: {entropy:.4f}")
        print(f"Token Similarity to '{expected_answer}': {similarity:.4f}")

        # Decision Making
        if log_prob_confidence > 0.9 and entropy < 1.0 and similarity > 0.9:
            print("✅ High confidence - Accepting response.")
            return response["token"]
        elif 0.7 <= log_prob_confidence <= 0.9 or 1.0 <= entropy <= 2.5 or 0.7 <= similarity <= 0.9:
            print("⚠️ Medium confidence - Running validation (RAG/Tool).")
            return "Validating response with additional tools..."
        else:
            print("❌ Low confidence - Rejecting and re-evaluating.")
            return "Re-evaluating response..."


    def get_system_prompt(self) -> str:
        """
        Generates a standardized system prompt for the Workspace ONE AI assistant.
        """
        system_prompt = (
            "You are Workspace ONE AI Assistant, an expert in Workspace ONE UEM. "
            "Your responses must be **concise, factual, and directly answer the user’s question.** "
            "Use **Markdown formatting** when applicable. "
            "If you need more context, ask the following question and it will be provided. Question: "
            "'Would you like me to search my Dataset to find the answer?'"
        )
        return system_prompt

    async def generate_response(self, user_message: str, assistant_message: str = None, tool_calls: list = None, rag_response: str = None, use_chroma_tool: bool = True, max_length: int = 1024, temperature: float = 0.01, top_p: float = 0.9):
        """
        Stream tokens from the model in real-time using WebSockets.
        Now includes confidence estimation using:
        1. Log Probabilities
        2. Entropy Calculation
        3. Token Embedding Similarity
        """
        torch._dynamo.config.suppress_errors = True

        try:
            # Retrieve ChromaDB context if enabled
            chroma_context = ""
            if use_chroma_tool and self.query_chroma_tool:
                self.logger.info("Calling query_chroma_tool for additional context...")
                tool_output = self.query_chroma_tool._run(user_message)
                if tool_output:
                    chroma_context = f"📌 Retrieved ChromaDB Information:\n{tool_output}"
                    self.logger.debug(f"ChromaDB context: {chroma_context}")

            # Construct messages
            messages = [
                {"role": "system", "content": self.get_system_prompt()},
                {"role": "user", "content": user_message}
            ]

            if assistant_message:
                messages.append({"role": "assistant", "content": assistant_message})

            if tool_calls:
                for tool in tool_calls:
                    messages.append({"role": "tool", "content": tool})
                    self.logger.debug(f"Tool call added: {tool}")

            if rag_response:
                messages.append({"role": "tool", "content": rag_response})
                self.logger.debug(f"RAG response added: {rag_response}")

            if chroma_context:
                messages.append({"role": "system", "content": chroma_context})

            messages.append({"role": "assistant", "content": ""})  # Ensure assistant role exists

            # Format messages using tokenizer
            formatted_prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
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
            streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=False, skip_special_tokens=False)

            # ✅ Start generation in a separate thread
            generation_thread = threading.Thread(
                target=self.model.generate,
                kwargs={
                    "input_ids": inputs["input_ids"],
                    "attention_mask": inputs["attention_mask"],
                    "do_sample": True,
                    "temperature": temperature,
                    "top_p": top_p,
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
                
                if "<|end▁of▁sentence|>" in token:
                    self.logger.info("🛑 Stopping token detected. Ending stream.")
                    break

                generated_response += token
                yield token  
                await asyncio.sleep(0)  

            if not first_token:
                self.logger.error("❌ No tokens received. Possible issue with model output.")

            # ✅ Ensure thread completes
            generation_thread.join()

            if torch.cuda.is_available():
            # ✅ Confidence Evaluation (Log Probabilities, Entropy, Similarity)
                if generated_response.strip():
                    log_probs = self.get_log_probabilities(generated_response)
                    entropy = self.compute_entropy(generated_response)
                    similarity = self.compute_token_similarity(generated_response, user_message)  # Compare with user input

                    self.logger.info(f"📊 Confidence Metrics:\n"
                                    f"  - Log Prob Confidence: {log_probs['confidence']:.4f}\n"
                                    f"  - Entropy: {entropy:.4f}\n"
                                    f"  - Token Similarity: {similarity:.4f}")

                    # Decision-making based on confidence scores
                    if log_probs["confidence"] > 0.9 and entropy < 1.0 and similarity > 0.9:
                        self.logger.info("✅ High confidence - Accepting response.")
                    elif 0.7 <= log_probs["confidence"] <= 0.9 or 1.0 <= entropy <= 2.5 or 0.7 <= similarity <= 0.9:
                        self.logger.info("⚠️ Medium confidence - Running validation (RAG/Tool).")
                    else:
                        self.logger.info("❌ Low confidence - Response might need correction.")

        except Exception as e:
            self.logger.error(f"Error generating response: {e}")
            raise