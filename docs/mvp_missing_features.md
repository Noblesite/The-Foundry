# MVP Missing Features

This document is the scope-control line for The Foundry MVP.

The MVP should prove one complete teachable loop:

1. Create a Workshop.
2. Register or upload source Material.
3. Convert Material into reviewed QA pairs.
4. Export training-ready JSONL.
5. Create a Forge contract from that JSONL.
6. Run a small local training or evaluation job.
7. Produce an Artifact record from real output.
8. Load a small local model or adapter into Construct.
9. Stream a response and save a Trial.
10. Explain each step clearly enough that the user learns what happened.

Anything that does not make that loop real, understandable, or safe is post-MVP.

## Current Baseline

The project already has a strong product shell:

- Foundry-branded React workbenches for Workshop, Materials, Forge, Artifacts, Construct, Trials, Academy, and Settings.
- FastAPI `/api/v1` contracts for the main workflow.
- SQLite catalog persistence for Workshops, Materials, Assembly Lines, QA pairs, Forges, Artifacts, Constructs, Trials, model Archive entries, download jobs, and runtime validations.
- QA review/export paths that create JSONL Materials.
- Forge contracts, runtime event files, worker reconciliation, simulated progress, and automatic Artifact metadata for completed training simulations.
- Hugging Face search, auth test, model preflight, download jobs, Archive cataloging, and local cache tracking.
- Construct runtime controls, local model preflight/load/probe, streaming chat endpoint, runtime history, validation history, memory release, and diagnostics bundle preview/export.
- An isolated MVP rehearsal test that proves Material -> reviewed QA -> JSONL -> Forge simulation -> Artifact -> Construct reply -> Trial scoring.
- An isolated FastAPI v1 contract rehearsal that proves the same MVP handoffs through public `/api/v1` endpoints.
- A mocked Archive/Hugging Face API contract rehearsal that proves auth, search, preflight, register, cache, evict, and download-job lifecycle without network calls.
- Contextual Academy/tooltip components across major workflow stations.

The central risk is that several core actions still look product-complete while using simulated, metadata-derived, or thin local paths underneath.

## MVP Boundary Snapshot

This is the current scope line after the recent QA and runtime slices.

MVP-critical remaining work:

- Prove one real, repeatable Material -> QA -> JSONL -> Forge -> Artifact -> Construct -> Trial path from a clean checkout.
- Keep one tiny cached model path as the official validation path; larger or better models are post-MVP unless they are needed to prove the same path.
- Keep the QA quality evaluator lightweight and deterministic enough for local tests; model-judge ensembles are post-MVP.
- Make every simulated/fallback state unmistakable before a user can export, train, load, or evaluate.
- Keep setup, health checks, and first-run docs strong enough that another developer can reproduce the demo without tribal knowledge.

Do not add before MVP unless one of the items above is blocked:

- New modalities beyond text/CSV/PDF/JSONL sources.
- New agent/RAG orchestration surfaces.
- More model marketplaces or publishing flows.
- Multi-user, cloud, or enterprise control planes.
- Advanced visualizations that do not directly unblock the core loop.

## MVP Blockers

### 1. Real Material Ingestion

Status: partial.

The current Materials flow registers a source URI. Text, transcript, and video-transcript sources can be read from local text-like files or directories. CSV, PDF, website, and non-text video inputs are represented by kind and estimated chunks, not real extraction.

MVP needs:

- Backend upload/import contracts for local files.
- A controlled runtime Materials directory with copied files, not user-entered paths only.
- Real text extraction for `.txt`, `.md`, `.csv`, and `.jsonl`.
- At least one real PDF path, even if MVP marks scanned/image PDFs as unsupported.
- Website ingestion should be either a real single-page fetcher or explicitly deferred from MVP.
- Clear per-source status: staged, extracting, extracted, failed, unsupported.
- User-visible errors when a source cannot be read.

MVP can defer:

- Deep crawling.
- Video/audio transcription.
- OCR.
- Rich document layout preservation.
- Remote object storage.

