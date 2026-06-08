# The Foundry Product Architecture

The Foundry is a STEM-focused AI workshop where users learn how modern AI
systems work by building them.

The product should feel like a workshop, laboratory, maker space, and digital
foundry. The core promise is not only that users can train useful models; the
core promise is that users understand what happened, why it happened, and how to
improve the next build.

## 1. Product Architecture

### Core Product Boundary

The Foundry should be organized around user journeys rather than model
implementation details:

- Create a Workshop.
- Add Materials.
- Run an Assembly Line.
- Generate training examples.
- Open a Forge.
- Evaluate Artifacts.
- Run a Construct.
- Learn each concept in context.

This creates a clean product boundary: users think in workshops and artifacts,
while internal services keep direct technical names such as ingestion,
embedding, training, evaluation, and inference.

### Core Modules

**Workshop Service**

Owns the top-level project container. A Workshop groups source material,
generated datasets, training runs, evaluation reports, model artifacts, and
learning progress. It is the primary product unit.

Responsibilities:

- Workshop metadata and permissions.
- Selected base model and target behavior.
- Workshop lifecycle: draft, active, archived.
- Links to Materials, Forges, Artifacts, Constructs, and Library entries.

Future expansion:

- Team workspaces.
- Classroom cohorts.
- Enterprise tenant isolation.
- Shared public Workshop templates.

**Materials Service**

Owns uploaded and imported source material. A Material can be a CSV, PDF,
webpage, transcript, audio transcript, video transcript, image set, notebook, or
structured JSON document.

Responsibilities:

- File registration and metadata.
- Source type detection.
- Parsing status.
- Provenance and citation metadata.
- Safety and family-friendly classification.
- Deduplication and hash tracking.

Future expansion:

- Native audio/video extraction.
- OCR and document layout parsing.
- Connector imports from GitHub, Hugging Face, S3, Google Drive, SharePoint, or
  LMS systems.

**Assembly Line Service**

Owns repeatable data-processing workflows. Internally this is orchestration, but
the user-facing concept is an Assembly Line because it transforms raw Materials
into useful training and retrieval assets.

Responsibilities:

- Chunking.
- Cleaning.
- Token counting.
- Embedding.
- QA pair generation.
- Synthetic dataset generation.
- Dataset validation.
- Human review queues.

Future expansion:

- Pluggable Assembly Line steps.
- Visual workflow editor.
- Policy gates before training.
- Cost and runtime forecasting.

**Library Service**

Owns retrievable knowledge assets. A Library contains indexed chunks,
embeddings, citations, and retrieval configurations.

Responsibilities:

- Vector index registration.
- Retrieval settings.
- Citation mapping.
- Knowledge quality metrics.
- RAG test cases.

Future expansion:

- Multiple embedding models per Library.
- Hybrid search.
- Graph retrieval.
- Multi-modal retrieval.

**Forge Service**

Owns training jobs. A Forge is not only one training run; it is a work order for
turning Materials into a tuned Artifact.

Responsibilities:

- LoRA and QLoRA job configuration.
- Dataset selection.
- Hardware and queue planning.
- Training progress.
- Checkpoint capture.
- Failure recovery.
- Logs and teachable explanations.

Future expansion:

- Full fine tuning.
- Preference optimization.
- Distillation.
- Vision/speech/robotics training.
- Multi-node training.

**Artifact Service**

Owns trained outputs and model versions. Artifacts include checkpoints,
adapters, merged models, evaluation reports, quantized variants, tokenizer
snapshots, and exported bundles.

Responsibilities:

- Versioning.
- Lineage from Workshop, Materials, Assembly Line, and Forge.
- Metadata such as base model, adapter method, dataset hash, and metrics.
- Export/import.
- Archive publishing.

Future expansion:

- Model cards.
- Signed artifacts.
- Reproducibility manifests.
- Hugging Face publishing.
- Enterprise registry integration.

**Construct Service**

Owns inference runtimes. A Construct is a runnable AI system assembled from an
Artifact, prompt policy, retrieval Library, tools, and serving configuration.

