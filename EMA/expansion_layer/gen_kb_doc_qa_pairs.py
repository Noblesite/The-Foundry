import json
import os
import random
import time
import torch
import torch.multiprocessing as mp
import threading
from transformers import AutoModelForCausalLM, AutoTokenizer, AutoConfig, BitsAndBytesConfig
from utilities.logger import get_logger
from utilities.path_manager import PathManager

logger = get_logger(__name__)
path_manager = PathManager()

# Configuration variables
BATCH_SIZE = 60         # Number of records to process in one batch
SLEEP_INTERVAL = 10     # Seconds to wait after one full iteration over the seed data
WORKERS_PER_GPU = 1     # Number of worker processes to run per GPU

# Define a global lock for file writing within a process.
file_write_lock = threading.Lock()

def init_worker_model(model_dir, gpu_id):
    """
    Initialize the model and tokenizer on a specified GPU.
    """
    # Set the current CUDA device so that the model loads on that GPU.
    torch.cuda.set_device(gpu_id)
    logger.info("Initializing model from '%s' on GPU %d (Process %d)...", model_dir, gpu_id, os.getpid())
    try:
        config = AutoConfig.from_pretrained(model_dir, local_files_only=True)
        config.use_flash_attention_2 = True
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype="float16",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4"
        )
        # Force the model to load on the specified GPU by using a custom device_map.
        model = AutoModelForCausalLM.from_pretrained(
            model_dir,
            config=config,
            quantization_config=quantization_config,
            device_map={"": gpu_id},
            local_files_only=True
        )
        model = torch.compile(model)
        tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        logger.info("Model successfully initialized on GPU %d with max tokens: %d.", gpu_id, tokenizer.model_max_length)
        return model, tokenizer
    except Exception as e:
        logger.error("Error initializing model on GPU %d: %s", gpu_id, str(e))
        raise

def postprocess_generated_text(generated_text, question_type):
    """
    Post-process the generated text to extract and clean the question and answer.
    """
    question_text = ""
    answer_text = ""
    for line in generated_text.splitlines():
        stripped_line = line.strip()
        if stripped_line.startswith("Question:"):
            question_text = stripped_line[len("Question:"):].strip()
        elif stripped_line.startswith("Answer:"):
            answer_text = stripped_line[len("Answer:"):].strip()

    if not question_text:
        logger.warning("No question text found for type '%s', using fallback.", question_type)
        question_text = f"Generated {question_type} question for the article."
    if not answer_text:
        logger.warning("No answer text found for type '%s', using fallback.", question_type)
        answer_text = f"Generated {question_type} answer for the article."

    return question_text, answer_text

def generate_qa_using_deepseek(record, question_type, model, tokenizer):
    """
    Generate a QA pair using the model's generate() method.
    For multiple choice questions, instruct the model to output four options (A-D) with distractors.
    """
    device = next(model.parameters()).device
    temperature = random.uniform(0.3, 0.5)

    distractor_instruction = ""
    if question_type == "multiple_choice":
        distractor_instruction = (
            "\nAlso, generate four options labelled A, B, C, and D. "
            "Option A must be the correct answer, and options B, C, and D should be plausible distractors. "
            "Format your answer as follows: 'Question: <the question text>' on one line, "
            "and 'Answer: Option A: <correct answer> Option B: <distractor> Option C: <distractor> Option D: <distractor>' on the next line."
        )

    prompt = f"""Article Title: {record.get('title', 'Unknown')}
Summary: {record.get('summary', 'No summary provided')}
Key Steps: {record.get('key_steps', 'No key steps provided')}
Settings: {record.get('settings', 'No settings provided')}
URL: {record.get('link', 'No URL provided')}

Instruction: Generate a {question_type} question and answer pair based on the above article details.{distractor_instruction}
Please provide your answer in the following format exactly:

Question: <the question text>
Answer: <the answer text>
"""

    prompt_tokens = tokenizer(prompt, add_special_tokens=False).input_ids
    prompt_length = len(prompt_tokens)
    available_tokens = tokenizer.model_max_length - prompt_length
    
    desired_new_tokens = 5120
    max_new_tokens = min(desired_new_tokens, available_tokens)
    
    try:
        inputs = tokenizer(
            prompt,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=tokenizer.model_max_length,
            return_attention_mask=True
        )
        inputs = {key: value.to(device) for key, value in inputs.items()}
        output_ids = model.generate(
            **inputs,
            do_sample=True,
            temperature=temperature,
            max_new_tokens=max_new_tokens,
            pad_token_id=tokenizer.eos_token_id
        )
        generated_text = tokenizer.decode(output_ids[0], skip_special_tokens=True)
    except Exception as e:
        logger.error("Error during generation for type '%s': %s", question_type, str(e))
        generated_text = ""
    
    question_text, answer_text = postprocess_generated_text(generated_text, question_type)
    qa_pair = {
        "question": question_text,
        "context": record.get("summary", ""),
        "answer": answer_text,
        "type": question_type,
        "category": record.get("source", ""),
        "metadata": {
            "title": record.get("title", ""),
            "key_steps": record.get("key_steps", ""),
            "settings": record.get("settings", ""),
            "url": record.get("link", "")
        }
    }
    return qa_pair

