from transformers import AutoTokenizer, AutoModelForCausalLM
from huggingface_hub import login
import os

hf_token = os.getenv("HF_TOKEN")
login(hf_token, add_to_git_credential=True)

model_name = "meta-llama/Meta-Llama-3.1-8B"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(model_name)

print("Model loaded successfully!")