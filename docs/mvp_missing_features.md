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

## MVP Remaining Work Checklist

This is the short steering list. If a task does not support one of these items, it should wait until after MVP.

### Critical Path

- [x] Prove real local file ingestion for text, markdown, CSV, JSONL, and one non-scanned PDF path.
- [x] Prove model-backed QA generation with source-aware prompt templates and visible quality metadata.
- [x] Implement one tiny local LoRA trainer adapter behind the existing Forge runtime boundary.
- [x] Make real Forge completion create a verified Artifact backed by output files.
- [x] Prove one cached small-model Construct streaming path without silent fallback.
- [ ] Add one end-to-end readiness gate for Archive download, Construct load, and Forge start.
- [ ] Run a clean manual MVP rehearsal from empty Workshop to saved Trial.

### Guardrails

- [ ] Keep simulated/fallback states unmistakable anywhere a user can export, train, load, infer, or evaluate.
- [ ] Keep the official proof path tiny and repeatable; larger models stay post-MVP.
- [ ] Keep backend contract rehearsals green and isolated from local runtime data.
- [ ] Keep setup and first-run docs strong enough for a new technical user to reproduce the demo.
- [ ] Keep local data, token handling, diagnostics redaction, file limits, and path restrictions explicit.

### Already Covered

- [x] Foundry-branded workbenches and navigation.
- [x] SQLite catalog persistence for the main workflow.
- [x] QA review/export to JSONL Materials.
- [x] Forge contract, worker-event, simulation, Artifact readiness, and Artifact metadata paths.
- [x] Archive/Hugging Face search, auth, preflight, register, cache, evict, and download-job API contracts with mocked external calls.
- [x] Construct runtime events, validation history, diagnostics bundle, and memory cleanup contracts.
- [x] Service-level and FastAPI-level MVP workflow rehearsals that run in isolated storage.

## Current Baseline

The project already has a strong product shell:

- Foundry-branded React workbenches for Workshop, Materials, Forge, Artifacts, Construct, Trials, Academy, and Settings.
- FastAPI `/api/v1` contracts for the main workflow.
- SQLite catalog persistence for Workshops, Materials, Assembly Lines, QA pairs, Forges, Artifacts, Constructs, Trials, model Archive entries, download jobs, and runtime validations.
- QA review/export paths that create JSONL Materials.
- Model-backed QA generation contract proof with explicit prompt-template metadata, source fingerprints, visible quality metrics, and deterministic fallback.
- Real local file extraction for text/markdown, CSV, JSONL/NDJSON, and text-based PDFs through service-level and FastAPI workflow rehearsals.
- Forge contracts, runtime event files, worker reconciliation, simulated progress, local trainer adapter contracts, verified Artifact readiness, and automatic Artifact metadata for completed training runs.
- Hugging Face search, auth test, model preflight, download jobs, Archive cataloging, and local cache tracking.
- Construct runtime controls, local model preflight/load/probe, cached-model streaming proof, no-silent-fallback stream errors, runtime history, validation history, memory release, and diagnostics bundle preview/export.
- An isolated MVP rehearsal test that proves Material -> reviewed QA -> JSONL -> Forge simulation -> Artifact -> Construct reply -> Trial scoring.
- An isolated FastAPI v1 contract rehearsal that proves the same MVP handoffs through public `/api/v1` endpoints.
- A mocked Archive/Hugging Face API contract rehearsal that proves auth, search, preflight, register, cache, evict, and download-job lifecycle without network calls.
- A Construct diagnostics API contract rehearsal that proves runtime events, validation history, filtered exports, diagnostics bundle shape, and redaction policy metadata.
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

Status: covered for MVP file types; still limited by explicit MVP constraints.

The Materials flow can import controlled local files, copy them into runtime storage, and extract text from text/markdown, CSV, JSONL/NDJSON, and text-based PDFs. Website and non-text video inputs remain represented by kind and estimated chunks, not real extraction.

MVP needs:

- Keep backend upload/import contracts for local files.
- Keep controlled runtime Materials directory copies, not user-entered paths only.
- Keep real text extraction for `.txt`, `.md`, `.csv`, `.jsonl`, `.ndjson`, and text-based `.pdf`.
- Keep the explicit unsupported state for scanned/image-only PDFs.
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

Status: contract covered; quality tuning remains.

The Assembly Line can chunk simple text and produce draft QA pairs with durable review/export states. It now has a model-backed QA generation boundary, runtime configuration, smoke proofing, source-aware prompt-template metadata, and row-level provenance: generator model, confidence, and `foundry.qa-generation.v1` metadata. The remaining MVP risk is generation quality, not the contract path: the deterministic fallback is useful for offline smoke tests, but real training data still needs a configured local generator model that can produce useful instruction/output rows and keep humans in the review loop.

