# Release Notes: v0.1.1-mvp

This patch MVP marker keeps the public release candidate honest after the
browser-backed workflow rehearsal.

The release still proves the local, teachable AI-building loop:

```text
Workshop -> Material -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial
```

## Changes Since v0.1.0-mvp

- Switched The Foundry from MIT to `AGPL-3.0-or-later` for new development.
- Added a license policy that explains the project intent: self-hosting,
  learning, paid support, and commercial use are allowed within AGPL
  source-sharing obligations, while closed-source hosted forks are not aligned
  with the license intent.
- Blocked unreadable Material source paths from creating estimated placeholder
  chunks.
- Added contract coverage so missing source files fail loudly instead of
  producing misleading training evidence.
- Added a no-download QA generator cache-loop rehearsal for blocked preflight,
  local Archive cache readiness, runtime configure, and backend-local
  model-backed proof contracts.
- Added a public release checklist for future MVP/release candidates.

## Browser Rehearsal Evidence

A browser-backed rehearsal against the local FastAPI console validated:

- Fresh Workshop creation.
- Text Material staging from a runtime-relative source path.
- Assembly Line chunking from real source text.
- QA Review accept/override path for deterministic smoke rows.
- JSONL preview with source-reference metadata.
- JSONL Material export.
- Forge handoff from exported JSONL Material.
- Simulated Forge completion and Artifact creation.
- Construct load in explicit simulated/fallback mode.
- Construct reply capture as a Trial.
- Trials station display with simulated runtime labeling and filters.
- QA generator cache-loop proof using `make qa-generator-cache-loop`, with no
  network calls or model downloads.

## Validation

The release-prep pass validated:

- `make check`
- `make qa-generator-cache-loop`
- `git diff --check`
- Browser-backed MVP workflow rehearsal
- Remote `foundry/development` matching the local release candidate commit

## Known Limits

- The default Forge and Construct runtimes remain simulated.
- Deterministic QA remains smoke/demo output, not production-quality training
  data.
- QA generator cache-loop proof validates contracts and readiness handoffs, not
  final model quality.
- Optional local model streaming and tiny LoRA proof paths require
  `requirements-ml.txt`.
- Production auth, team isolation, packaged deployment, robust crawling, video
  processing, and enterprise hardening are post-MVP.

See [Known Limitations](known_limitations.md) for the full boundary.
