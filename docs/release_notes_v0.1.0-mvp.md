# Release Notes: v0.1.0-mvp

This is the first public MVP marker for The Foundry.

The release proves the local, teachable AI-building loop:

```text
Workshop -> Material -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial
```

## Highlights

- Foundry-branded React/Vite frontend with Workshop, Materials, Forge,
  Artifacts, Construct, Library, Trials, Academy, and Settings stations.
- FastAPI `/api/v1` contracts for the core workflow.
- SQLite-backed local catalog for Workshops, Materials, Assembly Lines, QA
  pairs, Forges, Artifacts, Constructs, Trials, Archive entries, and runtime
  events.
- Source Material ingestion proof for text, Markdown, CSV, JSONL/NDJSON, and
  text-based PDFs.
- QA review and JSONL export flow for training-ready Materials.
- Forge contract creation, worker events, simulated progress, Artifact creation,
  and local trainer adapter boundaries.
- Construct runtime controls, explicit simulated/Transformers modes, runtime
  diagnostics, and no-silent-fallback behavior for real local inference.
- Unified readiness gate for Archive download, Construct load, and Forge start.
- Contextual Academy learning content and tooltips woven through the workflow.

## Demo

After baseline setup and with the backend running:

```bash
make mvp-demo
```

The command checks API health, creates a timestamped Workshop, imports a tiny
Material, generates/reviews QA, exports JSONL, runs the Forge simulator, creates
an Artifact, loads Construct, saves a Trial, and prints the created IDs.

## Validation

The MVP release-prep pass validated:

- `make check`
- `git diff --check`
- `make mvp-demo` against a live local backend
- Browser pass across the main workbenches
- Desktop, tablet, and mobile layout checks for form controls and tooltips

## Known Limits

- The default Forge and Construct runtimes are simulated.
- Optional local model streaming and tiny LoRA proof paths require
  `requirements-ml.txt`.
- Model quality is not the goal of this marker; the goal is a reproducible,
  honest product loop.
- Production auth, team isolation, packaged deployment, robust crawling, video
  processing, and enterprise hardening are post-MVP.

See [Known Limitations](known_limitations.md) for the full boundary.
