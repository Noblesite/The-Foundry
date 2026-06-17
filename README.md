# The Foundry

The Foundry is where raw data becomes intelligence, and curiosity becomes
understanding.

**Build Intelligence. Understand Everything.**

The Foundry is an open, self-hostable AI workshop for people who want to learn
how modern AI systems work by building them. It is part engineering console,
part STEM lab, and part maker space: upload source material, shape it into
training-ready data, run a Forge job, produce an Artifact, and talk to it
through a Construct.

## Current Status

This repository is a public starting point cut from the original E.M.A.
prototype. The product shell and workflow contracts are in place, while the
heavy AI workers are intentionally still behind simulator/adapter boundaries.

Working now:

- Foundry-branded React/Vite frontend.
- FastAPI backend with `/api/v1` Foundry contracts.
- SQLite-backed local catalog under ignored runtime paths.
- Workshop, Material, Assembly Line, Forge, Artifact, and Construct workflow.
- QA pair review and JSONL export for training-ready Materials.
- Simulated Forge progress and simulated Construct replies.
- Construct runtime adapter boundary for future local model streaming.
- Public smoke checks that avoid downloading models.

Still intentionally early:

- Real LoRA/QLoRA training execution.
- Robust document/PDF/web/video ingestion workers.
- Production authentication and user isolation.
- Full migration from old E.M.A./Workspace ONE prototype modules.
- Packaged installers and container deployment.

## Repository Layout

```text
.
├── EMA/
│   ├── backend/                 # FastAPI app and service boundaries
│   ├── frontend/                # React/Vite Foundry console
│   ├── configs/                 # Portable local configuration
│   ├── data_cleaning/           # Dataset preparation utilities
│   ├── data_layer/              # Retrieval and ingestion prototypes
│   ├── fine_tuning_layer/       # LoRA/QLoRA prototype code
│   └── runtime/                 # Ignored local catalog/material outputs
├── docs/                        # Product and architecture notes
├── scripts/                     # Developer helper scripts
├── Makefile                     # Common local commands
└── requirements.txt             # Public baseline Python dependencies
```

## Quick Start

Prerequisites:

- Python 3.10 or newer.
- Node.js 20 or newer.
- npm 10 or newer.

Create a Python environment and install the baseline backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd EMA/frontend
npm ci
```

From the repository root, verify the public baseline:

```bash
make check
```

## Run Locally

Start the backend:

```bash
make dev-backend
```

Start the frontend in another terminal:

```bash
make dev-frontend
```

Open the app at:

```text
http://127.0.0.1:5173
```

The backend defaults to:

```text
http://127.0.0.1:8000
```

The frontend can run fully against mock data by setting
`VITE_FOUNDRY_DATA_SOURCE=mock` in `EMA/frontend/.env`. Use
`VITE_FOUNDRY_DATA_SOURCE=construct-api` to keep mock catalog data while
testing live Construct runtime/chat endpoints. Use `VITE_FOUNDRY_DATA_SOURCE=api`
to hydrate the full console from FastAPI.

## Environment

Copy the examples when you need local configuration:

```bash
cp .env.example .env
cp EMA/frontend/.env.example EMA/frontend/.env
```

Do not commit real tokens, private datasets, generated JSONL exports, model
checkpoints, local databases, or virtual environments.

Useful variables:

- `HF_TOKEN`: optional Hugging Face token for gated/private models.
- `FOUNDRY_CATALOG_DB_PATH`: optional SQLite catalog path override.
- `FOUNDRY_CONSTRUCT_INFERENCE_MODE`: `simulated` or `transformers`.
- `VITE_BACKEND_URL`: frontend API base URL.
- `VITE_FOUNDRY_DATA_SOURCE`: `mock`, `construct-api`, or `api`.

## Common Commands

```bash
make setup-runtime
make smoke
make build
make lint
make health
make check
```

## Product Language

The Foundry uses domain terms that support the learn-by-building experience:

- Workshop: a project and learning workspace.
- Material: source data or generated training data.
- Assembly Line: processing pipeline that chunks sources and creates QA pairs.
- Forge: a training job.
- Artifact: a model checkpoint or trained output.
- Construct: an inference/chat surface for an Artifact.
- Library: retrieval knowledge for a Workshop.
- Academy: contextual learning woven into the workflow.

## Documentation

- [Product Architecture](docs/the_foundry_product_architecture.md)
- [Catalog Persistence](docs/the_foundry_catalog_persistence.md)
- [Forge Runtime Adapter](docs/forge_runtime_adapter.md)
- [MVP Missing Features](docs/mvp_missing_features.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

The Foundry is released under the MIT License. See [LICENSE](LICENSE).