Responsibilities:

- Streaming chat.
- Prompt and system behavior settings.
- Context window controls.
- Tool permissions.
- RAG attachment.
- Runtime metrics.

Future expansion:

- Batch inference.
- API endpoints.
- Multi-agent runtime.
- Vision and speech inference.
- Robotics control adapters.

**Academy Service**

Owns educational content and user learning state. This must be a first-class
service, not a tooltip-only afterthought.

Responsibilities:

- Concept catalog.
- Contextual lessons.
- Tooltips.
- Interactive diagrams.
- Completion and mastery state.
- Recommended next lesson based on user action.

Future expansion:

- Classroom mode.
- Quizzes and labs.
- Standards-aligned STEM curriculum.
- Teacher dashboards.

**Archive Service**

Owns reusable published assets: base model references, public Artifacts,
Workshop templates, Materials templates, Assembly Line recipes, and lesson
packs.

Responsibilities:

- Discovery.
- Versioned publishing.
- Import into a Workshop.
- Public/private visibility.
- License metadata.

Future expansion:

- Marketplace.
- Organization catalogs.
- Peer-reviewed STEM projects.

### System Boundaries

The backend should avoid one monolithic FastAPI service owning every workflow.
FastAPI should remain a transport layer that delegates to application services.

Recommended boundaries:

- API transport: FastAPI route handlers, schemas, auth, request validation.
- Application services: Workshop, Materials, Assembly Line, Forge, Library,
  Artifact, Construct, Academy, Archive.
- Orchestration workers: long-running ingestion, QA generation, indexing,
  training, evaluation, export.
- Runtime services: model loading, streaming inference, embeddings, tools.
- Storage adapters: filesystem, object storage, vector DB, relational DB,
  artifact registry.

This keeps the platform resilient. If training crashes, chat does not have to
crash. If an embedding job fails, the Workshop can still load. If the UI cannot
reach a worker, the API can report state rather than pretending the operation is
synchronous.

### Suggested Service Map

```text
frontend/
  Foundry UI
api/
  FastAPI transport
application/
  workshop_service
  materials_service
  assembly_line_service
  library_service
  forge_service
  artifact_service
  construct_service
  academy_service
workers/
  ingestion_worker
  qa_generation_worker
  embedding_worker
  training_worker
  evaluation_worker
runtime/
  model_runtime
  retrieval_runtime
  tool_runtime
storage/
  database
  object_store
  vector_store
  artifact_store
```

## 2. Foundry Domain Language

### Product Vocabulary

| Legacy / Technical Term | Foundry Term | Notes |
| --- | --- | --- |
| Project | Workshop | Primary user workspace. |
| Source files | Materials | Raw inputs: CSV, PDF, web, transcripts, media-derived text. |
| Dataset | Material Set | Use when data is curated and ready for training or evaluation. |
| Data pipeline | Assembly Line | User-facing workflow that transforms Materials. |
| Pipeline step | Station | A specific step such as chunking, tokenizing, embedding, QA generation. |
| Training job | Forge | A training work order. |
| Training queue | Forge Queue | Pending and active Forges. |
| Model checkpoint | Artifact | Versioned output from a Forge. |
| Model repository | Archive | Shared registry of reusable Artifacts and templates. |
| Knowledge base | Library | Indexed knowledge for retrieval and citations. |
| RAG | Library-augmented Construct | Use RAG internally; explain it educationally. |
| Experiment | Prototype | Exploratory Workshop variant. |
| Inference endpoint | Construct | Runnable AI system assembled from Artifact, Library, tools, and settings. |
| Eval run | Trial | A structured evaluation of a Construct or Artifact. |
| Prompt template | Blueprint | Reusable instruction/prompt structure. |
| Model card | Artifact Card | Human-readable summary of an Artifact. |
| Job logs | Forge Notes | User-facing logs plus explanations. |

### Internal Service Names

Use clear technical names internally. The foundry metaphor should help users,
not obscure engineering:

- `WorkshopService`
- `MaterialService`
- `AssemblyLineService`
- `LibraryService`
- `ForgeService`
- `ArtifactService`
- `ConstructService`
- `AcademyService`
- `ArchiveService`
- `EvaluationService`
- `ModelRuntimeService`
- `EmbeddingService`
- `DatasetGenerationService`

### API Naming Conventions

Use versioned REST paths with product nouns:

```text
/api/v1/workshops
/api/v1/workshops/{workshop_id}/materials
/api/v1/workshops/{workshop_id}/assembly-lines
/api/v1/workshops/{workshop_id}/library
/api/v1/workshops/{workshop_id}/forges
/api/v1/workshops/{workshop_id}/artifacts
/api/v1/workshops/{workshop_id}/constructs
/api/v1/workshops/{workshop_id}/trials
/api/v1/academy/concepts
/api/v1/archive/artifacts
```

Use verbs only for true commands:

```text
POST /api/v1/workshops/{id}/materials:ingest
POST /api/v1/workshops/{id}/assembly-lines/{id}:run
POST /api/v1/workshops/{id}/forges/{id}:start
POST /api/v1/workshops/{id}/constructs/{id}:chat
POST /api/v1/workshops/{id}/artifacts/{id}:publish
```

Streaming should be explicit:

```text
WS /api/v1/constructs/{construct_id}/chat/stream
```

### Database Naming Conventions

Database tables should be technical, plural, and stable:

- `workshops`
- `materials`
- `material_sources`
- `material_chunks`
- `material_sets`
- `assembly_lines`
- `assembly_line_runs`
- `stations`
- `library_indexes`
- `embedding_records`
- `forges`
- `forge_runs`
- `training_checkpoints`
- `artifacts`
- `artifact_versions`
- `constructs`
- `construct_sessions`
- `construct_messages`
- `trials`
- `trial_results`
- `academy_concepts`
- `academy_events`
- `archive_entries`

Avoid storing metaphor-only names in infrastructure tables when a technical name
is clearer. For example, use `training_checkpoints`, not `artifact_sparks`.

## 3. UI/UX Rebrand Plan

### Navigation Structure

Primary navigation:

- Workshop
- Materials
- Assembly Line
- Forge
- Library
- Archive
- Academy

Secondary runtime navigation:

- Construct
- Trials
- Settings

Recommended first release shell:

```text
Left rail:
  Workshops
  Materials
  Assembly Line
  Forge
  Library
  Archive
  Academy

Center:
  Current task workspace

Right inspector:
  Contextual metrics
  Educational explanations
  Active configuration
```

### User Flow

1. User creates a Workshop.
2. User defines the learning/build target, such as "Paw Patrol" and "Marshall".
3. User uploads Materials.
4. The Assembly Line parses, cleans, chunks, tokenizes, embeds, and generates QA
   pairs.
5. The user reviews Material Sets and sees quality warnings.
6. The user opens a Forge and selects LoRA or QLoRA.
7. The Forge trains and produces Artifacts.
8. The user runs Trials to compare Artifacts.
9. The user assembles a Construct for chat or API use.
10. The Academy panel explains each step in context.

### UI Tone

The Foundry should feel capable, calm, and hands-on:

- Dense enough for real work.
- Friendly enough for learners.
- Transparent about what the system is doing.
- Family friendly in language and defaults.
- Avoid hype words and black-box claims.
- Prefer "Here is what this step changes" over "AI magic."

### First Screen

The first screen should be the active Workshop, not a marketing landing page.
The user should immediately see:

- Current Workshop.
- Materials status.
- Assembly Line status.
- Forge status.
- Latest Artifact.
- Construct chat/test area.
- Academy tip for the current step.

## 4. Educational System

The Academy is the embedded learning system. It should follow the user through
the build rather than living as disconnected documentation.

### Contextual Learning Primitives

**Tooltips**

Use for short definitions and just-in-time explanations:

- Tokenization.
- Embeddings.
- Context window.
- Temperature.
- Top-p.
- Epoch.
- Learning rate.
- LoRA.
- QLoRA.
- Quantization.

**Concept Cards**

Use for one-screen explanations tied to the current task. Example: when the user
starts a Forge, show a card explaining that LoRA trains small adapter weights
instead of changing the full base model.

**Interactive Diagrams**

Use for processes:

- Raw Materials to chunks.
- Chunks to embeddings.
- QA generation flow.
- Prompt plus retrieved context plus model response.
- Base model plus adapter equals Artifact.

**Token Visualizer**

Show how text becomes tokens. This can be a simple colored token split at first,
then evolve into tokenizer-specific IDs and counts.

**Attention Explorer**

Show simplified attention maps for small examples. This should be carefully
scoped and educational, not presented as full interpretability truth.

**Layer Visualizer**

Show model components:

- Embedding layer.
- Attention blocks.
- MLP/feed-forward blocks.
- Normalization.
- Output logits.

**Training Progress Explainer**

Alongside loss charts and metrics, explain:

- Why loss can go down but quality can still be poor.
- Why overfitting happens.
- Why validation examples matter.
- Why more epochs are not always better.

**Mistake Lens**

When a Construct gives a bad answer, let the user inspect possible causes:

- Missing Material.
- Bad chunking.
- Weak QA pair.
- Retrieval miss.
- Prompt mismatch.
- Under-trained adapter.
- Overfit adapter.

### Academy Data Model

Recommended concept fields:

- `concept_id`
- `title`
- `short_definition`
- `long_explanation`
- `difficulty`
- `related_station`
- `related_ui_surface`
- `interactive_component_type`
- `prerequisite_concept_ids`
- `example_prompt`
- `example_material`

### Learning Events

Track events without making the product feel like homework:

- Viewed concept.
- Completed interactive demo.
- Used concept in a Workshop.
- Revisited explanation after an error.
- Compared two Artifacts.

This enables optional learning paths and classroom support.

## 5. Repository Refactor Plan

### Migration Principles

- Minimize breaking changes.
- Keep `EMA` import compatibility until the new package is stable.
- Rebrand user-facing text first.
- Rename internal packages only after service boundaries are clear.
- Add API versioning before public release.
- Keep generated artifacts out of git.

### Target Folder Structure

```text
foundry/
  api/
    v1/
  application/
    workshops/
    materials/
    assembly_lines/
    libraries/
    forges/
    artifacts/
    constructs/
    academy/
    archive/
  workers/
    ingestion/
    generation/
    embedding/
    training/
    evaluation/
  runtime/
    models/
    retrieval/
    tools/
  storage/
    database/
    vector_store/
    artifact_store/
  configs/
  frontend/
  scripts/
  tests/
docs/
```

### Current-to-Target Mapping

| Current Area | Target Area |
| --- | --- |
| `EMA/backend` | `foundry/api` and `foundry/application` |
| `EMA/backend/services` | `foundry/application/constructs` initially |
| `EMA/ingestion_layer` | `foundry/workers/ingestion` |
| `EMA/data_cleaning` | `foundry/workers/generation` and `foundry/application/materials` |
| `EMA/data_layer` | `foundry/storage` and `foundry/application/libraries` |
| `EMA/embedding` | `foundry/workers/embedding` |
| `EMA/expansion_layer` | `foundry/workers/generation` |
| `EMA/fine_tuning_layer` | `foundry/workers/training` and `foundry/application/forges` |
| `EMA/model_layer` | `foundry/runtime/models` and `foundry/application/constructs` |
| `EMA/distributed_processing` | `foundry/workers` |
| `EMA/ray_cluster` | `foundry/infrastructure/compute` |
| `EMA/frontend` | `foundry/frontend` or root `frontend` |
| `EMA/workspace_one_workflows` | Remove, isolate as sample connector, or move to optional plugin |

### Step-by-Step Migration

