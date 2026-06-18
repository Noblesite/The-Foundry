# Known Limitations

The Foundry MVP is a public, self-hostable starting point. It is designed to be
transparent about what is real, what is simulated, and what still needs hardening.

## Runtime Scope

- The default Forge runtime is simulated.
- The default Construct runtime is simulated.
- Real Transformers streaming and tiny LoRA proof paths are opt-in and require
  `requirements-ml.txt`.
- The official first-run proof avoids model downloads so new users can verify
  the app before installing heavy ML dependencies.

## Model Quality

- The deterministic QA generator is for smoke tests, not production datasets.
- Model-backed QA generation exists behind a runtime boundary, but useful QA
  quality depends on the selected local model and human review.
- `sshleifer/tiny-gpt2` is a compatibility smoke model, not a recommended
  assistant, training base, or quality benchmark.

## Ingestion

- Text, Markdown, CSV, JSONL/NDJSON, and text-based PDF paths are covered for
  the MVP proof.
- Scanned PDFs, robust website crawling, video processing, and multi-document
  extraction workers are post-MVP hardening areas.
- Uploaded or generated files stay local and should remain out of Git.

## Local Machine Fit

- Archive download, Construct load, and Forge start use readiness gates, but
  memory estimates are conservative.
- Large models can still fail depending on OS, device backend, quantization,
  driver/runtime support, and other active processes.
- Users should begin with cached tiny models before trying larger bases.

## Security And Data

- The app is intended for local/self-hosted development use at MVP stage.
- Production authentication, team isolation, audit logging, and enterprise
  authorization are not complete.
- Do not commit Hugging Face tokens, private datasets, generated JSONL exports,
  local databases, model weights, or checkpoints.
- Diagnostics should remain redacted before sharing.

## Deployment

- The MVP is optimized for local development.
- Packaged installers, containers, managed upgrades, and production deployment
  runbooks are post-MVP.
- SQLite is the local catalog path; multi-user database deployment still needs
  design and migration hardening.

## Education Layer

- The Academy/tooltips explain the main workflow concepts in context.
- Advanced interpretability such as real attention heatmaps, activation views,
  and layer-level model inspection is post-MVP.

## Scope Guard

If a feature does not strengthen the proven path from Material to Trial, it
should wait until after the public MVP tag.
