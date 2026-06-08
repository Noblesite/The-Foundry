import os
import time
import json
import random
import pickle
import multiprocessing
import pandas as pd
from pathlib import Path
from transformers import pipeline, AutoModelForSeq2SeqLM, AutoTokenizer
from utilities.logger import get_logger
from utilities.path_manager import PathManager

logger = get_logger(__name__)

# === Global model variables (to prevent reloading) ===
model = None
tokenizer = None
qa_pipeline = None

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
    """Load model and tokenizer once per worker process."""
    global model, tokenizer, qa_pipeline
    if model is None or tokenizer is None or qa_pipeline is None:
        logger.info("Initializing model on process %d...", os.getpid())
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        qa_pipeline = pipeline("text2text-generation", model=model, tokenizer=tokenizer, device=0)

# === Worker Process for QA Generation ===
def generate_qa_for_batch(batch, output_file):
    """
    Generates QA pairs for a batch using a unique temperature.
    Runs inside a worker process (model already preloaded).
    """
    global model, tokenizer, qa_pipeline
    if model is None or tokenizer is None or qa_pipeline is None:
        raise RuntimeError("Model is not initialized! Ensure init_worker_model() is used.")

    templates = {
        "fact_based": "What is the purpose of the {api_name} API?",
        "why_how": "Why is the {key} parameter important in this API request?",
        "multiple_choice": "Which of the following best describes the function of {api_name}?",
        "fill_in_the_blank": "{api_name} is used for ______.",
        "true_false": "True or False: The {api_name} API requires the {method} method."
    }
    multiple_choice_options = ["A) Correct Answer", "B) Incorrect Option 1", "C) Incorrect Option 2", "D) Incorrect Option 3"]

    # Assign a unique temperature per batch
    temperature = random.uniform(0.7, 1.2)
    batch_qa_pairs = []

    for _, record in batch.iterrows():
        record = record.to_dict()
        qa_pairs = []

        for template_key, template_value in templates.items():
            try:
                if "{api_name}" in template_value and "api_name" in record:
                    question = template_value.format(api_name=record.get("api_name", "Unknown API"), method=record.get("method", "N/A"))
                    model_output = qa_pipeline([question], temperature=temperature, do_sample=True)
                    answer = model_output[0]['generated_text'] if model_output else "No answer generated."
                    qa_pairs.append({"question": question, "answer": answer, "type": template_key, "metadata": record})

                elif "{key}" in template_value:
                    for key, value in record.items():
                        if isinstance(value, (str, int)):
                            question = template_value.format(key=key)
                            model_output = qa_pipeline([question], temperature=temperature, do_sample=True)
                            answer = model_output[0]['generated_text'] if model_output else "No answer generated."
                            qa_pairs.append({"question": question, "answer": answer, "type": template_key, "metadata": {key: value}})

                elif template_key == "multiple_choice" and "api_name" in record:
                    question = template_value.format(api_name=record["api_name"])
                    answer = multiple_choice_options[0]  
                    qa_pairs.append({"question": question, "answer": answer, "options": multiple_choice_options, "type": template_key, "metadata": record})
            except Exception as e:
                logger.error(f"Error processing record: {record} - {e}")

        batch_qa_pairs.extend(qa_pairs)

    # Write results to file
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

    # Use multiprocessing with initializer to load model only once per worker
    with multiprocessing.Pool(processes=num_workers, initializer=init_worker_model, initargs=(model_name,)) as pool:
        pool.starmap(generate_qa_for_batch, [(batch, output_file) for batch in batches])

    logger.info("✅ All processes completed.")

# === Main Workflow ===
if __name__ == "__main__":
    # Configuration
    path_manager = PathManager()
    INPUT_PICKLE = path_manager.get_path("OMNISSA_API_DATASET")
    OUTPUT_FILE = path_manager.get_path("GENERATED_QA_PATH")
    MODEL_NAME = "google/flan-t5-large"  # Optimized for RTX 3090
    NUM_WORKERS = 5  # Adjust based on available GPU memory

    # Load dataset
    dataset = load_pickle_as_dataset(INPUT_PICKLE)
    if dataset is None:
        logger.error("Dataset could not be loaded. Exiting.")
        exit(1)

    # Continuous QA pair generation
    iteration = 1
    while True:
        try:
            logger.info("Starting parallel QA pair generation for iteration %d.", iteration)
            distribute_work_parallel(dataset, MODEL_NAME, OUTPUT_FILE, num_workers=NUM_WORKERS)
            logger.info("Completed iteration %d. Continuing to next iteration...", iteration)
            iteration += 1
        except Exception as e:
            logger.error("Error during QA pair generation in iteration %d: %s. Retrying in 60 seconds.", iteration, e)
            time.sleep(60)