1. Rebrand README, UI labels, and public docs to The Foundry.
2. Add `docs/the_foundry_product_architecture.md`.
3. Introduce API version prefix `/api/v1`.
4. Add application service interfaces under the current package without moving
   everything at once.
5. Move chat orchestration into `ConstructService`.
6. Create `WorkshopService` and persist Workshop metadata.
7. Create `MaterialService` and normalize uploaded/imported sources.
8. Wrap existing cleaning and QA code behind `AssemblyLineService`.
9. Wrap Chroma/vector helpers behind `LibraryService`.
10. Wrap LoRA/QLoRA training behind `ForgeService`.
11. Create `ArtifactService` for checkpoint metadata and lineage.
12. Add `AcademyService` and concept registry.
13. Add compatibility imports so old `EMA.*` imports keep working during
    migration.
14. Rename package from `EMA` to `foundry` once tests cover the service
    boundary.
15. Remove legacy Workspace ONE modules or extract them into an optional
    connector package.

### Namespace Changes

Short-term:

- Keep Python package `EMA`.
- Add Foundry service classes and user-facing labels.
- Avoid breaking imports.

Medium-term:

- Create `foundry` package.
- Add compatibility shims:

```python
# EMA/backend/api_server.py
from foundry.api.v1.server import app
```

Long-term:

- Remove `EMA` namespace after a documented deprecation window.

### API Versioning

All new endpoints should use `/api/v1`. Legacy endpoints can remain temporarily:

- `/chat`
- `/query`
- `/conversation/save`
- `/conversation/load`
- `/conversation/reset`

Add redirects or compatibility routes where practical, but document `/api/v1`
as the public contract.

### Database Migration Considerations

The current repo does not yet appear to have a formal relational schema. When a
database is introduced:

- Use migration tooling from the first public schema.
- Keep Workshop IDs stable.
- Store lineage for Materials, Assembly Line runs, Forges, Artifacts, Trials,
  and Constructs.
- Treat vector stores and model artifacts as external storage with database
  metadata pointers.
- Never store provider tokens in plaintext.
- Keep user secrets separate from Workshop export bundles.

## 6. Future Vision

The Foundry should become a general-purpose AI creation platform.

### Supported AI System Types

**LLMs**

- Chat Constructs.
- QA generation.
- Tool use.
- RAG.
- Fine tuning.
- Model comparison.

**Vision Models**

- Image classification.
- Object detection.
- OCR.
- Vision-language Materials.
- Multi-modal Constructs.

**Speech Models**

- Transcription.
- Voice datasets.
- Speech-to-text evaluation.
- Text-to-speech prototypes.

**Robotics**

- Simulation data.
- Policy learning.
- Sensor logs.
- Command generation.
- Safety-constrained agents.

**Agents**

- Tool registries.
- Multi-step workflows.
- Memory.
- Evaluation trials.
- Human approval gates.

**RAG**

- Library construction.
- Retrieval experiments.
- Citation-aware Constructs.
- Hybrid search.
- Retrieval evaluation.

**Multi-modal Systems**

- Shared Workshops containing text, image, audio, video, and sensor Materials.
- Assembly Lines with modality-specific Stations.
- Constructs that combine models and tools.

### Enterprise Capabilities

The platform should remain self-hostable while supporting enterprise needs:

- Role-based access control.
- Audit logs.
- Secret management.
- Artifact signing.
- Private Archive.
- Policy-controlled Materials.
- Deployment targets.
- Cost controls.
- Offline mode for air-gapped environments.

### Family-Friendly and STEM-Focused

Family-friendly does not mean simplistic. It means:

- Clear language.
- Safe defaults.
- Transparent data handling.
- Age-appropriate examples where needed.
- No unnecessary dark patterns.
- Curiosity-first explanations.

The product should let a learner build a Paw Patrol-style character model, a
teacher build a physics tutor, a hobbyist build a robotics controller, and an
enterprise team build a private domain assistant from the same conceptual
platform.

## Product North Star

The Foundry is where raw data becomes intelligence, and curiosity becomes
understanding.
