# The Foundry Next Milestone Project Plan

Last reviewed: 2026-06-20

This document is the source of truth for the next milestone. It is based on a maintainer-level crawl of the repository, not on README claims alone.

## 1. Executive Summary

The Foundry already has a coherent product shell and a working local contract path for the intended loop:

```text
Workshop -> Material -> Assembly Line -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial -> Academy
```

What currently works:

- The FastAPI app exposes `/api/v1` endpoints for Foundry status, readiness, Workshops, Materials, Assembly Lines, QA generator runtime, QA review/export, Forges, Artifacts, Constructs, Trials, Archive/model management, runtime diagnostics, and Academy content. Evidence: `EMA/backend/api_server.py`.
- The SQLite catalog persists Workshops, Materials, Assembly Line runs, chunks, QA pairs, Forges, Artifacts, Constructs, Construct messages, Trials, Academy concepts/actions, UI catalog entries, model Archive entries, download jobs, and Construct runtime validations. Evidence: `EMA/backend/services/foundry_catalog_service.py`.
- The frontend has Foundry-branded workbenches for Workshop, Materials, Forge, Artifacts/Archive, Construct, Trials, Academy, and Settings. Evidence: `EMA/frontend/src/components/*.tsx`, `EMA/frontend/src/domain/foundry.ts`.
- Material file import works for text, Markdown, CSV, JSONL/NDJSON, and text-based PDF. Single-page website fetch/snapshot now exists with source metadata. Evidence: `FoundryCatalogService._import_material_file_sync`, `_read_text_source`, `_read_pdf_source`, `_snapshot_website_source`; tests in `scripts/test_foundry_workflow_contract.py` and `scripts/test_foundry_api_workflow_contract.py`.
- Assembly Line supports text-like sources and creates QA rows. Evidence: `FoundryCatalogService._start_assembly_line_sync`, `_build_text_chunks`, `_build_qa_pairs`.
- QA review/edit/accept/reject exists in backend and frontend, and export creates JSONL Materials with quality metadata. Evidence: `update_qa_pair_review`, `export_qa_pairs_to_material`, `MaterialsWorkbench.tsx`.
- Forge creates durable training contracts and worker event/metrics files, validates JSONL, can simulate progress, and can run an explicit local tiny LoRA trainer path when optional ML dependencies and cached model files are present. Evidence: `ForgeTrainingService`, `scripts/run_forge_contract_worker.py`, `LocalForgeSmokeService`.
- Completed training Forges create Artifact records automatically, and Artifact readiness distinguishes verified, caution, simulated, and blocked output paths. Evidence: `_ensure_artifact_for_forge`, `_artifact_readiness`.
- Construct has simulated and local Transformers streaming modes, preflight/load/probe/unload/release-memory actions, SSE streaming, runtime events, validation history, diagnostics bundle export, and memory cleanup hooks for Python, CUDA, and MPS. Evidence: `ConstructInferenceService`, `stream_foundry_construct_chat_endpoint`, `ConstructWorkbench.tsx`.
- Trials can be saved and exported back into JSONL Materials; evaluation Forges can produce simulated Trial Reports and weak-sample JSONL exports. Evidence: `create_trial`, `export_trials_to_material`, `export_evaluation_samples_to_material`, `TrialsWorkbench.tsx`.
- `make check` covers smoke checks, backend contract rehearsals, frontend build/lint, and frontend sentinel tests. Evidence: `Makefile`, `scripts/smoke_check.py`.

What is simulated:

- Default Forge progress and evaluation reports are simulated. Evidence: `ForgeTrainingService.describe_runtime`, `record_simulation_step`, `build_evaluation_report`.
- Default Construct replies are simulated. Evidence: `ConstructInferenceService.describe_runtime`, `_stream_simulated`, `FoundryCatalogService._build_construct_response`.
- `make mvp-demo` proves the loop with deterministic QA and simulated Forge/Construct runtime. Evidence: `scripts/run_mvp_manual_rehearsal.py`.
- Mock frontend mode can simulate nearly all workbenches without backend persistence. Evidence: `mockFoundryRepository` in `EMA/frontend/src/services/foundryRepository.ts`.

What is partially implemented:

- Model-backed QA generation exists through one local Transformers path and an injected-test backend, but it is not yet a hardware-aware model selection system. Evidence: `QAGenerationService.configure`, `preflight`, `_generate_with_transformers`.
- QA quality gating is lightweight and term-overlap based; it is useful as a guardrail but not sufficient for training-worthy data. Evidence: `QAQualityEvaluator`.
- Local Forge can train a tiny LoRA adapter, but QLoRA and larger training flows remain guarded. Evidence: `ForgeTrainingService.preflight_local_training`, `_run_lora_training`.
- Construct can stream a cached local model and can apply a LoRA adapter Artifact through PEFT when adapter metadata is provided. Evidence: `ConstructInferenceService._load_transformers_model_sync` loads `AutoModelForCausalLM` and wraps adapter-backed Artifacts with `PeftModel`.
- Website ingestion fetches one page and extracts text; it is not yet a dynamic crawler. Evidence: `_snapshot_website_source`, `_fetch_website_html`, `_extract_website_text`.
- Academy exists as contextual cards/tooltips, a lesson workbench, and an actionable Dashboard progress map for the Material -> Assembly Line -> QA Review -> JSONL -> Forge -> Artifact -> Construct -> Trial loop. Dashboard step states now use catalog evidence from Materials, Assembly Line runs, QA reviews, JSONL Materials, Forge runs, Artifact readiness, Construct runtime state, and Trials instead of progress-percentage heuristics. Users can open each loop step directly from the Dashboard, destination stations show a Dashboard focus callout explaining the intended panel/action, active stations deep-link to source controls, Assembly Line runs, QA review, JSONL export controls, Forge contract/queue, Artifact catalog/detail, Construct runtime loading, or saved Trial evidence as appropriate, and each focused station now surfaces a local "Next required action" based on current state. Materials/Assembly Line explains source ingestion, chunking, QA generation mode, and QA quality gates; Forge explains method choice, adapter boundaries, and tiny proof mode; Artifacts explains readiness and promotion gates; Trials include live-loop guidance for runtime sources and repeated-prompt comparison; Construct explains runtime loading, adapter evidence, and memory cleanup states. Real layer/token visualizations remain future work. Evidence: `App.tsx`, `Dashboard.tsx`, `LoopFocusCallout.tsx`, `LearningComponents.tsx`, `MaterialsWorkbench.tsx`, `ForgeWorkbench.tsx`, `ArtifactsWorkbench.tsx`, `TrialsWorkbench.tsx`, `ConstructWorkbench.tsx`, `AcademyWorkbench.tsx`, `academyRegistry.ts`.

What is missing:

