import os
import json
import random
import pickle
import multiprocessing
import pandas as pd
import torch
import re
import sys  # Added for sys.exit
from pathlib import Path
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, AutoConfig
from utilities.logger import get_logger
from utilities.path_manager import PathManager

logger = get_logger(__name__)

# === Global model variables (to prevent reloading) ===
model = None
tokenizer = None

# === Load Dataset from Pickle File ===
def load_pickle_as_dataset(file_path):
    """Load dataset from a pickle file."""
    if not os.path.exists(file_path):
        logger.error("File %s does not exist.", file_path)
        return None

    with open(file_path, 'rb') as f:
        data = pickle.load(f)
        df = pd.DataFrame(data)  # Ensure it's a DataFrame
        logger.info("Loaded dataset with %d records from %s.", len(df), file_path)

    return df if not df.empty else None

# === Initialize Model in Each Worker ===
def init_worker_model(model_name):
    """Load model and tokenizer once per worker process using 4-bit quantization and optimizations."""
    global model, tokenizer
    if model is None or tokenizer is None:
        logger.info("Initializing model on process %d...", os.getpid())

        # Enable Flash Attention 2
        config = AutoConfig.from_pretrained(model_name)
        config.use_flash_attention_2 = True  # Faster self-attention

        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,  
            bnb_4bit_compute_dtype="float16",  # Adjust precision
            bnb_4bit_use_double_quant=True,      # Enables double quantization for efficiency
            bnb_4bit_quant_type="nf4"            # Use NF4 for better precision
        )

        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            config=config,
            quantization_config=quantization_config,
            device_map="auto"
        )

        tokenizer = AutoTokenizer.from_pretrained(model_name)

        # Compile the model for performance boost (requires PyTorch 2.0+)
        model = torch.compile(model)

        max_tokens = tokenizer.model_max_length
        logger.info("Model initialized with max tokens: %d.", max_tokens)

# === Utility Functions ===
def clean_answer(question, answer):
    """Removes unnecessary repetition of the question in the answer."""
    if answer.lower().startswith(question.lower()):
        return answer[len(question):].strip()
    return answer

def sanitize_output(answer):
    """Removes hallucinated tags like </think> and other unnecessary artifacts."""
    return re.sub(r"</?think>", "", answer).strip()

def extract_qa_pairs(raw_output):
    """
    Extracts QA pairs from model-generated output using regex.
    
    Expected output format:
    
    **Q:** [Your question]  
    **A:** [Your answer]
    
    Each pair is separated by a blank line or end-of-string.
    
    Args:
        raw_output (str): The full raw text output from the model.
    
    Returns:
        list: A list of dictionaries containing 'question' and 'answer' keys.
    """
    qa_pairs = []
    # Regex pattern:
    #   Matches "**Q:**" followed by the question (non-greedy),
    #   then "**A:**" followed by the answer (non-greedy),
    #   until a blank line or the end of the string.
    pattern = r"\*\*Q:\*\*\s*(.+?)\s*\*\*A:\*\*\s*(.+?)(?=\n\s*\n|$)"
    matches = re.findall(pattern, raw_output, re.DOTALL)
    
    for question, answer in matches:
        qa_pairs.append({
            "question": question.strip(),
            "answer": answer.strip()
        })

    if not qa_pairs:
        logger.warning("⚠️ No QA pairs extracted. Check output formatting.")
    
    return qa_pairs

def clean_qa_pairs(qa_pairs):
    """
    Removes placeholder QA pairs before writing to a JSONL file.
    
    Args:
        qa_pairs (list): List of QA dictionaries.
        
    Returns:
        list: QA pairs without placeholders.
    """
    return [entry for entry in qa_pairs if not entry.get("question", "").startswith("[Your question]")]

