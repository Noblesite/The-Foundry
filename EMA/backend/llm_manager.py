import asyncio
import torch
import threading
from threading import Event
from transformers import (AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer)

from utilities.logger import get_logger  # Import the logging utility

class LLMManager:
    def __init__(self, model_name: str, device: str = None, query_chroma_tool=None, use_chunking=False):
        """
        Initialize the LLMManager with the specified model and device.
        Automatically selects the best available device if not specified.
        """
        self.logger = get_logger(self.__class__.__name__)
        self.device = device or self._get_device()
        self.logger.info(f"Using device: {self.device}")
        self.stop_event = Event()
        self.query_chroma_tool = query_chroma_tool
        self.use_chunking = use_chunking  # ✅ Boolean flag for chunking

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

    def _chunk_text(self, tokenized_input):
        """
        Splits a tokenized input into overlapping chunks dynamically while ensuring
        it does not exceed model_max_length.
        If input is small enough to fit within a single chunk, it is returned as-is.
        """
        input_ids = tokenized_input["input_ids"].squeeze(0)  # Remove batch dim
        attention_mask = tokenized_input["attention_mask"].squeeze(0)  # Extract attention mask

        # ✅ **Skip chunking if input is smaller than chunk_size**
        if len(input_ids) <= self.chunk_size:
            return [input_ids], [attention_mask]  # Return as a single chunk

        chunks, masks = [], []
        start = 0

        while start < len(input_ids):
            end = min(start + self.chunk_size, len(input_ids))
            chunks.append(input_ids[start:end])
            masks.append(attention_mask[start:end])  # Ensure attention mask is chunked correctly
            start += self.chunk_size - self.overlap  # Sliding window overlap

        return chunks, masks  # ✅ Return attention masks along with chunks

    def get_system_prompt(self) -> str:
        """
        Generates a standardized system prompt for the Workspace ONE AI assistant.
        """
        system_prompt = (
            "You are Workspace ONE AI Assistant, an expert in VMware Workspace ONE UEM. "
            "Your responses must be **concise, factual, and directly answer the user’s question.** "
            "Do not add unnecessary context, speculate, or over-explain. "
            "Use **Markdown formatting** when applicable. "
            "If you do not know the answer, respond with: "
            "'I am unable to determine the answer based on the provided information.'"
        )
        return system_prompt

    async def generate_response(self, user_message: str, assistant_message: str = None, tool_calls: list = None, rag_response: str = None, use_chroma_tool: bool = True, max_length: int = 1024, temperature: float = 0.05, top_p: float = 0.9):
        """
        Stream tokens from the model in real-time using WebSockets.
        """
        try:
              # Retrieve ChromaDB context if enabled
            chroma_context = ""
            if use_chroma_tool and self.query_chroma_tool:
                self.logger.info("Calling query_chroma_tool for additional context...")
                tool_output = self.query_chroma_tool._run(user_message)
                chroma_context = f"📌 Retrieved ChromaDB Information:\n{tool_output}"
                self.logger.debug(f"ChromaDB context: {chroma_context}")

            # Construct messages with system, user, assistant, and tool input
            messages = [
                {"role": "system", "content": self.get_system_prompt()},
                {"role": "user", "content": user_message}
            ]

            # Include assistant response if provided
            if assistant_message:
                messages.append({"role": "assistant", "content": assistant_message})

            # Include tool calls if provided
            if tool_calls:
                for tool in tool_calls:
                    messages.append({"role": "tool", "content": tool})
                    self.logger.debug(f"Tool call added to messages: {tool}")

             # ✅ Integrate RAG response as a tool response
            if rag_response:
                messages.append({"role": "tool", "content": rag_response})
                self.logger.debug(f"RAG response added to messages: {rag_response}")

            if chroma_context:
                messages.append({"role": "system", "content": chroma_context})

            # ✅ Ensure the assistant role is always defined to prevent hallucinations
            messages.append({"role": "assistant", "content": ""})

            # ✅ Format messages using the chat template
            formatted_prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            formatted_prompt = formatted_prompt.replace("<think>", "").replace("<｜think｜>", "")
            self.logger.info(f"Processing user messages: {formatted_prompt}")

            # ✅ Tokenize the input properly
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
            streamer = TextIteratorStreamer(self.tokenizer, skip_prompt=True, skip_special_tokens=False)

            # ✅ Use a separate thread to generate tokens asynchronously
            generation_thread = threading.Thread(
                target=self.model.generate,
                kwargs={
                    "input_ids": inputs["input_ids"],
                    "attention_mask": inputs["attention_mask"],
                    "do_sample": True,
                    "temperature": temperature,
                    "top_p": top_p,
                    "repetition_penalty": 1.3,  # Prevent repetition loops
                    "max_new_tokens": min(512, self.reserved_tokens),  # Limit response length
                    "pad_token_id": self.tokenizer.pad_token_id,  # Ensure proper padding
                    "eos_token_id": self.tokenizer.eos_token_id,  # Ensure stopping condition
                    "streamer": streamer
                },
            )
            generation_thread.start()

            # ✅ Stream tokens as they arrive
            first_token = False
            for token in streamer:
                if not first_token:
                    first_token = True  # Mark that we received at least one token
                
                if "<|end▁of▁sentence|>" in token:  # Stop only when EOS token appears
                    self.logger.info("🛑 Stopping token detected. Ending stream.")
                    break
                
                yield token  # Stream the token to WebSocket
                await asyncio.sleep(0)  # Allow the event loop to continue

            if not first_token:
                self.logger.error("❌ No tokens received from model. Possible issue with prompt or model output.")

            # ✅ Ensure the generation thread completes
            generation_thread.join()

        except Exception as e:
            self.logger.error(f"Error generating response: {e}")
            raise

    async def generate_response_chunkingh(self, user_message: str, assistant_message: str = None, rag_response: str = None,
                                tool_calls: list = None, use_chroma_tool: bool = True, temperature: float = 0.05,
                                top_p: float = 0.9):
        """
        Dynamically chunks the prompt and generates responses in a streaming fashion.
        """
        try:
            # Retrieve ChromaDB context if enabled
            chroma_context = ""
            if use_chroma_tool and self.query_chroma_tool:
                self.logger.info("Calling query_chroma_tool for additional context...")
                tool_output = self.query_chroma_tool._run(user_message)
                chroma_context = f"📌 Retrieved ChromaDB Information:\n{tool_output}"
                self.logger.debug(f"ChromaDB context: {chroma_context}")

            # Construct messages list
            messages = [
                {"role": "system", "content": self.get_system_prompt()},
                {"role": "user", "content": user_message},
            ]

            if assistant_message:
                messages.append({"role": "assistant", "content": assistant_message})

            if tool_calls:
                for tool in tool_calls:
                    messages.append({"role": "tool", "content": tool})
                    self.logger.debug(f"Tool call added: {tool}")

            if rag_response:
                messages.append({"role": "system", "content": f"📌 Relevant Information:\n{rag_response}"})

            if chroma_context:
                messages.append({"role": "system", "content": chroma_context})

            messages.append({"role": "assistant", "content": ""})  # Ensure assistant response starts cleanly

            # Format and tokenize the prompt
            formatted_prompt = self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )

            tokenized_input = self.tokenizer(
                formatted_prompt,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=self.max_token_length,
                return_attention_mask=True,
            ).to(self.device)

            # **Chunking Strategy**
            chunks = self._chunk_text(tokenized_input)

            # Stream tokens as they are generated for each chunk
            for chunk in chunks:
                self.logger.info(f"Processing chunk with {len(chunk)} tokens")

                inputs = {"input_ids": chunk.unsqueeze(0)}  # Re-add batch dimension

                streamer = TextIteratorStreamer(
                    self.tokenizer, skip_prompt=True, skip_special_tokens=False
                )

                generation_thread = threading.Thread(
                    target=self.model.generate,
                    kwargs={
                        "input_ids": inputs["input_ids"],
                        "do_sample": True,
                        "temperature": temperature,
                        "top_p": top_p,
                        "repetition_penalty": 1.3,
                        "max_new_tokens": self.reserved_tokens,  # Dynamically set response space
                        "pad_token_id": self.tokenizer.pad_token_id,
                        "eos_token_id": self.tokenizer.eos_token_id,
                        "streamer": streamer,
                    },
                )
                generation_thread.start()

                first_token = False
                for token in streamer:
                    if not first_token:
                        first_token = True
                    if "<|end▁of▁sentence|>" in token:
                        self.logger.info("End-of-sentence token detected. Ending stream.")
                        break
                    yield token
                    await asyncio.sleep(0)

                if not first_token:
                    self.logger.error("No tokens received from model.")

                generation_thread.join()

        except Exception as e:
            self.logger.error(f"Error during response generation: {e}")
            raise