import logging
import os
import yaml
import sys
from logging.handlers import RotatingFileHandler
from utilities.path_manager import PathManager

path_manager = PathManager()

def load_log_config():
    """
    Loads the logging configuration from the `ema_config.yaml` file.

    Returns:
        dict: Configuration dictionary containing logging settings.
    """
    config_path = path_manager.get_path("EMA_CONFIG_PATH")  # Path to `ema_config.yaml`
    try:
        with open(config_path, "r") as file:
            config = yaml.safe_load(file)
        return config.get("logging", {})
    except FileNotFoundError:
        print(f"Warning: Logging config file not found at {config_path}. Using defaults.")
    except yaml.YAMLError as e:
        print(f"Warning: Failed to parse logging config file. Error: {e}")
    
    # Default logging config
    return {
        "level": "DEBUG",
        "max_log_size_mb": 10,
        "log_backup_count": 5
    }

def get_logger(name: str):
    """
    Configures and returns a logger instance with rolling log file support.

    Args:
        name (str): The name of the logger (typically the module or class name).

    Returns:
        logging.Logger: Configured logger instance.
    """
    # Load log configuration
    log_config = load_log_config()
    log_level = log_config.get("level", "DEBUG").upper()
    max_log_size_mb = log_config.get("max_log_size_mb", 10)  # Default: 10MB
    log_backup_count = log_config.get("log_backup_count", 5)  # Default: Keep last 5 logs
    
    log_directory = path_manager.get_path("LOG_DIRECTORY")
    os.makedirs(log_directory, exist_ok=True)  # Ensure logs directory exists
    log_file = os.path.join(log_directory, "application.log")

    # Create a custom logger
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, log_level, logging.INFO))

    # Prevent duplicate handlers
    if logger.hasHandlers():
        return logger

    # Create handlers
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.stream = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

    # ✅ Add Rolling File Handler with configurable size
    file_handler = RotatingFileHandler(
        log_file, 
        maxBytes=max_log_size_mb * 1024 * 1024,  # Convert MB to Bytes
        backupCount=log_backup_count, 
        encoding="utf-8"
    )

    # Set levels for handlers
    console_handler.setLevel(getattr(logging, log_level, logging.INFO))
    file_handler.setLevel(logging.DEBUG)

    # Create formatters and add to handlers
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Add handlers to the logger
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger