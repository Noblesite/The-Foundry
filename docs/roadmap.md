# The Foundry Roadmap

The Foundry is being rebuilt from the E.M.A. prototype into a STEM-first AI
creation platform. This roadmap favors usable, teachable slices over hidden
complexity.

## Phase 1: Public Bootstrap

- Clean public repository history.
- Root README, local dev scripts, contribution guide, security policy, license.
- Smoke checks that avoid model downloads.
- Clear current-status labeling for simulated versus real workflows.

## Phase 2: Workflow Contracts

- Stabilize frontend domain models.
- Keep the FastAPI `/api/v1` contracts aligned with frontend expectations.
- Preserve mock mode for offline UI work.
- Add contract probes for Workshop, Material, Assembly Line, Forge, Artifact,
  and Construct flows.

## Phase 3: Real Forge Adapter

- Define a trainer adapter interface. Done for the first contract slice.
- Keep simulator as the default Forge runtime. Done for the first contract slice.
- Write Forge contracts and event logs under ignored runtime storage. Done for
  the first worker skeleton slice.
- Add a local LoRA/QLoRA worker behind the adapter.
- Emit durable job events and metrics.
- Produce Artifact metadata from real trainer output.

## Phase 4: Ingestion Workers

- Add file upload contracts.
- Add text, CSV, website, PDF, transcript, and video-transcript workers.
- Add QA review states: draft, accepted, rejected, exported.
- Keep generated Materials in ignored runtime storage.

## Phase 5: Construct Runtime

- Expand the runtime adapter for local model loading.
- Support streaming token output from loaded local models.
- Add prompt presets, response inspection, and persisted Trial verdicts. Done
  for the first Construct testing bench and Trial persistence slices.
- Export reviewed Trials as JSONL Materials so they can feed Forge training or
  evaluation runs. Done for the first Trial review/export slice.
- Add a Forge purpose switch for training versus evaluation contracts. Done
  for the first Trial-backed Forge preset slice.
- Render completed evaluation Forges as Trial Reports with pass-rate metrics,
  sample checks, and next-step recommendations. Done for the first simulated
  evaluator report slice.
- Surface completed Forge Trial Reports from the Trials station so evaluation
  history is visible outside the Forge drawer. Done for the first report
  history slice.
- Add runtime health, memory pressure, and unload behavior.
- Teach users what context windows, sampling, and quantization settings do.

## Phase 6: Learning System

- Add contextual tooltips and deep links from every major workflow step.
- Add token visualizers and chunk visualizers.
- Add LoRA/QLoRA explainers tied to actual Forge configuration.
- Add training metric explainers for loss, epochs, learning rate, and evals.

## Phase 7: Production Readiness

- Add authentication and workspace isolation.
- Add upload validation and artifact scanning.
- Add SQL-backed catalog migrations.
- Add background job workers.
- Add structured logging and audit events.
- Add container deployment.

## Future Tracks

- Vision model workflows.
- Speech model workflows.
- Agent prototypes.
- RAG experiments.
- Multi-modal Materials.
- Robotics and sensor-driven Constructs.
