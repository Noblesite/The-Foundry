from setuptools import setup, find_packages
import logging
from pathlib import Path

# Initialize logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Setup")

# Define the base directory
BASE_DIR = Path(__file__).resolve().parent


def load_requirements():
    requirements_path = BASE_DIR / "requirements.txt"
    requirements = []
    for line in requirements_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            requirements.append(line)
    return requirements

# Setup configuration
setup(
    name="ema",
    version="1.0.0",
    packages=find_packages(),
    license="AGPL-3.0-or-later",
    include_package_data=True,
    install_requires=load_requirements(),
    entry_points={
        "console_scripts": [
            # Define CLI commands if needed
        ],
    },
    extras_require={
        "dev": ["pytest", "black", "flake8"],  # Optional development dependencies
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: GNU Affero General Public License v3 or later (AGPLv3+)",
        "Operating System :: OS Independent",
    ],
   
)

# Notes for Developers
logger.info("""
Setup Notes:
1. Ensure Python 3.10 or later is installed.
2. Use the following command to install the project in editable mode:
   pip install -e .
3. Runtime paths resolve from configs/path_config.yaml and can be overridden
   with environment variables named EMA_<PATH_KEY>.
4. To verify environment setup, run:
   python ../scripts/smoke_check.py
""")