MVP needs:

- Keep model-backed QA generation using a local or configured generator model.
- Keep the repeatable QA generator contract proof and add manual quality notes for the recommended local model.
- Keep prompt templates that preserve source context, persona/subject, and answer constraints.
- Keep confidence/quality metadata per QA row, including source chunk references.
- Export only reviewed/accepted rows by default, with an explicit override for draft rows.
- A visible quality gate before a Material can feed Forge.

MVP can defer:

- Multi-model synthetic QA generation and judge ensembles.
- Advanced deduplication/scoring.
- Human review assignment workflows.

### 3. Real Forge Execution

Status: contract covered; real-model smoke run still manual.

Forge validates JSONL, writes contracts/events/metrics, simulates progress, simulates evaluation reports, and creates Artifact metadata. Local Forge mode now has a LoRA trainer adapter behind the same durable contract, preflight gates for runtime/dependencies/model cache/memory, worker events for local training, and worker completion that creates an Artifact linked to adapter output files. The automated rehearsal proves this through an injected tiny trainer backend; the full Torch/PEFT run remains a manual smoke path so normal checks stay fast and offline-safe.

MVP needs:

- Keep the trainer adapter able to run one tiny local LoRA job against a tiny cached model and tiny JSONL Material.
- Keep clear job lifecycle events: queued, validating, training, saving, completed, failed.
- Keep durable worker events and metrics from the trainer process.
- Keep Artifact metadata linked to adapter output files.
- Keep CPU/MPS-safe defaults for developer hardware.
- Keep hard resource guards before training starts.

MVP can defer:

- Distributed training.
- DeepSpeed.
- Multi-GPU scheduling.
- Large-model training.
- Full QLoRA optimization matrix.
- Cloud workers.

### 4. Artifact Integrity

Status: covered for MVP contract rehearsal.

Artifacts are cataloged and can be created when simulated or local worker-backed Forges complete. Artifact DTOs now include live readiness checks that distinguish verified output files, caution paths, simulated metadata-only Artifacts, and blocked real-output paths with missing files. Construct load is blocked when a real Forge output path lacks adapter/checkpoint files.

MVP needs:

- Keep Artifact records tied to output path, base model, adapter path or checkpoint path, source Material, Forge id, and creation status.
- Keep Artifact readiness checks before Construct can load real worker output.
- Keep UI distinction between verified, simulated, caution, and blocked Artifact states.
- Keep failed or incomplete Forge runs from producing ready Artifacts.

MVP can defer:

- Artifact comparison beyond current Trial Report comparisons.
- Model card generation.
- Publishing to Hugging Face.

### 5. Construct Small-Model Happy Path

Status: covered for MVP contract rehearsal; real dependency smoke remains manual.

Construct has a real Transformers streaming path, local Archive checks, preflight, load, probe, unload, memory release, and diagnostics. The default remains simulated for first-run friendliness. In Transformers mode, stream failures now produce explicit error events instead of silently returning simulator text. The API rehearsal proves a cached local-model stream through the public SSE endpoint with an injected tiny backend, then proves an uncached model fails loudly.

MVP needs:

- Keep one documented, repeatable small model path from Archive download to Construct streaming.
- Keep UI mode labeling that makes simulation versus real Transformers unmistakable.
- Keep the no-surprise fallback policy: if real local inference fails during MVP validation, show failure and recovery steps instead of silently acting like success.
- Keep automated contract coverage for the cached-model stream path and add optional full dependency smoke notes.
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

Status: covered for MVP contract rehearsal; keep protected.

The current public checks compile Python, run frontend sentinel tests, lint, build, run isolated MVP rehearsals through both the catalog services and FastAPI v1 endpoints, cover Archive/Hugging Face acquisition contracts with network-free mocks, and exercise Construct diagnostics exports. Those rehearsals prove the product handoffs from Material ingestion to Trial scoring without touching the developer's main runtime catalog.

MVP needs:

- Keep service-level and API-level backend tests for Workshop -> Material -> Assembly Line -> JSONL export -> Forge -> Artifact.
- Keep backend tests for Construct runtime events, diagnostics bundle, and validation export.
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

1. Add one readiness gate that blocks unsafe download, load, and train actions with clear recovery steps.
2. Tighten first-run setup docs around baseline app dependencies versus optional ML runtime dependencies.
3. Run a full manual MVP rehearsal from empty Workshop to Construct Trial.

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
