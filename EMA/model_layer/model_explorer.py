import json
from utilities.logger import get_logger
from utilities.path_manager import PathManager
from transformers import AutoModelForCausalLM, AutoTokenizer
import inspect
import torch.nn as nn
import difflib

class ModelExplorer():
    def __init__(self, model_directory: str):
        
        self.logger = get_logger("ModelExplorer")
        self.model_directory = model_directory  # You can pass the actual path here
        self.json_config_path = model_directory + "config.json"  # Assuming the JSON config is in the same directory

        # Load the model and tokenizer from the local directory and store them for later introspection
        self.model = AutoModelForCausalLM.from_pretrained(self.model_directory, local_files_only=True)
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_directory, local_files_only=True)

    def build_pipeline_layers_from_json(self, model_attributes: dict):

        self.logger.info(f"Opening JSON config from: {self.json_config_path}")
        with open(self.json_config_path, "r") as config_file:
            model_config = json.load(config_file)
        self.logger.info("JSON config successfully loaded.")

        num_hidden_layers = model_config.get("num_hidden_layers")
        if num_hidden_layers is None:
            error_msg = "The JSON config does not specify 'num_hidden_layers'."
            self.logger.error(error_msg)
            raise ValueError(error_msg)
        self.logger.info(f"Number of hidden layers specified in config: {num_hidden_layers}")

        pipeline_layers = []

        # Add embedding layers
        if hasattr(self.model.transformer, "wte"):
            pipeline_layers.append(self.model.transformer.wte)
            self.logger.info("Added embedding layer: wte")
        else:
            self.logger.warning("Model transformer does not have an embedding layer 'wte'.")

        if hasattr(self.model.transformer, "wpe"):
            pipeline_layers.append(self.model.transformer.wpe)
            self.logger.info("Added positional embedding layer: wpe")
        else:
            self.logger.warning("Model transformer does not have a positional embedding layer 'wpe'.")

        # Add transformer blocks dynamically based on config
        if hasattr(self.model.transformer, "h"):
            actual_layer_count = len(self.model.transformer.h)
            self.logger.info(f"Model has {actual_layer_count} transformer layers in attribute 'h'.")
            if actual_layer_count < num_hidden_layers:
                error_msg = f"Model has {actual_layer_count} layers, but config specifies {num_hidden_layers}."
                self.logger.error(error_msg)
                raise IndexError(error_msg)
            for i in range(num_hidden_layers):
                pipeline_layers.append(self.model.transformer.h[i])
                self.logger.info(f"Added transformer block layer {i}.")
        else:
            error_msg = "Model transformer does not have an attribute 'h' for hidden layers."
            self.logger.error(error_msg)
            raise AttributeError(error_msg)

        # Add final normalization layer if available
        if hasattr(self.model.transformer, "ln_f"):
            pipeline_layers.append(self.model.transformer.ln_f)
            self.logger.info("Added final normalization layer: ln_f")
        else:
            self.logger.warning("Model transformer does not have a final normalization layer 'ln_f'.")

        # Optionally add the head
        if hasattr(self.model, "lm_head"):
            pipeline_layers.append(self.model.lm_head)
            self.logger.info("Added language modeling head: lm_head")
        else:
            self.logger.warning("Model does not have a language modeling head 'lm_head'.")

        self.logger.info(f"Pipeline layers built successfully. Total layers: {len(pipeline_layers)}")
        return pipeline_layers

    def introspect_model(self):
        """
        Uses Python introspection to get all non-callable attributes of the model.
        This can help you explore the model's architecture programmatically.
        """
        # Use inspect to retrieve all members that are not callable
        members = inspect.getmembers(self.model, lambda a: not(inspect.isroutine(a)))
        # Filter out built-in attributes
        attrs = {name: value for name, value in members if not (name.startswith('__') and name.endswith('__'))}
        
        self.logger.info("Introspecting model attributes:")
        for name in sorted(attrs.keys()):
            self.logger.info(f"{name}: {attrs[name]}")
        
        return attrs
    
    


    def fuzzy_get_attribute(self, obj, target_names, logger, default=None, cutoff=0.8):
        """
        Returns the attribute of 'obj' whose name is a fuzzy match to one of the target_names.
        If no match is found above the cutoff, returns default.
        """
        attributes = [attr for attr in dir(obj) if not attr.startswith('_')]
        for target in target_names:
            matches = difflib.get_close_matches(target, attributes, n=1, cutoff=cutoff)
            if matches:
                matched_attr = matches[0]
                logger.info(f"Fuzzy matched attribute '{matched_attr}' for target '{target}'.")
                return getattr(obj, matched_attr)
        logger.warning(f"No fuzzy match found for targets: {target_names}.")
        return default

    def build_pipeline_layers_from_introspection(self, model_attributes: dict):
        """
        Dynamically builds pipeline layers by introspecting the model attributes dictionary.
        Uses fuzzy matching to handle edge cases and variations in attribute naming.
        """
        pipeline_layers = []
        
        # Determine transformer module: try matching 'model' or 'transformer'
        transformer_module = None
        transformer_module = self.fuzzy_get_attribute(self.model, ["transformer", "model"], self.logger)
        if transformer_module is None:
            error_msg = "No transformer module found using fuzzy matching on ['transformer', 'model']."
            self.logger.error(error_msg)
            raise AttributeError(error_msg)
        
        self.logger.info(f"Using transformer module from attribute: {transformer_module}")
        
        # Get embedding layer: try 'wte' or 'embed_tokens'
        embed_layer = self.fuzzy_get_attribute(transformer_module, ["wte", "embed_tokens"], self.logger)
        if embed_layer is not None:
            pipeline_layers.append(embed_layer)
            self.logger.info("Added embedding layer.")
        else:
            self.logger.warning("No embedding layer found (tried 'wte' and 'embed_tokens').")
        
        # Get positional embedding: try 'wpe' or similar
        pos_embed_layer = self.fuzzy_get_attribute(transformer_module, ["wpe", "pos_embedding", "position_embeddings"], self.logger)
        if pos_embed_layer is not None:
            pipeline_layers.append(pos_embed_layer)
            self.logger.info("Added positional embedding layer.")
        else:
            self.logger.warning("No positional embedding layer found (tried 'wpe', 'pos_embedding', 'position_embeddings').")
        
        # Get transformer blocks: look for a ModuleList typically stored in 'h'
        transformer_blocks = self.fuzzy_get_attribute(transformer_module, ["h", "layers"], self.logger)
        if transformer_blocks is None or not isinstance(transformer_blocks, nn.ModuleList):
            error_msg = "No ModuleList of transformer blocks found (tried 'h' or 'layers')."
            self.logger.error(error_msg)
            raise AttributeError(error_msg)
        
        num_layers = len(transformer_blocks)
        self.logger.info(f"Found {num_layers} transformer block layers in ModuleList.")
        
        # Optionally, you might want to use the model's config to determine how many layers to use.
        # For example, using fuzzy matching on the model_attributes['config'] for "num_hidden_layers".
        num_hidden_layers = None
        if "config" in model_attributes:
            config_obj = model_attributes["config"]
            # Try to retrieve num_hidden_layers directly
            if hasattr(config_obj, "num_hidden_layers"):
                num_hidden_layers = getattr(config_obj, "num_hidden_layers")
            else:
                # Fuzzy matching for key in the config's dict if it's a dictionary
                if isinstance(config_obj, dict):
                    matches = difflib.get_close_matches("num_hidden_layers", list(config_obj.keys()), n=1, cutoff=0.8)
                    if matches:
                        num_hidden_layers = config_obj[matches[0]]
            if num_hidden_layers is not None:
                self.logger.info(f"Using 'num_hidden_layers' from config: {num_hidden_layers}")
            else:
                self.logger.warning("Could not determine 'num_hidden_layers' from config; defaulting to all layers.")
        
        # If we didn't get a valid number, default to all transformer blocks.
        if num_hidden_layers is None or num_hidden_layers > num_layers:
            num_hidden_layers = num_layers
        
        # Add the transformer blocks up to num_hidden_layers
        for i in range(num_hidden_layers):
            pipeline_layers.append(transformer_blocks[i])
            self.logger.info(f"Added transformer block layer {i}.")
        
        # Get final normalization layer: try 'ln_f' or 'norm'
        norm_layer = self.fuzzy_get_attribute(transformer_module, ["ln_f", "norm", "final_norm"], self.logger)
        if norm_layer is not None:
            pipeline_layers.append(norm_layer)
            self.logger.info("Added final normalization layer.")
        else:
            self.logger.warning("No final normalization layer found (tried 'ln_f', 'norm', 'final_norm').")
        
        # Optionally add the head: try 'lm_head'
        head_layer = self.fuzzy_get_attribute(self.model, ["lm_head", "head"], self.logger)
        if head_layer is not None:
            pipeline_layers.append(head_layer)
            self.logger.info("Added language modeling head layer.")
        else:
            self.logger.warning("No language modeling head layer found (tried 'lm_head', 'head').")
        
        self.logger.info(f"Pipeline layers built successfully. Total layers: {len(pipeline_layers)}")
        return pipeline_layers
    
if __name__ == "__main__":

    path_manager = PathManager()
    model_dir = path_manager.get_path("SAVED_MODELS_PATH") + "/deepseek-coder-6.7b-instruct/"
    model_explorer = ModelExplorer(model_directory=model_dir)
    model_attributes =model_explorer.introspect_model()
    model_explorer.build_pipeline_layers_from_introspection(model_attributes=model_attributes)