def generate_all_qa_pairs(record, model, tokenizer):
    question_types = [
        "fact_base",
        "why",
        "how",
        "multiple_choice",
        "fill_in_blank",
        "true_false"
    ]
    qa_pairs = []
    for qtype in question_types:
        try:
            qa = generate_qa_using_deepseek(record, qtype, model, tokenizer)
            qa_pairs.append(qa)
        except Exception as e:
            logger.error("Failed to generate QA pair for type '%s': %s", qtype, str(e))
    return qa_pairs

def process_batch(records, output_file, model, tokenizer):
    batch_results = []
    for record in records:
        qa_pairs = generate_all_qa_pairs(record, model, tokenizer)
        batch_results.extend(qa_pairs)
    try:
        # Acquire lock to ensure only one process writes at a time.
        with file_write_lock:
            with open(output_file, "a") as fout:
                for qa in batch_results:
                    json.dump(qa, fout)
                    fout.write("\n")
        logger.info("Processed and wrote a batch of %d records.", len(records))
    except Exception as e:
        logger.error("Error writing batch to file: %s", str(e))

def worker_process(gpu_id, seed_data, output_file, model_dir):
    """
    Single worker process per GPU, processing batches sequentially.
    """
    model, tokenizer = init_worker_model(model_dir, gpu_id)
    logger.info("Worker on GPU %d started.", gpu_id)
    
    while True:
        for i in range(0, len(seed_data), BATCH_SIZE):
            batch_records = seed_data[i:i+BATCH_SIZE]
            process_batch(batch_records, output_file, model, tokenizer)
        logger.info("Worker on GPU %d completed one full iteration over seed data. Sleeping for %d seconds...", gpu_id, SLEEP_INTERVAL)
        time.sleep(SLEEP_INTERVAL)

def main():
    model_dir = os.path.join(path_manager.get_path("SAVED_MODELS_PATH"), "DeepSeek-R1-Distill-Qwen-14B")
    input_file = path_manager.get_path("OMNISSA_DATASET_PATH_KB_DOC_SEED")
    output_file = os.path.join(path_manager.get_path("RAW_QA_DATASET_PATH"), "kb_doc_qa_pairs.jsonl")
    
    try:
        with open(input_file, "r") as fin:
            seed_data = [json.loads(line) for line in fin if line.strip() != ""]
        logger.info("Loaded %d seed records from %s", len(seed_data), input_file)
    except Exception as e:
        logger.error("Error loading seed data: %s", str(e))
        return
    
    available_gpus = list(range(torch.cuda.device_count()))
    logger.info("Available GPUs on this node: %s", available_gpus)
    
    processes = []
    # Spawn WORKERS_PER_GPU processes for each available GPU.
    for gpu_id in available_gpus:
        for _ in range(WORKERS_PER_GPU):
            p = mp.Process(target=worker_process, args=(gpu_id, seed_data, output_file, model_dir))
            p.start()
            processes.append(p)
    
    try:
        for p in processes:
            p.join()
    except KeyboardInterrupt:
        logger.info("User interrupt received. Terminating worker processes.")
        for p in processes:
            p.terminate()

if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    main()