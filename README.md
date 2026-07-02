# The Foundry

The Foundry is where raw data becomes intelligence, and curiosity becomes
understanding.

**Build Intelligence. Understand Everything.**

The Foundry is an open, self-hostable AI workshop for people who want to learn
how modern AI systems work by building them. It is part engineering console,
part STEM lab, and part maker space: upload source material, shape it into
training-ready data, run a Forge job, produce an Artifact, and talk to it
through a Construct.

## Public MVP Status

This repository is a public starting point cut from the original E.M.A.
prototype. The product shell and MVP workflow contracts are in place, and the
baseline app can prove the complete local learning loop without downloading
models:

```text
Workshop -> Material -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial
```

Heavy AI workers remain explicit opt-in runtime paths so a new user can run the
app before installing local model packages.

Working now:

- Foundry-branded React/Vite frontend.
- FastAPI backend with `/api/v1` Foundry contracts.
- SQLite-backed local catalog under ignored runtime paths.
- Workshop, Material, Assembly Line, Forge, Artifact, and Construct workflow.
- QA pair review and JSONL export for training-ready Materials.
- Model-backed QA generation, Forge trainer, and Construct streaming contract
  proofs with deterministic/offline fallbacks where appropriate.
- Simulated Forge/Construct paths that are labeled as simulated.
- Local runtime adapter boundaries for Transformers streaming and tiny LoRA
  Forge proofs.
- Unified readiness gate for Archive download, Construct load, and Forge start.
- Public smoke checks that avoid downloading models.

Still intentionally early:

- Full-quality LoRA/QLoRA training beyond the tiny local proof path.
- Robust document/PDF/web/video ingestion workers.
- Production authentication and user isolation.
- Full migration from old E.M.A./Workspace ONE prototype modules.
- Packaged installers and container deployment.

See [Known Limitations](docs/known_limitations.md) for the current public MVP
boundary.

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
├── requirements.txt             # Public baseline Python dependencies
├── requirements-app.txt         # Baseline app/API/test dependencies
└── requirements-ml.txt          # Optional local ML/runtime dependencies
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

That baseline is enough for the API, catalog, local file ingestion, mock/local
workflow rehearsals, frontend integration, and `make check`. Install optional
ML/runtime dependencies only when you are ready to download models, stream with
Transformers, or run the local LoRA Forge proof:

```bash
pip install -r requirements-ml.txt
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

For a deeper explanation of what each proof command covers, see
[MVP Verification](#mvp-verification).

With the backend running, prove the live MVP handoffs:

```bash
make mvp-demo
```

That command imports a tiny Material, creates reviewed QA, exports JSONL,
simulates a Forge, creates an Artifact, loads Construct, saves a Trial, and
prints the created IDs. It does not download model weights.

## MVP Verification

The public MVP verification path is intentionally no-download by default. It
separates contract readiness from optional heavy ML runtime proof so new users
can trust what is working before they download models.

Use these commands from the repository root:

```bash
make check
```

Runs the full public baseline: runtime directory setup, Python smoke checks,
backend contract rehearsals, frontend build, frontend lint, and frontend
sentinel tests. This should pass without model downloads or optional ML model
weights.

```bash
make qa-generator-cache-loop
```

Proves the QA generator cache loop through FastAPI contracts:

```text
uncached QA generator -> blocked preflight -> local Archive cache -> ready preflight -> model-backed proof
```

This smoke is network-free. It creates an isolated local Archive sentinel and
uses a tiny injected backend response, so it proves the cache/preflight/proof
contract without downloading or loading a real model. It does not prove model
quality.

```bash
make mvp-demo
```

Requires a running backend at `http://127.0.0.1:8000` unless
`FOUNDRY_API_BASE_URL` is set. It proves the live handoff path against the API:

```text
Material -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial
```

By default this uses deterministic QA plus simulated Forge and Construct
runtime paths. That is intentional for the public baseline. Real local
Transformers inference and local LoRA/QLoRA training remain optional runtime
proof paths after baseline setup.

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

For a guided walkthrough, use the [MVP Demo Script](docs/mvp_demo_script.md).

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
- `FOUNDRY_FORGE_RUNTIME_MODE`: `simulated` or `local`.
- `FOUNDRY_MODEL_ARCHIVE_DIR`: optional local model Archive path.
- `VITE_BACKEND_URL`: frontend API base URL.
- `VITE_FOUNDRY_DATA_SOURCE`: `mock`, `construct-api`, or `api`.

## Common Commands

```bash
make setup-runtime
make smoke
make backend-test
make build
make lint
make health
make qa-generator-cache-loop
make mvp-demo
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
- [First-Run Setup](docs/first_run_setup.md)
- [MVP Demo Script](docs/mvp_demo_script.md)
- [Known Limitations](docs/known_limitations.md)
- [License Policy](docs/license_policy.md)
- [Public Release Checklist](docs/public_release_checklist.md)
- [Release Notes: v0.1.0-mvp](docs/release_notes_v0.1.0-mvp.md)
- [Release Notes: v0.1.1-mvp](docs/release_notes_v0.1.1-mvp.md)
- [Catalog Persistence](docs/the_foundry_catalog_persistence.md)
- [Forge Runtime Adapter](docs/forge_runtime_adapter.md)
- [MVP Missing Features](docs/mvp_missing_features.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

The Foundry is released under the GNU Affero General Public License v3.0 or
later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE).

The intent is simple: The Foundry should remain open for learners, builders,
and self-hosters. If someone modifies the platform and offers it as a hosted
service, the AGPL requires them to make the corresponding source code available
to the users of that service. Commercial use is allowed only within those
source-sharing obligations.

Earlier public snapshots that were received under MIT remain under the license
terms that applied when those copies were received. New development from this
point forward is AGPL-licensed.
