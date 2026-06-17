# Forge Runtime Adapter

The Forge runtime adapter is the boundary between The Foundry product workflow
and the expensive model-training implementation.

The user-facing flow remains:

```text
Material -> Forge -> Artifact
```

Internally, a queued Forge creates a durable training contract:

```text
foundry.forge.training.v1
```

The contract contains:

- Forge run id.
- Workshop id.
- JSONL Material id and dataset URI.
- Base model.
- LoRA or QLoRA method.
- Epoch count.
- Learning rate.
- 4-bit loading preference.
- Output directory for the future Artifact.
- Runtime metadata.

## Worker Files

Every queued Forge may write a local worker folder:

```text
EMA/runtime/forges/{forgeRunId}/contract.json
EMA/runtime/forges/{forgeRunId}/events.jsonl
EMA/runtime/forges/{forgeRunId}/metrics.json
```

These files are intentionally ignored by git. They make the simulator behave
like a real worker: a Forge has an executable contract, durable events, and
metrics that the UI can poll.

The Forge queue polls worker state while jobs are queued or running. Manual
refresh remains available for older Forge rows that predate worker files or for
operators who want to inspect the latest contract state on demand.

The queue also exposes a Forge detail drawer. It lets operators inspect the
event timeline, the durable training contract, and the latest worker metrics
without leaving the Forge station.

Simulator controls can advance one step at a time or run a Forge to completion
so local demos can exercise the full Material -> Forge -> Artifact loop.
Completed Forges can hand their Artifact directly to Construct; older completed
rows without Artifact metadata are repaired before the Construct load.

The worker detail drawer can also run the explicit local trainer adapter when
the Forge runtime is configured to `local` and dependencies are ready. This is
an opt-in operator action because it can load models and use CPU, GPU, or Apple
Metal memory.

Before that action is enabled, the drawer can run a local trainer preflight.
The preflight checks runtime mode, dependency availability, LoRA-only settings,
JSONL Material validity, tiny proof row count, cached Archive model path, and a
conservative memory estimate.

For an end-to-end local proof, use:

```text
.venv/bin/python scripts/run_local_forge_smoke.py
.venv/bin/python scripts/run_local_forge_smoke.py --run
```

The first command creates a one-row JSONL Material, queues a LoRA Forge, and
prints the preflight result. The second command runs the trainer only after the
same preflight passes. Cache `sshleifer/tiny-gpt2` in the Archive before using
`--run`.

The Forge station exposes the same flow as `Preflight Tiny Proof` and
`Run Tiny Forge Proof` in the Trainer Adapter panel. The training step runs in
an isolated worker process so native Torch/PEFT teardown cannot take down the
API server after adapter files and metrics have been written.

After the UI proof creates an Artifact, the Forge station loads it into
Construct and sends a tiny response test. This validates the full local chain:
Archive -> Material -> Forge -> Artifact -> Construct.

For older rows or interrupted local development runs, the drawer can reconcile
worker state. Reconciliation rebuilds the training contract from catalog data,
validates the JSONL Material, and restores worker metrics/events without
changing the catalog row.

Simulator event types:

- `queued`
- `dataset_validated`
- `dataset_validation_failed`
- `epoch_started`
- `step_completed`
- `artifact_planned`
- `completed`

## Runtime Modes

`simulated`

The default. It advances progress deterministically and lets the product flow
complete without downloading models or requiring GPU packages.

`local`

The adapter checks whether baseline local-training dependencies are importable
and can execute tiny LoRA jobs from the durable Forge contract. The MVP trainer
requires a cached Archive model path unless
`FOUNDRY_FORGE_ALLOW_REMOTE_MODEL_DOWNLOAD=1` is set. QLoRA and 4-bit loading
remain guarded until the dedicated quantized trainer path lands.

## API Surface

```text
GET  /api/v1/forges/runtime
POST /api/v1/forges/runtime/configure
GET  /api/v1/forges/{forge_run_id}/contract
GET  /api/v1/forges/{forge_run_id}/events
POST /api/v1/forges/{forge_run_id}/worker/reconcile
POST /api/v1/forges/{forge_run_id}/worker/preflight-local
POST /api/v1/forges/{forge_run_id}/worker/run-local
POST /api/v1/forges/smoke-proof
POST /api/v1/workshops/{workshop_id}/forges
POST /api/v1/forges/{forge_run_id}/simulate
```

The `POST /api/v1/workshops/{workshop_id}/forges` response includes
`trainingContract` so the frontend and future workers can inspect exactly what
will be executed.

Forge contracts include a `purpose` field:

- `training` produces an Artifact when the Forge completes.
- `evaluation` validates and scores examples without creating an Artifact.

Trial-exported JSONL Materials should usually run with `purpose: "evaluation"`
so reviewed Construct replies become eval data before they become training data.
Completed evaluation Forges publish a `foundry.forge.evaluation.v1` Trial
Report inside worker metrics. The report includes pass-rate counts, rubric
scores, sample prompt checks, and recommendations so the operator can decide
whether to train again, promote an Artifact, or add better Materials.

## Design Rule

FastAPI owns HTTP validation and response envelopes. It should not own training
execution. Real training should live behind `ForgeTrainingService` or a worker
that consumes the same contract.