# === Worker Process for QA Generation ===
def generate_qa_for_batch(batch, output_file):
    """
    Generates QA pairs for a batch using structured prompting.
    """
    global model, tokenizer
    if model is None or tokenizer is None:
        raise RuntimeError("Model is not initialized! Ensure init_worker_model() is used.")

    device = next(model.parameters()).device
    temperature = random.uniform(0.3, 0.5)  # Controlled randomness

    batch_qa_pairs = []

    for _, record in batch.iterrows():
        record = record.to_dict()
        try:
            # Updated structured prompt
            prompt = f"""
<|/think|>
Using the following API details, generate exactly 5 Q&A pairs in this format:

**Q:** [Your question]  
**A:** [Your answer]

Only output the Q&A pairs. Do not include any other text.

API Name: {record['api_name']}
Category: {record.get('api_category', 'N/A')}
Description: {record.get('description', 'N/A')}
Functionality: {record.get('functionality', 'N/A')}
HTTP Method: {record.get('method', 'N/A')}
URL: {record.get('url', 'N/A')}
Headers: {json.dumps(record.get('headers', []))}
Request Body: {record.get('request_body', 'No request body provided')}
Response Codes: {json.dumps(record.get('responses', []))}
<|/think|>
"""

            # Tokenize with padding, truncation, and explicit attention mask
            inputs = tokenizer(
                prompt, return_tensors="pt", padding=True, truncation=True, max_length=4096
            )
            inputs = {key: value.to(device) for key, value in inputs.items()}

            # Generate output using inference mode for efficiency
            with torch.inference_mode():
                output_ids = model.generate(
                    inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    max_new_tokens=1024,  # Set to 1024 for longer responses
                    do_sample=True,
                    temperature=temperature,
                    pad_token_id=tokenizer.eos_token_id
                )

            raw_output = tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()
            logger.debug(f"Raw output for API {record['api_name']}: {raw_output}")

            # Extract structured QA pairs using the improved regex extraction function
            qa_pairs = extract_qa_pairs(raw_output)

            if not qa_pairs:
                logger.warning(f"No valid QA pairs extracted for API: {record['api_name']}")

            # Clean up QA pairs before writing
            cleaned_qa_pairs = clean_qa_pairs(qa_pairs)
            for pair in cleaned_qa_pairs:
                pair["metadata"] = record  # Attach API metadata

            batch_qa_pairs.extend(cleaned_qa_pairs)

        except Exception as e:
            logger.error(f"Error processing record: {record} - {e}")

    # Write results to file
    if batch_qa_pairs:
        with open(output_file, 'a') as f:
            for qa_pair in batch_qa_pairs:
                f.write(json.dumps(qa_pair) + "\n")

    logger.info("✅ Process %d completed batch with temperature %.2f.", os.getpid(), temperature)
    return batch_qa_pairs

# === Parallel Processing Controller ===
def distribute_work_parallel(dataset, model_name, output_file, num_workers=5):
    """
    Distributes QA generation workload across multiple processes.
    """
    logger.info("Initializing %d processes for parallel QA generation...", num_workers)

    batch_size = 4  # Optimize based on GPU capacity
    batches = [dataset.iloc[i:i + batch_size] for i in range(0, len(dataset), batch_size)]
    logger.info("Created %d batches for processing.", len(batches))

    with multiprocessing.Pool(processes=num_workers, initializer=init_worker_model, initargs=(model_name,)) as pool:
        pool.starmap(generate_qa_for_batch, [(batch, output_file) for batch in batches])

    logger.info("✅ All processes completed.")

# === Main Workflow ===
if __name__ == "__main__":
    path_manager = PathManager()
    INPUT_PICKLE = path_manager.get_path("OMNISSA_API_DATASET")
    OUTPUT_FILE = path_manager.get_path("GENERATED_QA_PATH")
    MODEL_NAME = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"
    NUM_WORKERS = 1

    try:
        # Continually run until user sends Ctrl+C
        while True:
            dataset = load_pickle_as_dataset(INPUT_PICKLE)
            if dataset is None:
                logger.error("Dataset could not be loaded. Exiting.")
                break

            distribute_work_parallel(dataset, MODEL_NAME, OUTPUT_FILE, num_workers=NUM_WORKERS)
    except KeyboardInterrupt:
        logger.info("User interrupted the process with Ctrl+C. Exiting gracefully.")
        sys.exit(0)