import json
import os
from transformers import AutoTokenizer
from utilities.path_manager import PathManager
from tqdm import tqdm  # For progress logging

class DatasetPreprocessor:
    def __init__(self, model_name: str, dataset_path: str, max_tokens: int = 1024, overlap_ratio: float = 0.30):
        """
        Initialize the preprocessor with the specified model, dataset file path (JSONL), maximum tokens per chunk,
        and overlap ratio between chunks.
        """
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.dataset = dataset_path  # This is the path to a JSONL file.
        self.max_tokens = max_tokens
        self.overlap = int(max_tokens * overlap_ratio)

    def load_records(self) -> list:
        """
        Loads records from a JSONL file.
        
        Returns:
            List[str]: A list of text records.
        """
        records = []
        if not os.path.exists(self.dataset):
            raise FileNotFoundError(f"Dataset file not found: {self.dataset}")
        with open(self.dataset, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    # If the JSON object has a "text" field, use it; otherwise assume data is directly the text.
                    if isinstance(data, dict) and "text" in data:
                        record = data["text"]
                    else:
                        record = data
                    records.append(record)
                except json.JSONDecodeError:
                    # If line is not valid JSON, treat it as a raw text string.
                    records.append(line)
        return records

    def chunk_text(self, text: str) -> list:
        """
        Standard chunking: Tokenizes the text, chunks it into segments of length `max_tokens`
        with the specified overlap, then decodes each chunk back to text.
        
        Args:
            text (str): The text to be chunked.
        
        Returns:
            List[str]: A list of text chunks.
        """
        # Ensure text is a string
        if not isinstance(text, str):
            text = str(text)
        token_ids = self.tokenizer.encode(text, add_special_tokens=False)
        chunks = []
        start = 0
        while start < len(token_ids):
            end = start + self.max_tokens
            chunk_ids = token_ids[start:end]
            chunk_text = self.tokenizer.decode(chunk_ids, skip_special_tokens=True)
            chunks.append(chunk_text)
            start += self.max_tokens - self.overlap
        return chunks

    def chunk_text_rounded(self, text: str) -> list:
        """
        Adaptive chunking with rounding: Tokenizes the text and splits it into chunks that
        are exactly `max_tokens` long. If a chunk is shorter than `max_tokens`, it is padded;
        if it's longer, it is truncated. This yields uniform input lengths for training.
        
        Args:
            text (str): The text to be chunked.
        
        Returns:
            List[str]: A list of text chunks, each exactly `max_tokens` tokens long.
        """
        # Ensure text is a string
        if not isinstance(text, str):
            text = str(text)
        token_ids = self.tokenizer.encode(text, add_special_tokens=False)
        chunks = []
        start = 0
        pad_token_id = self.tokenizer.pad_token_id if self.tokenizer.pad_token_id is not None else 0

        while start < len(token_ids):
            end = start + self.max_tokens
            chunk_ids = token_ids[start:end]
            # If the chunk is shorter than max_tokens, pad it
            if len(chunk_ids) < self.max_tokens:
                pad_length = self.max_tokens - len(chunk_ids)
                chunk_ids.extend([pad_token_id] * pad_length)
            # Decode the chunk back to text
            chunk_text = self.tokenizer.decode(chunk_ids, skip_special_tokens=False)
            chunks.append(chunk_text)
            start += self.max_tokens - self.overlap
        return chunks

    def process_records(self, records: list, use_rounded: bool = False, max_chunks_per_record: int = None) -> list:
        """
        Processes a list of records by chunking each record using either the standard or 
        rounded (adaptive) chunking method, and attaches metadata.

        Args:
            records (List[str]): List of text records.
            use_rounded (bool): If True, use chunk_text_rounded for fixed-length chunks.
            max_chunks_per_record (int): Optional cap on number of chunks per record.

        Returns:
            List[dict]: List of processed chunks with metadata.
        """
        processed_chunks = []
        for idx, record in enumerate(records):
            if use_rounded:
                chunks = self.chunk_text_rounded(record)
            else:
                chunks = self.chunk_text(record)
            if max_chunks_per_record:
                chunks = chunks[:max_chunks_per_record]
            for chunk_idx, chunk in enumerate(chunks):
                token_length = len(self.tokenizer.encode(chunk, add_special_tokens=False))
                processed_chunks.append({
                    "record_id": idx,
                    "chunk_index": chunk_idx,
                    "chunk_text": chunk,
                    "source": os.path.basename(self.dataset),
                    "token_length": token_length
                })
        return processed_chunks

    def save_processed_chunks(self, processed_chunks: list, file_path: str):
        """
        Saves the processed chunks to a JSONL file, where each line is a JSON object.
        
        Args:
            processed_chunks (List[dict]): List of processed chunk data.
            file_path (str): Path to the output file.
        """
        with open(file_path, "a", encoding="utf-8") as f:
            for chunk in processed_chunks:
                f.write(json.dumps(chunk) + "\n")


if __name__ == "__main__":
    # Example usage:
    # Assume 'input_data.jsonl' is a JSONL file where each line is a JSON object with a "text" key.
    path_manager = PathManager()
    dataset_file = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_full_filitered_dataset.jsonl"
    dataset_file_pre_processed = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_filitered_btlm-3b-8k-base.jsonl"
    
    preprocessor = DatasetPreprocessor(
        model_name="cerebras/btlm-3b-8k-base",
        dataset_path=dataset_file,
        max_tokens=1024,
        overlap_ratio=0.30
    )
    
    records = preprocessor.load_records()
    batch_size = 100  # Number of records to process in each batch
    
    # Clear output file if it exists
    if os.path.exists(dataset_file_pre_processed):
        os.remove(dataset_file_pre_processed)
    
    # Process records in batches and log progress using tqdm
    for i in tqdm(range(0, len(records), batch_size), desc="Processing batches"):
        batch_records = records[i:i + batch_size]
        processed_chunks = preprocessor.process_records(batch_records, use_rounded=False)
        preprocessor.save_processed_chunks(processed_chunks, dataset_file_pre_processed)