### 2. Real QA Generation and Review State

Status: partial.

The Assembly Line can chunk simple text and produce draft QA pairs with durable review/export states. It now has a model-backed QA generation boundary, runtime configuration, smoke proofing, and row-level provenance: generator model, confidence, and `foundry.qa-generation.v1` metadata. The remaining MVP gap is generation quality: the deterministic fallback is useful for offline smoke tests, but real training data needs a configured local generator model that can read chunk context, weigh what matters, produce instruction/output rows, score confidence, and keep humans in the review loop.

MVP needs:

- Model-backed QA generation using a local or configured generator model.
- A repeatable QA generator quality check against a tiny cached model and a stronger recommended local model.
- Prompt templates that preserve source context, persona/subject, and answer constraints.
- Confidence/quality metadata per QA row, including source chunk references.
- Export only reviewed/accepted rows by default, with an explicit override for draft rows.
- A visible quality gate before a Material can feed Forge.

MVP can defer:

- Multi-model synthetic QA generation and judge ensembles.
- Advanced deduplication/scoring.
- Human review assignment workflows.

### 3. Real Forge Execution

Status: not implemented.

Forge currently validates JSONL, writes contracts/events/metrics, simulates progress, simulates evaluation reports, and creates Artifact metadata. Local Forge mode only checks dependencies; it does not launch LoRA or QLoRA training.

MVP needs:

- A trainer adapter that can run one tiny local LoRA job against a tiny cached model and tiny JSONL Material.
- Clear job lifecycle: queued, preparing, training, saving, completed, failed, canceled.
- Durable worker events and metrics from the actual trainer process.
- Artifact metadata linked to actual output files.
- A CPU/MPS-safe default config for developer hardware.
- A hard resource guard before training starts.

MVP can defer:

- Distributed training.
- DeepSpeed.
- Multi-GPU scheduling.
- Large-model training.
- Full QLoRA optimization matrix.
- Cloud workers.

### 4. Artifact Integrity

Status: partial.

Artifacts are cataloged and can be created when a simulated Forge completes. They are not yet guaranteed to point to real adapter/model output files.

MVP needs:

- Artifact records must include output path, base model, adapter path or checkpoint path, training config, source Material id, Forge id, and creation status.
- Artifact readiness checks before Construct can load them.
- UI should distinguish simulated Artifact metadata from real trained output.
- Failed or incomplete Forge runs must not produce ready Artifacts.

MVP can defer:

- Artifact comparison beyond current Trial Report comparisons.
- Model card generation.
- Publishing to Hugging Face.

### 5. Construct Small-Model Happy Path

Status: partial.

Construct has a real Transformers streaming path, local Archive checks, preflight, load, probe, unload, memory release, and diagnostics. The default remains simulated, and runtime failure can fall back to simulated text.

MVP needs:

- One documented, repeatable small model path from Archive download to Construct streaming.
- UI mode labeling that makes simulation versus real Transformers unmistakable.
- A no-surprise fallback policy: if real local inference fails during MVP validation, show failure and recovery steps instead of silently acting like success.
- Automated smoke coverage for the local small-model path when dependencies and cached model are present.
- Runtime compatibility notes for macOS/MPS, CUDA, and CPU.

MVP can defer:

- High-quality persona behavior.
- Multi-model serving.
- Concurrent model hosting.
- Advanced sampling presets.

### 6. End-to-End Runtime Health Gate

Status: partial.

Runtime status, memory estimates, preflight checks, and diagnostics exist. The product still needs a single gate that tells users whether they can safely run the next step.

MVP needs:

- Readiness states per station: ready, warning, blocked.
- One user-facing reason when blocked.
- One recommended action when blocked.
- Resource checks before model download, model load, and Forge start.
- Consistent treatment of memory estimates across Archive, Construct, and Forge.

MVP can defer:

- Full scheduler.
- Cluster resource planning.
- Enterprise observability dashboards.

### 7. Backend Contract Tests

Status: partial.

