import json
import random
import torch
from transformers import pipeline

# Load the NER model
ner_pipeline = pipeline("ner", model="dslim/bert-base-NER")

# File paths
input_file = "/mnt/data/omnissa_apis_with_context_dataset.jsonl"
output_file = "/mnt/data/ner_training_data.jsonl"

def load_jsonl(file_path):
    """Loads a JSONL file into a list of dictionaries."""
    with open(file_path, "r", encoding="utf-8") as file:
        return [json.loads(line) for line in file]

def generate_ner_examples(dataset, ner_pipeline):
    """Generates synthetic NER training data based on API documentation."""
    ner_training_data = []
    
    for entry in dataset:
        text = entry.get("context", "")
        api_name = entry.get("api_name", "Unknown API")
        
        # Run through NER pipeline
        ner_results = ner_pipeline(text)
        
        # Convert NER results to standard format
        entities = []
        for entity in ner_results:
            entities.append({
                "word": entity["word"],
                "start": entity["start"],
                "end": entity["end"],
                "label": entity["entity"]
            })
        
        # Construct NER training example
        ner_training_data.append({
            "api_name": api_name,
            "text": text,
            "entities": entities
        })
    
    return ner_training_data

def save_jsonl(data, file_path):
    """Saves a list of dictionaries to a JSONL file."""
    with open(file_path, "w", encoding="utf-8") as file:
        for entry in data:
            file.write(json.dumps(entry) + "\n")

# Load dataset
dataset = load_jsonl(input_file)

# Generate NER training data
ner_training_data = generate_ner_examples(dataset, ner_pipeline)

# Save generated data
save_jsonl(ner_training_data, output_file)

print(f"✅ NER training dataset generated and saved to {output_file}")