- A QA generator model selection architecture that chooses Tier 0/1/2/3 based on hardware, local cache, source complexity, context needs, and user quality/speed preference.
- Rich source reference metadata for chunks: page, section, row, line, URL anchor, transcript timestamp, or byte span.
- A validated JSONL dataset preview/checker that explains why rows are or are not Forge-ready before export/start.
- Real local model-backed QA acceptance tests that run with cached tiny models without downloading during baseline checks.
- A production-quality QA prompt/evaluation suite covering factuality, grounding, duplication, triviality, coverage, procedures, comparisons, constraints, edge cases, examples, cause/effect, troubleshooting, and terminology.
- Construct adapter loading for trained LoRA Artifacts.
- A clearly documented small-model happy path from cached model -> QA generation -> Forge -> Artifact -> Construct streaming with no silent fallback.
- Removal or isolation of old E.M.A./Workspace ONE modules that are not on the Foundry MVP path.

What must be true for the next milestone to be complete:

- A user can ingest source material, chunk it predictably with source references, generate real model-backed QA pairs from source chunks, review/edit/approve/reject them, export valid JSONL, run a tiny local Forge proof, register a verified Artifact, load it into Construct or load the appropriate base model path, stream a reply, save a Trial, and learn what happened through Academy guidance.
- Deterministic/offline paths remain available for smoke tests, CI, demos, and first-run no-download workflows.
- Simulated or fallback output is never presented as production output.

## 2. Repository Inventory

Backend modules:

- `EMA/backend/api_server.py`: FastAPI app, Pydantic request models, `/api/v1` routes, SSE Construct streaming, legacy `/query`, `/chat`, `/conversation` routes.
- `EMA/backend/services/foundry_catalog_service.py`: SQLite catalog, domain persistence, Workshop/Material/Assembly/QA/Forge/Artifact/Construct/Trial/Academy workflows, website snapshotting, JSONL exports, readiness metadata.
- `EMA/backend/services/qa_generation_service.py`: deterministic and Transformers QA generator runtime, prompt, preflight, smoke proof, quality proof, model cache probe, memory estimate.
- `EMA/backend/services/qa_quality_service.py`: lightweight QA scoring and gate metrics.
- `EMA/backend/services/forge_training_service.py`: Forge runtime contract, simulator, local tiny LoRA trainer adapter, dataset validation, worker events/metrics, evaluation report simulation.
- `EMA/backend/services/forge_smoke_service.py`: one-row local Forge proof builder and optional worker runner.
- `EMA/backend/services/construct_inference_service.py`: Construct runtime adapter, local Transformers load/preflight/probe/stream, simulated streaming, runtime events, diagnostics, memory cleanup.
- `EMA/backend/services/huggingface_model_service.py`: Hugging Face auth/search/inspect/preflight/register/download/evict/download-job lifecycle and platform fit estimation.
- `EMA/backend/services/chat_orchestration_service.py`: legacy chat/RAG delegation boundary kept out of FastAPI route logic.
- Legacy/prototype modules: `EMA/data_cleaning`, `EMA/data_layer`, `EMA/embedding`, `EMA/expansion_layer`, `EMA/fine_tuning_layer`, `EMA/model_layer`, `EMA/distributed_processing`, `EMA/ray_cluster`, `EMA/workspace_one_workflows`, `EMA/ingestion_layer`.

Frontend modules:

- `EMA/frontend/src/App.tsx`: app shell, station routing, bootstrap, settings, runtime state handoffs.
- `EMA/frontend/src/domain/foundry.ts`: primary frontend domain types.
- `EMA/frontend/src/domain/dataSourceMode.ts`: mock, construct-api, and full API mode.
- `EMA/frontend/src/services/foundryRepository.ts`: repository interface plus mock, API, and construct-api hybrid implementations.
- `EMA/frontend/src/mocks/foundryMockData.ts`: offline product fixture data.
- `Dashboard.tsx`, `MaterialsWorkbench.tsx`, `ForgeWorkbench.tsx`, `ArtifactsWorkbench.tsx`, `ConstructWorkbench.tsx`, `TrialsWorkbench.tsx`, `AcademyWorkbench.tsx`, `SettingsOverlay.tsx`: main user-facing stations.
- `LearningComponents.tsx`, `academyRegistry.ts`: contextual education primitives and default concepts/actions.

Runtime adapters:

- QA generator: deterministic and local Transformers in `QAGenerationService`.
- Forge: simulated and local worker/trainer in `ForgeTrainingService` plus `scripts/run_forge_contract_worker.py`.
- Construct: simulated and local Transformers in `ConstructInferenceService`.
- Archive/model acquisition: Hugging Face optional API in `HuggingFaceModelService`.

API routes:

- Foundry system: `/api/v1/foundry/status`, `/api/v1/foundry/readiness`, `/api/v1/foundry/bootstrap`, `/dashboard`, `/navigation`, `/sections`, `/ui-catalog`.
- Academy: `/api/v1/academy/concepts`, `/api/v1/academy/actions`.
- Workshops/Materials/Assembly/QA: `/api/v1/workshops`, `/materials`, `/materials/import-file`, `/materials/website-preview`, `/assembly-lines`, `/chunks`, `/qa-pairs`, `/qa-pairs/{id}`, `/qa-pairs/export`.
- QA generator runtime: `/api/v1/assembly-line/qa-generator/runtime`, `/configure`, `/preflight`, `/smoke-proof`, `/quality-proof`.
- Forge: `/api/v1/forges/runtime`, `/configure`, `/smoke-proof`, `/workshops/{id}/forges`, `/forges/{id}/contract`, `/events`, `/worker/reconcile`, `/worker/preflight-local`, `/worker/run-local`, `/simulate`, `/evaluation/weak-samples/export`.
- Artifact/Construct/Trial: `/artifacts`, `/constructs/load-artifact`, `/constructs`, `/trials`, `/trials/export`, `/constructs/{id}/chat`, `/chat/stream`.
- Construct runtime: `/api/v1/constructs/runtime`, `/events`, `/events/export`, `/events/clear`, `/validations`, `/validations/export`, `/diagnostics/export`, `/configure`, `/load`, `/preflight`, `/probe`, `/unload`, `/release-memory`.
- Archive: `/api/v1/archive/models`, `/search`, `/inspect`, `/preflight`, `/register`, `/download`, `/evict`, `/download-jobs`, `/download-jobs/{id}`, `/cancel`, `/archive/huggingface/auth/test`.
- Legacy routes: `/query/`, `/chat` websocket, `/feedback/`, `/conversation/save`, `/conversation/load`, `/conversation/reset`.

Data/catalog paths:

- SQLite catalog: `EMA/runtime/foundry_catalog.db`, override `FOUNDRY_CATALOG_DB_PATH`.
- Material sources: `EMA/runtime/materials/sources`.
- Material exports: `EMA/runtime/materials/exports`.
- Forge worker files: `EMA/runtime/forges/{forgeRunId}/contract.json`, `events.jsonl`, `metrics.json`.
- Artifact outputs: `EMA/runtime/artifacts/...`.
- Model Archive cache: `EMA/runtime/models/huggingface`, override `FOUNDRY_MODEL_ARCHIVE_DIR`.

