from transformers import AutoModelForSequenceClassification, AutoTokenizer
from utilities.logger import get_logger
import torch
import torch.nn.functional as F

class ZeroShotEngine:
    def __init__(self, model: str, gpu_id: int = None):
        """Initialize the Zero-Shot classification engine with an assigned GPU."""
        
        self.logger = get_logger("ZeroShotEngine")

        if torch.cuda.is_available():
            self.device_type = f"cuda:{gpu_id}" if gpu_id is not None else "cuda:0"
        elif torch.backends.mps.is_available():
            self.device_type = "mps"
        else:
            self.device_type = "cpu"

        self.logger.debug(f"🔌 Model loading on device Type: {self.device_type}")

        # ✅ Load model and tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(model)
        self.model = AutoModelForSequenceClassification.from_pretrained(model).to(self.device_type)
        self.model.eval()  # Set to eval mode for inference
        
        # Tokenization settings
        self.max_tokens = 512
        self.overlap_ratio = 0.75  # 75% overlap

    def _split_into_chunks(self, text):
        """Splits long text into overlapping chunks of max_tokens."""
        tokens = self.tokenizer.encode(text, truncation=False, add_special_tokens=False)
        
        chunk_size = self.max_tokens
        stride = int(chunk_size * self.overlap_ratio)  # 75% overlap
        chunks = []

        for i in range(0, len(tokens), stride):
            chunk = tokens[i:i + chunk_size]
            if len(chunk) < 30:  # Avoid tiny fragments
                break
            chunks.append(self.tokenizer.decode(chunk))

        return chunks

    def classify(self, premise: str, hypothesis: str):
        """Classifies if a given QA pair is useful based on zero-shot inference with context chunking."""
        
        if len(self.tokenizer.encode(premise)) > self.max_tokens:
            chunks = self._split_into_chunks(premise)
        else:
            chunks = [premise]

        max_confidence = 0
        best_label = "neutral"  # Default fallback

        for chunk in chunks:
            inputs = self.tokenizer(chunk, hypothesis, return_tensors="pt", truncation=True, padding=True, max_length=512).to(self.device_type)
            
            with torch.no_grad():
                outputs = self.model(**inputs)

            probs = F.softmax(outputs.logits, dim=-1).cpu().numpy()[0]

            label_map = {0: "contradiction", 1: "neutral", 2: "entailment"}
            confidence = probs[2]  # Entailment confidence (usefulness)
            label = label_map[probs.argmax()]

            if confidence > max_confidence:
                max_confidence = confidence
                best_label = label

        return max_confidence, best_label