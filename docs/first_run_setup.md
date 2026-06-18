# First-Run Setup

The Foundry has two dependency lanes:

- Baseline app lane: runs the FastAPI contracts, SQLite catalog, local file ingestion, frontend, mock workflows, diagnostics, and public checks.
- Optional ML runtime lane: adds Hugging Face downloads, real Transformers Construct streaming, local LoRA Forge proof runs, retrieval experiments, and legacy prototype integrations.

Start with the baseline lane. Install the optional lane only when you are ready to load local models.

## 1. Baseline App Setup

Prerequisites:

- Python 3.10 or newer.
- Node.js 20 or newer.
- npm 10 or newer.

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd EMA/frontend
npm ci
cd ../..
make setup-runtime
make check
```

This path should not download model weights or require Torch, PEFT, CUDA, MPS, or bitsandbytes.

## 2. Run The App

Backend:

```bash
make dev-backend
```

Frontend:

```bash
make dev-frontend
```

Open:

```text
http://127.0.0.1:5173
```

Backend default:

```text
http://127.0.0.1:8000
```

## 3. Frontend Data Modes

Create local environment files when needed:

```bash
cp .env.example .env
cp EMA/frontend/.env.example EMA/frontend/.env
```

Choose one frontend data mode in `EMA/frontend/.env`:

```text
VITE_FOUNDRY_DATA_SOURCE=mock
```

Use this for the fastest offline UI check.

```text
VITE_FOUNDRY_DATA_SOURCE=construct-api
```

Use this when you want mock catalog data but live Construct runtime/chat endpoints.

```text
VITE_FOUNDRY_DATA_SOURCE=api
```

Use this for the full FastAPI-backed workflow.

## 4. Optional ML Runtime Setup

Install this only after the baseline app passes:

```bash
source .venv/bin/activate
pip install -r requirements-ml.txt
```

This adds packages such as `torch`, `transformers`, `peft`, `accelerate`, `huggingface-hub`, retrieval dependencies, and legacy prototype integrations.

For gated/private Hugging Face models, set credentials locally:

```text
HF_USERNAME=
HF_TOKEN=
```

Do not commit real tokens.

## 5. Runtime Modes

Construct defaults to simulated streaming:

```text
FOUNDRY_CONSTRUCT_INFERENCE_MODE=simulated
```

Use local Transformers only after optional ML dependencies are installed and the model is cached in the Archive:

```text
FOUNDRY_CONSTRUCT_INFERENCE_MODE=transformers
FOUNDRY_CONSTRUCT_MODEL_ID=sshleifer/tiny-gpt2
```

Forge defaults to simulated progress:

```text
FOUNDRY_FORGE_RUNTIME_MODE=simulated
```

Use local Forge only after optional ML dependencies are installed and a tiny model is cached:

```text
FOUNDRY_FORGE_RUNTIME_MODE=local
```

## 6. Tiny Local Proofs

The safest model for proving the path is `sshleifer/tiny-gpt2`. It is a smoke-test model, not a quality benchmark.

Local Forge preflight:

```bash
.venv/bin/python scripts/run_local_forge_smoke.py
```

Local Forge run:

```bash
.venv/bin/python scripts/run_local_forge_smoke.py --run
```

If preflight blocks, follow the failed check detail. The most common blockers are missing optional ML packages, missing cached model files, or memory-fit warnings.

## 7. Readiness Gate

The backend exposes one gate for the dangerous steps:

```text
POST /api/v1/foundry/readiness
```

It normalizes Archive download, Construct load, and Forge start into:

- `ready`: safe to continue.
- `caution`: allowed, but review warnings first.
- `blocked`: do not continue; follow the recovery action.

Use this gate before downloading a model, loading Construct, or starting a local Forge.

## 8. MVP Manual Rehearsal

After baseline and optional runtime setup:

1. Start backend and frontend.
2. Create a Workshop.
3. Import a tiny text Material.
4. Run an Assembly Line to create QA pairs.
5. Review and export accepted QA as JSONL.
6. Create a LoRA Forge from that JSONL.
7. Run the local Forge proof or simulator.
8. Confirm the Artifact readiness state.
9. Load the Artifact into Construct.
10. Stream a reply and save a Trial.

The goal is not model quality yet. The goal is a clean, teachable, repeatable path from Material to Trial.