Tests:

- Root smoke: `scripts/smoke_check.py`.
- Workflow service rehearsal: `scripts/test_foundry_workflow_contract.py`.
- FastAPI workflow rehearsal: `scripts/test_foundry_api_workflow_contract.py`.
- Archive API contract: `scripts/test_foundry_archive_api_contract.py`.
- Construct diagnostics API contract: `scripts/test_foundry_construct_diagnostics_api_contract.py`.
- Frontend sentinel tests: `EMA/frontend/scripts/test-construct-readiness.mjs`, `test-construct-runtime-events.mjs`.

Documentation:

- Root status: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`.
- Product/architecture: `docs/the_foundry_product_architecture.md`, `docs/the_foundry_catalog_persistence.md`, `docs/forge_runtime_adapter.md`.
- Setup/demo/status: `docs/first_run_setup.md`, `docs/mvp_demo_script.md`, `docs/known_limitations.md`, `docs/mvp_missing_features.md`, `docs/release_notes_v0.1.0-mvp.md`, `docs/roadmap.md`.
- Legacy docs: `EMA/README.md`, `EMA/TODO.md`, `EMA/md_notes/*`.

Scripts and Makefile targets:

- `make setup-runtime`, `smoke`, `backend-test`, `build`, `lint`, `test`, `check`, `dev-backend`, `dev-frontend`, `health`, `mvp-demo`.
- `scripts/dev_backend.sh`, `scripts/dev_frontend.sh`, `scripts/health_check.py`, `scripts/run_mvp_manual_rehearsal.py`, `scripts/run_local_forge_smoke.py`, `scripts/run_forge_contract_worker.py`.

## 3. Product Capability Matrix

| Stage | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Workshop | Supported | `create_workshop`, `/api/v1/workshops`, `WorkshopCreateModal.tsx`, `WorkshopSwitcher.tsx` | Creates Workshop plus draft Artifact/Construct seed records. |
| Material | Supported | `register_material`, `import_material_file`, `preview_website_material`, `MaterialsWorkbench.tsx` | Text/Markdown/CSV/JSONL/PDF upload and single-page website snapshot exist. Deep crawler/video/OCR missing. |
| Assembly Line | Partially Supported | `_start_assembly_line_sync`, `_build_text_chunks`, `_build_qa_pairs` | Synchronous chunk/generate/write path works. Needs source-location metadata and stronger generation orchestration. |
| QA Review | Supported | `update_qa_pair_review`, `MaterialsWorkbench.tsx` review cards | Edit, accept, reject, save, quality badges, blocked export guard exist. |
| JSONL Material | Supported | `export_qa_pairs_to_material`, `validate_dataset` | Exports valid JSONL with instruction/output and metadata. Needs stronger preview/validator UX. |
| Forge | Partially Supported | `ForgeTrainingService`, `ForgeWorkbench.tsx`, `scripts/run_forge_contract_worker.py` | Contract, simulator, local LoRA proof path exist. QLoRA and full training are not production-ready. |
| Artifact | Partially Supported | `_ensure_artifact_for_forge`, `_artifact_readiness`, `ArtifactsWorkbench.tsx` | Simulated and verified output readiness exist. Adapter/full-checkpoint/metadata-only semantics are visible. |
| Construct | Partially Supported | `ConstructInferenceService`, SSE route, `ConstructWorkbench.tsx` | Simulated and cached Transformers streaming exist. LoRA adapter application now exists for PEFT-compatible local Artifacts; broader runtime adapters and quality proof remain future work. |
| Trial | Partially Supported | `create_trial`, `export_trials_to_material`, `TrialsWorkbench.tsx` | Trial persistence/export works, saved Trials capture runtime profiles, and the UI compares repeated prompts across runtime source, Artifact, verdict, adapter path, and token count; evaluation reports are simulated. |
| Academy | Partially Supported | `academyRegistry.ts`, `LearningComponents.tsx`, `App.tsx`, `Dashboard.tsx`, `LoopFocusCallout.tsx`, `AcademyWorkbench.tsx`, `MaterialsWorkbench.tsx`, `ForgeWorkbench.tsx`, `ArtifactsWorkbench.tsx`, `TrialsWorkbench.tsx`, `ConstructWorkbench.tsx` | Strong contextual scaffolding, with an actionable Dashboard loop progress map driven by catalog evidence, station focus callouts, deep panel focus across Materials/Forge/Artifacts/Construct/Trials, and local next-action guidance based on current station state. Forge guidance is tied to method choice/adapter boundaries/tiny proof, Artifact guidance to readiness/promotion gates, Trial guidance to runtime profiles/repeated-prompt comparison, and Construct guidance to runtime loading, adapter evidence, and memory cleanup. Real model internals and visualizations remain future work. |

## 4. README Claim Validation

| README claim | Classification | Evidence | Notes |
| --- | --- | --- | --- |
| Foundry-branded React/Vite frontend | Verified | `EMA/frontend/package.json`, `App.tsx`, `FoundryLogo.tsx`, `App.css` | Product shell is present. |
| FastAPI backend with `/api/v1` Foundry contracts | Verified | `EMA/backend/api_server.py` route list | Many `/api/v1` endpoints are present. |
| SQLite-backed local catalog under ignored runtime paths | Verified | `foundry_catalog_service.py`, `.gitignore`, `docs/the_foundry_catalog_persistence.md` | Runtime paths are ignored. |
| Workshop, Material, Assembly Line, Forge, Artifact, Construct workflow | Verified | `scripts/test_foundry_workflow_contract.py`, `scripts/test_foundry_api_workflow_contract.py` | Workflow is proven, though Forge/Construct default is simulated. |
| QA pair review and JSONL export | Verified | `update_qa_pair_review`, `export_qa_pairs_to_material`, `MaterialsWorkbench.tsx` | Export blocks drafts and low-quality rows unless overridden. |
| Model-backed QA generation | Partially Verified | `QAGenerationService._generate_with_transformers`, injected backend tests | Contract exists; hardware-aware selection and recommended quality model are missing. |
| Forge trainer proof | Partially Verified | `ForgeTrainingService._run_lora_training`, `LocalForgeSmokeService`, tests with injected trainer | Real LoRA code exists; automated proof uses injected backend, full run is optional/manual. |
| Construct streaming contract proofs | Verified | `ConstructInferenceService.stream_tokens`, API SSE tests | Simulated and injected/cached model stream paths are covered. |
| Simulated Forge/Construct paths labeled | Partially Verified | Runtime payloads and UI badges exist | Some guardrail docs still mark this as open; export/train/load surfaces need continued scrutiny. |
| Local runtime adapter boundaries for Transformers and tiny LoRA | Verified | `ConstructInferenceService`, `ForgeTrainingService` | Boundaries are clear. |
| Unified readiness gate | Verified | `/api/v1/foundry/readiness`, `SystemReadinessPanel.tsx` | Covers Archive, Construct, and Forge readiness. |
| Public smoke checks avoid downloading models | Verified | `Makefile`, `scripts/smoke_check.py`, `requirements.txt` | Optional ML remains separate. |
| Robust PDF/web/video ingestion workers | Missing/Outdated if implied | `known_limitations.md`, current service code | Text-based PDF and single-page website exist; video/OCR/deep crawl do not. |
| Full migration from old E.M.A. modules | Missing | `EMA/TODO.md`, `EMA/workspace_one_workflows`, `EMA/model_layer`, docs migration notes | README correctly says this is intentionally early. |

## 5. QA Generation Strategy

Current QA generation implementation:

- Runtime modes: `deterministic`, `transformers`, and API alias `local` mapped to Transformers.
- Default mode: deterministic via `FOUNDRY_QA_GENERATOR_MODE`.
- Default quality model id: `Qwen/Qwen2.5-0.5B-Instruct` via `FOUNDRY_QA_GENERATOR_MODEL`.
- Smoke/load proof model id: `sshleifer/tiny-gpt2`.
- Prompt version: `foundry.qa-prompt.source-context.v3`.
- Contract version: `foundry.qa-generation.v1`.
- Transformers path loads `AutoTokenizer`, `AutoModelForCausalLM`, and a CPU `text-generation` pipeline each generation call. Evidence: `QAGenerationService._generate_model_text`.
- If Transformers generation fails, it falls back to deterministic rows and records `fallbackReason` plus `requestedModelId`. Evidence: `QAGenerationService.generate`, `_row`.
- QA row metadata includes mode, model id, strategy, QA type, row index, prompt fingerprint, source chunk id, material name/kind, workshop subject, voice target, character count, token estimate, and source fingerprint.

Supported source types today:

- Uploaded text and Markdown files through text reader.
- CSV through `csv.DictReader` or plain rows.
- JSONL/NDJSON through instruction/output or generic key-value row rendering.
- Text-based PDF through `pypdf.PdfReader.extract_text`.
- Single-page website snapshots through `requests` + `_FoundryHTMLTextExtractor`.
- Transcript/video-transcript as text-like uploads.

Missing source ingestion types:

- Scanned/image-only PDFs and OCR.
- Dynamic website crawling with depth, domain policy, sitemap support, robots handling, dedupe, retries, and per-page provenance.
- Video/audio transcription.
- Rich document layout, tables beyond simple CSV, slide decks, docx, subtitles with timestamp preservation.
- Multi-file directory upload from UI.
- Source location metadata beyond chunk index and source URI.

Current prompt strategy:

- One generic source-context prompt asks for JSON array rows with `question`, `answer`, `confidence`, and `qaType`.
- It requests a diverse mix from `QA_TYPE_SEQUENCE`: factual, behavior, style, cause-effect, correction, safety-boundary.
- It truncates source context to 4000 characters.
- It does not currently vary templates by source type, domain complexity, or desired dataset objective.

Current model strategy:

- Fixed user-provided model id, defaulting to `Qwen/Qwen2.5-0.5B-Instruct` for quality QA proof.
- `sshleifer/tiny-gpt2` remains reserved for tiny smoke/load proofs, not training-worthy QA.
- Preflight checks Transformers importability, local cache, model directory size, and system memory.
- No GPU/Metal/CUDA-specific QA generation load path.
- No model tier recommendations.
- No endpoint adapter for Ollama, LM Studio, vLLM, OpenAI-compatible local servers, or Hugging Face inference endpoints.
- No automatic chunk context-window fit beyond character truncation.

Recommended model selection architecture:

- Add a `QAGeneratorRuntimeSelector` service that produces a ranked plan rather than a single configured mode.
- Inputs: platform profile, psutil memory, torch CUDA/MPS availability, local Archive entries, optional Hugging Face auth, source count, chunk token estimates, target QA count, desired quality/speed, offline-only setting, and user-selected overrides.
- Outputs: selected tier, provider, model id or endpoint, estimated context window, estimated memory, expected latency class, fallback policy, and visible explanation.
- Keep deterministic Tier 0 as always available.
- Store the selected plan in Assembly Line run metadata so generated QA can be traced back to the model-selection decision.
- Reuse hardware detection from `HuggingFaceModelService.platform_profile` and Construct diagnostics; do not duplicate logic in the frontend.

Recommended model tiers:

- Tier 0: deterministic/offline fallback. Use for CI, smoke tests, demos, no-download first run, and emergency fallback. Must be labeled "not training-quality by itself."
- Tier 1: small local model for modest hardware. Candidate classes: compact instruction models already cached locally, 0.5B-3B range, CPU/MPS viable, context >= 2k. The exact default should be configurable and documented after proof testing.
- Tier 2: stronger local model for GPU/Apple Silicon/high RAM. Candidate classes: 3B-8B instruction models, quantized where supported, context >= 4k-8k. Must require preflight and local cache.
- Tier 3: user-provided endpoint. Providers: Ollama, LM Studio, vLLM, Transformers server, Hugging Face local endpoint, OpenAI-compatible local server. External cloud APIs optional only; never required.

Recommended hardware detection approach:

- Centralize platform profile in backend: OS, architecture, Python, system RAM, available RAM, CUDA availability/device memory, MPS availability/unified memory, torch version, optional dependency presence.
- Add QA-specific fit estimation: model disk size, quantization assumption, context-window KV cache estimate, source chunk token budget, batch size, max new tokens, and safety headroom.
- Report confidence of estimate: exact config, approximate from files, unknown.
- Use conservative defaults and explicit override paths.

Recommended QA quality checks:

- Keep current lightweight gate for fast checks, but add a richer local evaluator:
  - answer grounded in source span
  - question clarity and answer completeness
  - hallucination risk
  - duplicate/similar question detection
  - triviality check
  - source coverage across chunks
  - QA type coverage
  - source quote/span reference availability
  - minimum/maximum answer length by QA type
  - term coverage for domain-specific terminology
- Add optional model-judge endpoint only as Tier 3 evaluator, never baseline.

Recommended human review workflow:

- Review list should group by source Material and chunk.
- Reviewer sees source chunk with highlighted terms/spans next to each QA pair.
- Accept, edit, reject, and "needs source fix" statuses should be supported.
- Export defaults to accepted/edited rows only.
- Overrides should be explicit and recorded in JSONL metadata.
- Add batch actions only after row-level review is stable.

Recommended QA metadata schema:

Each QA pair should retain:

- `workshopId`
- `materialId`
- `assemblyLineRunId`
- `chunkId`
- `sourceTitle`
- `sourceUri`
- `sourceLocation`: page, row, section, heading, URL, timestamp, line range, or byte span where available
- `chunkIndex`
- `chunkFingerprint`
- `question`
- `answer`
- `qaType`
- `generatorModel`
- `generationMode`
- `generatorProvider`
- `promptVersion`
- `promptFingerprint`
- `confidence`
- `qualityScore`
- `qualityReasons`
- `fallbackReason`
- `reviewStatus`
- `reviewedAt`
- `humanEditedQuestion`
- `humanEditedAnswer`
- `createdAt`

Recommended QA test suite:

- Unit tests for prompt construction and JSON parsing.
- Unit tests for source chunk metadata propagation.
- Golden deterministic tests for no-download mode.
- Injected model-backend tests for parseable model JSON and fallback metadata.
- Cached tiny local model test marked optional/manual or separate `make ml-proof`.
- Quality evaluator tests for grounded, hallucinated, duplicate, trivial, and malformed rows.
- API tests for Tier 0 and preflight result shape for Tier 1/2/3.
- Frontend tests for review/edit/export gates and simulation/fallback labels.

Recommended acceptance criteria:

- Deterministic mode remains green in `make check`.
- A cached small model can generate at least one parseable grounded QA row from a real source chunk.
- Every generated QA row records generator model/mode/provider, prompt version, chunk id, material id, source URI, and quality score.
- Fallback rows are blocked from default export and visibly labeled.
- Exported JSONL passes Forge validation and includes source/metadata fields.

QA pairs should be evaluated for:

- Factual correctness.
- Grounding in source material.
- Clear questions.
- Complete answers.
- Low hallucination risk.
- Low duplication.
- Avoidance of trivial questions.
- Coverage across source chunks.
- Definitions.
- Procedures.
- Comparisons.
- Constraints.
- Edge cases.
- Examples.
- Cause/effect relationships.
- Troubleshooting logic.
- Domain-specific terminology.

## 6. Gap Analysis

Workshop:

- Existing implementation: CRUD-lite create/list, active seed Artifact/Construct, frontend switcher.
- Missing behavior: deletion/archive, duplicate/import templates, multi-user ownership.
- Technical debt: package namespace still `EMA`.
- UX gaps: first-run onboarding could guide the complete loop more explicitly.
- Test gaps: no frontend interaction tests for Workshop creation.
- Documentation gaps: user-level explanation of Workshop lifecycle is thin.
- Risks: Workshop seed data can make empty/new state look more complete than it is.

Material:

- Existing implementation: register URL/path, upload files, preview/snapshot website, metadata JSON.
- Missing behavior: dynamic crawler, OCR, video transcription, docx/slides, robust directory upload, per-source failed/unsupported statuses.
- Technical debt: source references are mostly URI + chunk index.
- UX gaps: no Material detail drawer for provenance/text/chunks.
- Test gaps: no scanned PDF/unsupported source tests.
- Documentation gaps: exact supported file matrix should be more visible.
- Risks: user may expect `video-transcript` to process video, but it is text upload only.

Assembly Line:

- Existing implementation: synchronous chunking and QA generation.
- Missing behavior: queued/background worker, cancellation, progress, resumability, chunk source-location metadata.
- Technical debt: whitespace tokenization and character prompt truncation are rough approximations.
- UX gaps: no per-step run diagnostics beyond output rows.
- Test gaps: chunk boundary/overlap metadata tests are limited.
- Documentation gaps: chunking algorithm not explained enough.
- Risks: weak chunking hurts QA quality and training quality.

QA Review:

- Existing implementation: edit, save, accept, reject, quality badges, JSONL export gate.
- Missing behavior: richer statuses, source-span display, duplicate controls, batch review.
- Technical debt: quality evaluator is lightweight.
- UX gaps: only first 8 chunks/QA rows are shown.
- Test gaps: no browser-level review/edit/export tests.
- Documentation gaps: reviewer policy and quality rubric need a page.
- Risks: users can override low-quality rows and train weak Artifacts.

JSONL Material:

- Existing implementation: valid JSONL export and Forge validation.
- Missing behavior: dataset preview, schema validation UI, row sampling, token estimates, split train/eval.
- Technical debt: exported Material created through register path then updated.
- UX gaps: export success text only, no inspect/download preview from catalog.
- Test gaps: invalid row variants and schema warnings need coverage.
- Documentation gaps: exact JSONL schema should be documented.
- Risks: compatible JSONL may not be high-quality training JSONL.

Forge:

- Existing implementation: contract, simulator, worker files, local tiny LoRA code, preflight, smoke service.
- Missing behavior: QLoRA implementation, robust trainer lifecycle, queue/background worker, cancellation, adapter/base compatibility checks.
- Technical debt: local proof is tightly constrained and optional.
- UX gaps: method selector shows QLoRA even local trainer blocks it.
- Test gaps: real ML proof is not part of baseline; optional proof needs clearer target.
- Documentation gaps: exact local Forge prerequisites and supported methods should be clearer in UI.
- Risks: users may think a simulated Forge trained a real model.

Artifact:

- Existing implementation: auto-create on completed Forge, readiness checks.
- Missing behavior: model card, adapter type metadata, base/adaptor compatibility validation, promotion lifecycle.
- Technical debt: simulated Artifacts can load Construct because Construct is simulated.
- UX gaps: readiness detail exists but should explain adapter vs base model clearly.
- Test gaps: LoRA adapter apply path not tested because not implemented.
- Documentation gaps: "Artifact" should distinguish metadata-only, adapter, and full checkpoint.
- Risks: Artifact record != runnable tuned model unless output files and loader agree.

Construct:

- Existing implementation: simulated and Transformers streaming, runtime controls, preflight/load/probe, diagnostics, memory cleanup, Trial save.
- Missing behavior: RAG/library context integration, multi-conversation management, model unload safety across OSes beyond PyTorch cache cleanup, and broad adapter compatibility testing.
- Technical debt: `chat_with_construct` non-stream path builds simulated response from catalog even if runtime is Transformers.
- UX gaps: loaded Artifact panel does not yet prove adapter influence.
- Test gaps: actual adapter load/stream test missing.
- Documentation gaps: local model vs trained adapter flow should be explicit.
- Risks: user may train a LoRA and then chat with only the base model.

Trial:

- Existing implementation: saved verdicts, runtime profile capture, repeated-prompt comparison UI, export to JSONL, simulated evaluation reports and weak sample review/export.
- Missing behavior: real evaluator, rubric config, richer aggregate comparison charts across real checkpoints.
- Technical debt: evaluation reports are simulated.
- UX gaps: Trial creation depends on Construct interaction; standalone eval runner is simulated via Forge.
- Test gaps: frontend weak-sample drawer lacks interaction tests.
- Documentation gaps: evaluation vs trial terms need sharper definitions.
- Risks: simulated Trial Reports can overstate model quality.

Academy:

- Existing implementation: tooltips, learning cards, Academy workbench, seed concepts/actions, actionable Dashboard progress map for the full Foundry loop backed by catalog evidence, Dashboard focus callouts on destination stations, panel-level focus across Materials/Forge/Artifacts/Construct/Trials, local next-action guidance in focused stations, Materials guidance for source ingestion/chunking/QA generation/quality gates, Forge guidance for method choice/adapter boundaries/tiny proof, Artifact guidance for readiness/promotion gates, Trial guidance for runtime source evidence plus repeated-prompt comparison, and Construct guidance for runtime loading, adapter evidence, and memory cleanup.
- Missing behavior: adaptive guidance, live diagrams, real token visualizer tied to model tokenizer, attention heatmaps, layer visualizations from actual models.
- Technical debt: some concepts are generic and reused across stations.
- UX gaps: user learning path is now visible and navigable on the Dashboard, but Academy still needs deeper diagrams, station-specific completion evidence, and richer next-action context inside each destination station.
- Test gaps: no accessibility or keyboard tests for tooltips/drawers.
- Documentation gaps: Academy content authoring model is not documented.
- Risks: learning layer may feel decorative unless future stations follow the current pattern of attaching guidance to real workflow evidence.

## 7. Architecture Review

Separation of concerns:

- Good: FastAPI mostly validates HTTP and delegates to services. `scripts/smoke_check.py` explicitly guards against direct chat/RAG orchestration in `api_server.py`.
- Good: Forge and Construct runtime adapters sit behind service boundaries.
- Needs work: `FoundryCatalogService` is very large and owns schema, migrations, seeding, CRUD, ingestion, chunking, QA orchestration, JSONL export, Forge/Artifact/Construct/Trial domain logic, Academy seed data, and Archive job persistence.

Adapter boundaries:

- Forge and Construct boundaries are clear and durable.
- QA generation has a service boundary but not yet a provider/tier abstraction.
- Archive/Hugging Face is isolated, with auth redaction and download jobs.

Runtime mode handling:

- Modes are explicit: QA deterministic/transformers, Forge simulated/local, Construct simulated/transformers.
- Simulated/default modes keep first-run friendly.
- Need more consistent "fallback vs production" labeling in API payloads and export metadata.

Local-first design:

- Strong baseline: SQLite, ignored runtime paths, no model downloads for `make check`.
- Optional ML dependencies are separated into `requirements-ml.txt`.
- Need an explicit optional `make ml-proof` or similar for cached tiny model QA/Forge/Construct validation.

Optional ML dependency handling:

- Good: import checks and preflights prevent most baseline failures.
- Needs work: QA generator loads Transformers model per generation path and uses CPU pipeline only.
- Need more granular provider capability detection for MPS/CUDA/endpoint-based generation.

API consistency:

- `/api/v1` contracts are broad and useful.
- Legacy `/query`, `/chat`, `/conversation` routes remain and should be documented as legacy or moved out.
- Some frontend type duplication exists between DTOs and domain types.

Frontend state flow:

- Repository interface is strong and supports mock/full API/hybrid mode.
- App-level handoffs across Archive -> Construct and Forge -> Construct are useful.
- Mock repository is huge and can diverge from API behavior; keep contract tests or generated fixtures in sync.

Error handling:

- Good: many route handlers convert `ValueError` to HTTP 400/404 and stream errors as SSE error events.
- Needs work: some fallback paths return deterministic output after model failure, which is okay for smoke mode but risky for production generation unless labeled/blocked.

Simulation labeling:

- Good: runtime payloads carry `mode` and readiness statuses; docs say defaults are simulated.
- Needs work: every export/train/load/evaluation surface should show whether upstream data was deterministic, simulated, model-backed, or fallback.

Extensibility:

- Good: service boundaries make future workers possible.
- Needs work: provider abstractions for QA generation and Construct endpoints are not yet in place.

Testability:

- Strong service/API rehearsals.
- Need more frontend workflow interaction tests and optional ML proof tests.

## 8. Technical Debt Register

- Python package and root folder still use `EMA`; keep temporarily for import compatibility, but document deprecation path. Evidence: `docs/the_foundry_product_architecture.md`.
- Old Workspace ONE-oriented modules remain: `EMA/workspace_one_workflows`, `EMA/model_layer`, `EMA/data_layer`, `EMA/ingestion_layer/airwatch_*`, `EMA/TODO.md`, `EMA/configs/ema_config.yaml`.
- `EMA/requirements.txt` intentionally points older E.M.A. setup commands to optional ML/runtime stack; could confuse public users who cd into `EMA/`.
- Legacy chat/RAG routes remain in `api_server.py`: `/query/`, `/chat`, `/feedback/`, `/conversation/*`.
- `FoundryCatalogService` is too broad and should eventually split into catalog repositories plus domain services.
- QA generator model selection is configured manually and does not reuse Archive platform profile deeply enough.
- `WebsiteMaterialPreview` in `foundry.ts` has duplicate `fetchLimitBytes` field.
- Frontend mock repository is large and behavior-rich; risk of divergence from real API.
- Fine-tuning legacy modules have hardcoded TODOs and older trainer assumptions.
- Simulated evaluation reports live in Forge service and may look authoritative unless labeled.
- Non-stream Construct chat path remains simulated via catalog service even when Transformers runtime exists.
- Source chunk metadata lacks page/row/section/span fields.

## 9. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Optional ML dependency complexity | Users fail setup or hit opaque runtime errors | Keep baseline no-download lane, add optional ML proof target, improve preflight messages. |
| Model download size | Users consume disk/bandwidth unexpectedly | Keep Archive preflight gating and explicit download jobs. |
| Hardware variability | Same model behaves differently on CPU/CUDA/MPS | Centralize hardware profile and QA tier selection. |
| VRAM/RAM limits | Load/training can crash or swap | Conservative fit checks, clear overrides, memory cleanup, tiny proof defaults. |
| Apple Silicon/Metal differences | MPS support varies by model/op | Test MPS separately and provide CPU fallback guidance. |
| Weak QA data | Weak Artifacts and misleading demos | Prioritize QA generation quality, source grounding, review workflow, and JSONL validation. |
| PDF/web/video ingestion complexity | Users expect robust ingestion from labels | Scope supported source types visibly and add staged workers. |
| Simulated behavior over-promising | Users think real training/eval happened | Label simulated/fallback in API, UI, docs, exports, and reports. |
| Legacy E.M.A. confusion | Contributors work in wrong modules | Add cleanup map and deprecation notes. |
| "Training a model" expectations | Users expect full fine-tune quality | Explain LoRA adapter proof vs production training. |
| External API assumptions | Cloud dependence undermines self-hosted vision | Keep all APIs optional and local providers first. |
| Security/token handling | Tokens or diagnostics leak | Continue redaction, avoid exporting token values, keep `.env` ignored. |

## 10. Next Milestone Definition

The next milestone is complete when The Foundry can teach a user how to ingest source material, generate high-quality training QA pairs, review/edit them, export valid JSONL, train a small local model or LoRA, load the result, and interact with it through a Construct.

Acceptance criteria:

- Plain text ingestion works.
- Markdown ingestion works.
- PDF-derived text ingestion works.
- Source material is chunked predictably.
- Real QA pairs can be generated from real source chunks.
- QA pairs retain source references.
- QA pairs can be reviewed, edited, approved, and rejected.
- Approved QA pairs export as valid JSONL.
- JSONL is suitable for LoRA/QLoRA training.
- A deterministic no-download fallback remains available.
- A real local model QA generation path exists.
- Runtime clearly identifies which model/mode generated QA pairs.
- Simulated QA output is never presented as production output.
- A tiny local Forge proof path works.
- Artifact registration works.
- Construct loading works.
- Streaming chat works.
- Trial logging works.
- Academy guidance explains each major step.
- Tests validate the end-to-end learning loop.

Additional milestone-specific acceptance:

- QA generator supports Tier 0 and at least one real local model-backed Tier 1 path with cached model only.
- QA generator selection/preflight reports why it selected or rejected a model.
- Fallback QA rows are clearly blocked from default training export.
- Source references include at least Material, chunk id, source URI, chunk index, source title when available, and a forward-compatible `sourceLocation` object.
- A documented optional ML proof uses cached tiny model artifacts and a one-row JSONL Material.

## 11. Implementation Slices

### Slice 1: Source-of-truth contracts and terminology cleanup

- Objective: Make current contracts, terms, and simulated/live labels impossible to misread.
- Files likely touched: `docs/*`, `README.md`, `EMA/frontend/src/domain/foundry.ts`, `EMA/backend/api_server.py`, `EMA/backend/services/*`.
- Backend tasks: Add explicit `runtimeMode`, `simulationStatus`, or `fallbackReason` fields where missing in QA/Forge/Construct responses.
- Frontend tasks: Surface those fields consistently in Materials, Forge, Artifacts, Construct, and Trials.
- Tests: Contract shape assertions in workflow/API rehearsals; frontend sentinel for visible labels.
- Acceptance criteria: Export/train/load/evaluate surfaces show deterministic/model-backed/simulated/fallback state.
- Risks/notes: Keep changes additive to avoid breaking existing mocks.

### Slice 2: Material ingestion and catalog hardening

- Objective: Make source support and provenance visible and reliable.
- Files likely touched: `foundry_catalog_service.py`, `MaterialsWorkbench.tsx`, `foundry.ts`, docs.
- Backend tasks: Add `sourceStatus`, `sourceTitle`, `sourceLocationBase`, extraction errors, and unsupported reason fields.
- Frontend tasks: Add Material detail drawer with scrape/import metadata and extraction status.
- Tests: Upload/import tests for text, Markdown, CSV, JSONL, PDF; unsupported source error tests.
- Acceptance criteria: User can inspect original source, stored path, status, and extraction metadata before Assembly Line.
- Risks/notes: Avoid deep crawler scope in this slice.

### Slice 3: Chunking and source reference metadata

- Objective: Make chunks traceable enough for QA review and JSONL provenance.
- Files likely touched: `foundry_catalog_service.py`, schema migration, `MaterialsWorkbench.tsx`, tests.
- Backend tasks: Add `metadata_json` to `material_chunks` with source URI, title, kind, page/row/section/timestamp placeholders, token range, fingerprint.
- Frontend tasks: Show source reference next to chunks and QA rows.
- Tests: Assert metadata survives chunk creation, QA row generation, and JSONL export.
- Acceptance criteria: Every QA pair has chunk and source metadata suitable for training audits.
- Risks/notes: Location precision can be approximate initially but schema must be forward-compatible.

### Slice 4: QA generation model selection and hardware detection

- Objective: Add tiered QA model selection without requiring downloads.
- Files likely touched: `qa_generation_service.py`, `huggingface_model_service.py`, `api_server.py`, `MaterialsWorkbench.tsx`, docs.
- Backend tasks: Add selector service, platform profile reuse, tier result DTO, endpoint provider contract, cached-model probe.
- Frontend tasks: Add quality/speed preference, tier recommendation card, override path.
- Tests: Tier 0 always available; Tier 1 blocked without cache; platform profile shape.
- Acceptance criteria: QA generator explains selected tier/model/provider and memory/context fit.
- Risks/notes: Do not download during preflight.

### Slice 5: QA prompt strategy and quality checks

- Objective: Upgrade from one generic prompt to training-oriented QA templates and better gates.
- Files likely touched: `qa_generation_service.py`, `qa_quality_service.py`, tests, docs.
- Backend tasks: Add QA type prompt templates, duplicate/triviality/grounding checks, schema validation.
- Frontend tasks: Show quality reasons and QA type coverage.
- Tests: Golden prompts and quality gate fixtures.
- Acceptance criteria: Generated rows cover multiple QA types and low-quality rows are blocked with useful reasons.
- Risks/notes: Keep deterministic path stable for CI.

### Slice 6: QA review/edit/approve/reject workflow

- Objective: Make review scale beyond the first few rows and source comparisons.
- Files likely touched: `MaterialsWorkbench.tsx`, catalog service, CSS, tests.
- Backend tasks: Add pagination/filtering by review status, QA type, quality status.
- Frontend tasks: Full review drawer/table, source chunk side-by-side, batch accept/reject later if safe.
- Tests: Review status transitions and export gates.
- Acceptance criteria: User can review all rows, not only the first 8 displayed.
- Risks/notes: Avoid overbuilding assignment workflows.

### Slice 7: JSONL validation and dataset preview

- Objective: Make exported Materials visibly Forge-ready.
- Files likely touched: `forge_training_service.py`, `foundry_catalog_service.py`, `MaterialsWorkbench.tsx`, `ForgeWorkbench.tsx`.
- Backend tasks: Add JSONL validation endpoint and preview rows/token estimates.
- Frontend tasks: Dataset preview before Forge selection/start.
- Tests: Invalid JSONL, missing instruction/output, low-quality metadata warnings.
- Acceptance criteria: User sees schema status and sample rows before Forge.
- Risks/notes: Validation should not mutate state.

### Slice 8: Tiny real Forge LoRA proof path

- Objective: Make the optional tiny LoRA proof easy and repeatable.
- Files likely touched: `forge_training_service.py`, `forge_smoke_service.py`, `ForgeWorkbench.tsx`, docs.
- Backend tasks: Harden local trainer preflight, explicit cached-model instructions, optional `make ml-proof`.
- Frontend tasks: Improve proof status and blocked reasons.
- Tests: Keep injected trainer in baseline; add optional cached tiny model proof command.
- Acceptance criteria: With cached tiny model and ML deps, one-row JSONL produces verified Artifact files.
- Risks/notes: Keep baseline `make check` no-download.

### Slice 9: Artifact registry and readiness checks

- Objective: Make Artifact metadata precise enough for real loading.
- Files likely touched: catalog service, `ArtifactsWorkbench.tsx`, domain types.
- Backend tasks: Add adapter type, base model reference, output files, trainer result summary, compatibility flags.
- Frontend tasks: Show adapter/full-checkpoint distinction and Construct load implications.
- Tests: Verified/caution/simulated/blocked readiness.
- Acceptance criteria: User knows whether Artifact is metadata-only, adapter, or full checkpoint.
- Risks/notes: Avoid claiming adapter is loaded until Construct supports it.

### Slice 10: Construct runtime loading and streaming chat

- Objective: Connect real local model loading to the Artifact path.
- Files likely touched: `construct_inference_service.py`, `ArtifactsWorkbench.tsx`, `ConstructWorkbench.tsx`.
- Backend tasks: Add LoRA adapter loading with PEFT when Artifact is adapter-backed; retain base-model-only path.
- Frontend tasks: Show loaded base model plus adapter id/path.
- Tests: Injected adapter load test, cached tiny model stream test, no silent fallback.
- Acceptance criteria: A verified LoRA Artifact can be loaded/applied or clearly blocked with reason.
- Risks/notes: MPS/CUDA behavior needs cautious handling.

### Slice 11: Trial logging and comparison

- Objective: Make Trial data useful for deciding whether an Artifact improved.
- Files likely touched: catalog service, `TrialsWorkbench.tsx`.
- Backend tasks: Add comparison metadata, prompt set references, evaluator mode fields.
- Frontend tasks: Compare Artifacts/Trials by prompt, verdict, and runtime mode.
- Tests: Trial export and comparison calculations.
- Acceptance criteria: User can see whether a new Artifact improves on prior one.
- Risks/notes: Keep simulated evaluator labeled.

### Slice 12: Academy learning overlays

- Objective: Tie learning guidance to actual workflow events.
- Files likely touched: `academyRegistry.ts`, `LearningComponents.tsx`, workbenches.
- Backend tasks: Add concept/action metadata for QA generator tiers, chunking, review, JSONL, Forge, Artifact, Construct, Trial.
- Frontend tasks: Contextual callouts based on current station state and blocked reasons; Materials ingestion/chunking/QA guidance, Forge method/proof guidance, Artifact readiness/promotion guidance, Trial runtime/comparison guidance, and Construct runtime/load guidance are implemented examples.
- Tests: Basic rendering/accessibility sentinel.
- Acceptance criteria: Each station explains what the user is doing and why it matters.
- Risks/notes: Avoid decorative-only overlays.

### Slice 13: First-run onboarding and demo reliability

- Objective: Make the first local run predictable.
- Files likely touched: README, first-run docs, frontend onboarding, scripts.
- Backend tasks: Add status endpoint details for missing optional deps.
- Frontend tasks: First-run checklist panel.
- Tests: `make mvp-demo` and health checks.
- Acceptance criteria: New user can run baseline and understand optional ML next steps.
- Risks/notes: Do not require downloads.

### Slice 14: Test coverage and CI readiness

- Objective: Protect the loop as code changes.
- Files likely touched: `scripts/*`, frontend test scripts, maybe CI config.
- Backend tasks: Add QA quality fixtures, source metadata tests, JSONL validator tests.
- Frontend tasks: Add interaction tests for review/export and runtime labels.
- Tests: `make check`, optional `make ml-proof`.
- Acceptance criteria: Baseline checks remain offline; optional ML proof is documented.
- Risks/notes: Keep tests fast enough for contributors.

### Slice 15: Documentation cleanup for public users

- Objective: Align README/docs with actual milestone state.
- Files likely touched: README, known limitations, first-run setup, roadmap, architecture docs.
- Backend tasks: None unless docs generated from routes.
- Frontend tasks: None unless links added.
- Tests: Link/path sanity via smoke if added.
- Acceptance criteria: README claims classify real/simulated/partial accurately.
- Risks/notes: Avoid over-promising future features.

## 12. Prioritized Roadmap

Highest impact / lowest effort:

- Add source/chunk metadata and show it in QA review.
- Add explicit fallback/simulation labels to QA export and Forge/Construct surfaces.
- Add JSONL validation preview before Forge.
- Fix duplicate `fetchLimitBytes` frontend type.
- Document QA generator tiers and recommended cached tiny proof path.

Highest impact / medium effort:

- Add QA generator selector service with Tier 0/1/2/3 plans.
- Upgrade QA prompt templates and quality checks.
- Paginate/filter QA review rows.
- Add optional `make ml-proof` for cached tiny model QA/Forge/Construct proof.
- Add Artifact adapter metadata and Construct adapter-load gate.

Strategic long-term investments:

- Broader LoRA adapter compatibility and failure-mode testing in Construct.
- Endpoint adapters for Ollama, LM Studio, vLLM, and OpenAI-compatible local servers.
- Background worker queue for Assembly Line and Forge.
- Dynamic website crawler and OCR/transcription workers.
- Package namespace migration from `EMA` to `foundry`.

Technical debt cleanup:

- Isolate or remove Workspace ONE prototype modules.
- Split `FoundryCatalogService`.
- Mark legacy API routes clearly.
- Reduce mock repository drift risk.
- Improve docs around optional dependencies and simulated defaults.

Nice to have:

- Real tokenizer-based token preview.
- Attention/layer visualizations.
- Model cards for Artifacts.
- Dataset split controls.
- Richer Trial comparison charts.

## 13. Definition of Done

- `make check` passes.
- `make mvp-demo` passes against a running backend.
- Backend tests pass.
- Frontend build passes.
- Frontend lint passes.
- Frontend sentinel tests pass.
- Smoke tests pass without model downloads.
- Optional ML proof test passes with a cached tiny local model.
- QA generation tests pass.
- JSONL validation tests pass.
- README status is accurate.
- Docs are updated.
- Simulated behavior is clearly labeled.
- Deterministic fallback remains available.
- Heavy ML dependencies remain optional.
- No required baseline model download is introduced.

## 14. Recommended First Three Slices

1. Slice 3: Chunking and source reference metadata.

   This should come first because QA quality cannot be audited without source references. It also improves review UX, JSONL lineage, and future evaluator design without requiring model downloads.

2. Slice 4: QA generation model selection and hardware detection.

   QA generation is milestone-critical. The current fixed-model strategy is the biggest architecture gap. A selector lets The Foundry choose deterministic, small local, stronger local, or endpoint generation based on the real machine while keeping cloud optional.

3. Slice 5: QA prompt strategy and quality checks.

   Once chunks have references and the generator can choose an appropriate runtime, prompt quality and row gates determine whether the exported JSONL is actually training-worthy. This is the highest leverage step before spending more effort on Forge or Construct.

These three slices keep scope centered on the bottleneck: better Materials become better QA; better QA becomes better Forge input; better Forge input makes Artifacts worth testing.
