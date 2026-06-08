import os
import yaml
from pathlib import Path

def resolve_paths():
    """
    Dynamically resolves paths for application use and writes them to a YAML file.
    """
    base_dir = Path(__file__).resolve().parent.parent
    config = {
        "paths": {
            "CHROMA_DB_PATH": str(base_dir / "data_layer" / "chroma_db"),
            "DEVELOPMENT_DATASET_PATH": str(base_dir / "data_layer" / "omnissa_dev_dataset"),
            "OMNISSA_STATIC_DATASET_PATH_API": str(base_dir / "data_layer" / "omnissa_static_knowlage_dataset" / "omnissa_apis_with_context_dataset.jsonl"),
            "OMNISSA_STATIC_DATASET_PATH_KB_DOC": str(base_dir / "data_layer" / "omnissa_static_knowlage_dataset" / "omnissa_kb_doc_dataset.jsonl"),
            "OMNISSA_DATASET_PATH_KB_DOC_SEED": str(base_dir / "data_layer" / "omnissa_static_knowlage_dataset" / "omnissa_kb_doc_qa_seed.jsonl"),
            "LOGGING_PATH": str(base_dir / "logs" / "application.log"),
            "GENERATED_QA_PATH": str(base_dir / "training_generation_layer"/ "gen_qa_pairs_jsonl" / "generated_qa_pairs.jsonl"),
            "LOG_DIRECTORY": str(base_dir / "logs"),
            "SEMANTIC_TEMPLATES_PATH": str(base_dir / "configs" / "semantic_templates.yaml"),
            "COLLECTIONS_PATH": str(base_dir / "configs" / "collections.yaml"),
            "KEY_CONTEXT_PATH": str(base_dir / "data_layer" / "key_context.json"),
            "QA_GENERATION_CONFIG": str(base_dir / "configs" / "qa_generation_config.yaml"),
            "EMA_CONFIG_PATH": str(base_dir / "configs" / "ema_config.yaml"),
            "QA_GENERATION_OUTPUT_CLEANED": str(base_dir / "training_generation_layer" / "gen_qa_pairs_jsonl" / "generated_qa_pairs_cleaned.jsonl"),
            "NLP_CONFIG_PATH": str(base_dir / "configs" / "nlp_config.yaml"),
            "RAY_CLUSTER_CONFIG": str(base_dir / "configs" / "ray_cluster.yaml"),
            "OMNISSA_API_DATASET": str(base_dir / "data_layer" / "omnissa_api_dataset.pkl"),
            "GENERATED_QA_PATH_RAY_CLUSTER": str(base_dir / "training_generation_layer" / "gen_qa_pairs_jsonl" / "generated_qa_pairs_ray_cluster.jsonl"),
            "CLEANED_QA_DATASET_PATH": str(base_dir / "training_generation_layer" / "qa_pairs_cleaned" / ""),
            "RAW_QA_DATASET_PATH": str(base_dir / "training_generation_layer" / "gen_qa_pairs_jsonl" / ""),
            "SAVED_MODELS_PATH": str(base_dir / "model_layer" / "models" / ""),
            "CONVERSATION_LOGGING_PATH": str(base_dir / "logs" / "conversation_log.jsonl"),
            "MODEL_FILE_READ_TOOL_FOLDER": str(base_dir / "data_layer" / "model_files"),
            "INTENT_MAPPING": str(base_dir / "configs" / "intent_mapping.yaml"),
            "WSO_WF_MDM_ENDPOINTS": str(base_dir / "workspace_one_workflows" / "mdm"),
            "WSO_WF_MAM_ENDPOINTS": str(base_dir / "workspace_one_workflows" / "mam"),
            "WSO_WF_SYSTEM_ENDPOINTS": str(base_dir / "workspace_one_workflows" / "system"),
            "WSO_WF_EXAMPLES": str(base_dir / "workspace_one_workflows" / "workflows"),
            "DIRTY_JSONL_DATA": str(base_dir / "data_cleaning" / "dirty_jsonl_data" / ""),
            "CLEAN_JSONL_DATA": str(base_dir / "data_cleaning" / "cleaned_jsonl_data" / ""),
            "FINE_TUNING": str(base_dir / "configs" / "fine_tuning_config.yaml"),
            "FINE_TUNE_CHECKPOINTS": str(base_dir / "fine_tuning_layer" / "progress_checkpoints"),
            "WSO_TRAIN_DS": str(base_dir / "data_cleaning" / "wso_train_dataset"),
            "WSO_VAL_DS": str(base_dir / "data_cleaning" / "wso_val_dataset"),
            "SYS_THRESHOLDS": str(base_dir / "configs" / "system_thresholds.yaml"),
            "DISTRIBUTED_DATA": str(base_dir / "configs" / "distributed_data.yaml"),
            "WSO_DISTRIBUTED_NODE_DATA": str(base_dir / "distributed_data_layer" / "distributed_cleaning" / "work_space_one"),
            "WSO_DISTRIBUTED_DIRTY_DATA_SET": str(base_dir / "distributed_data_layer" / "distributed_datasets" / "work_space_one" / "wso_dirty_full_dataset.jsonl"),
            "WSO_DISTRIBUTED_DATA_SET_DIR": str(base_dir / "distributed_data_layer" / "distributed_datasets" / "work_space_one"),
            "FINE_TUNE_DIR": str(base_dir / "fine_tuning_layer"),
        },  
    }

    # Create directories if they don't exist
    for path in config["paths"].values():
        os.makedirs(os.path.dirname(path), exist_ok=True)

    # Write to YAML file
    yaml_path = base_dir / "configs" / "path_config.yaml"
    with open(yaml_path, "w") as yaml_file:
        yaml.safe_dump(config, yaml_file)
    
    print(f"✅ Paths resolved and written to {yaml_path}")


if __name__ == "__main__":
    resolve_paths()