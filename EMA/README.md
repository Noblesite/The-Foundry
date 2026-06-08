# The Foundry

The Foundry is where raw data becomes intelligence, and curiosity becomes
understanding.

The Foundry is an early-stage AI workshop for streaming inference, dataset
preparation, retrieval, LoRA/QLoRA fine-tuning experiments, and contextual AI
education.

The project is being cleaned up for public release. The current source still
contains Workspace ONE-oriented prototype modules, but generated datasets,
private environment files, local virtual environments, and machine-specific
runtime artifacts are intentionally excluded from git.

## Current Capabilities

- FastAPI backend prototype with WebSocket token streaming.
- React/Vite frontend workshop console.
- JSONL cleaning and dataset preparation utilities.
- ChromaDB-backed retrieval helpers.
- LoRA/QLoRA fine-tuning prototype code.
- Ray and DeepSpeed experimental training/distribution modules.

## Public Repo Status

Stable enough to inspect:

- Source compilation
- Frontend production build
- Portable path configuration
- Artifact/private-data guardrails

Still being consolidated:

- Lazy model loading and model lifecycle controls
- General CSV/web-to-QA dataset jobs
- Training job orchestration and status APIs
- Public sample datasets
- Separation of optional GPU/DeepSpeed/scraping dependencies

## Quick Start

From the repo root:

```bash
python3 scripts/smoke_check.py
cd EMA/frontend
npm ci
npm run build
```

For backend development, create a fresh environment and install the baseline
requirements:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/smoke_check.py
```

## Runtime Paths

Runtime paths are configured in `configs/path_config.yaml` and resolve relative
to the `EMA/` package directory. Any path can be overridden with an environment
variable named `EMA_<PATH_KEY>`.

Example:

```bash
export EMA_SAVED_MODELS_PATH=/mnt/models/ema
```

Generated models, Chroma databases, logs, checkpoints, and datasets should live
under ignored runtime directories, not in git.

## Environment

Use `.env.example` and `frontend/.env.example` as templates. Do not commit real
tokens, certificates, private datasets, or generated model artifacts.

## Smoke Check

`scripts/smoke_check.py` intentionally avoids importing the API server or loading
models. It verifies:

- Python source compilation
- Portable path configuration when PyYAML is installed
- Absence of tracked private/generated artifacts such as `.env`, `.jsonl`,
  `.pkl`, pycache files, and local virtual environments

## Product Direction

The public product direction is documented in
[`docs/the_foundry_product_architecture.md`](../docs/the_foundry_product_architecture.md).