The current public checks compile Python, run frontend sentinel tests, lint, build, run isolated MVP rehearsals through both the catalog services and FastAPI v1 endpoints, and cover Archive/Hugging Face acquisition contracts with network-free mocks. Those rehearsals prove the product handoffs from Material ingestion to Trial scoring without touching the developer's main runtime catalog. The remaining gap is additional runtime diagnostics export coverage.

MVP needs:

- Keep service-level and API-level backend tests for Workshop -> Material -> Assembly Line -> JSONL export -> Forge -> Artifact.
- Backend tests for Construct runtime events, diagnostics bundle, and validation export.
- Keep backend tests for Archive preflight/download-job contracts using mocked Hugging Face calls.
- Continued use of temporary test database fixtures so tests do not depend on the developer's local runtime catalog.

MVP can defer:

- Full browser E2E suite.
- Load testing.
- Cross-browser certification.

### 8. Setup Reliability

Status: partial.

Local dev scripts exist, and `make check` works for the public baseline. The MVP still needs a first-run path that a new user can follow without tribal knowledge.

MVP needs:

- One setup command or clearly ordered setup commands for backend and frontend.
- Explicit Python version guidance.
- Dependency groups for baseline app versus optional ML runtime.
- First-run health check that reports missing optional ML packages separately from app blockers.
- Clear `.env` examples for mock, hybrid Construct API, and full API mode.

MVP can defer:

- Installers.
- Docker Compose, if local venv/npm remains reliable.
- Signed releases.

### 9. Security and Data Safety Baseline

Status: partial.

The app avoids committing runtime data, redacts diagnostics, and does not persist Hugging Face tokens in backend services. MVP still needs a minimal safety pass because the product handles user files, model downloads, and generated datasets.

MVP needs:

- Upload path restrictions and path traversal protection.
- File size limits.
- Supported extension allowlist.
- Clear warning that source data and generated datasets stay local.
- Token handling policy documented in Settings and SECURITY.
- Diagnostics bundle persistence, if added, must keep the current redaction audit.

MVP can defer:

- Multi-user auth.
- Role-based access control.
- Enterprise audit log retention.
- Malware scanning, unless public upload hosting is added.

## MVP Nice-To-Haves

These help the demo but should not block MVP unless the team has capacity:

- Persist diagnostics bundles in the catalog.
- Add a guided first-run checklist.
- Add richer token/chunk visualizers.
- Add better empty states for no Materials, no Forges, no Artifacts, and no cached models.
- Add model-card style Artifact summaries.
- Add downloadable support bundle with app version, contract versions, and environment summary.

## Explicitly Post-MVP

These are valid Foundry goals, but they are scope creep before the core loop is real:

- Agents and tool-using workflows.
- RAG orchestration beyond lightweight Library context.
- Vision models.
- Speech models.
- Robotics.
- Multi-modal training.
- Distributed processing.
- Enterprise authentication and teams.
- Cloud deployment.
- Model marketplace publishing.
- Advanced interpretability visualizations such as real attention heatmaps.

## Recommended MVP Sequence

1. Add real local file upload/import for text, markdown, CSV, JSONL, and one PDF path.
2. Add QA review states and edit/save/export controls.
3. Add backend workflow tests around the existing SQLite catalog.
4. Implement a tiny local LoRA trainer adapter behind the Forge runtime boundary.
5. Make completed real Forge output create a verified Artifact.
6. Tighten Construct real/simulated labeling and prove one cached small-model streaming path.
7. Add one readiness gate that blocks unsafe download/load/train actions with clear recovery steps.
8. Run a full manual MVP rehearsal from empty Workshop to Construct Trial.

## MVP Definition Of Done

The Foundry reaches MVP when a new technical user can:

- Start the app locally.
- Create a Workshop.
- Add real local source files.
- Generate and review QA rows.
- Export JSONL.
- Start a tiny Forge job.
- Receive a real Artifact record backed by output files.
- Load or select that Artifact in Construct.
- Stream a response.
- Save/evaluate at least one Trial.
- Understand from the UI what each step did.

If a feature does not support that path, it should wait until after MVP.
