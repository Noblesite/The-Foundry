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

The adapter checks whether baseline local-training dependencies are importable.
It does not launch training yet. This mode is the staging point for a future
worker that will execute the same contract with real LoRA/QLoRA code.

## API Surface

```text
GET  /api/v1/forges/runtime
POST /api/v1/forges/runtime/configure
GET  /api/v1/forges/{forge_run_id}/contract
GET  /api/v1/forges/{forge_run_id}/events
POST /api/v1/forges/{forge_run_id}/worker/reconcile
POST /api/v1/workshops/{workshop_id}/forges
POST /api/v1/forges/{forge_run_id}/simulate
```

The `POST /api/v1/workshops/{workshop_id}/forges` response includes
`trainingContract` so the frontend and future workers can inspect exactly what
will be executed.

## Design Rule

FastAPI owns HTTP validation and response envelopes. It should not own training
execution. Real training should live behind `ForgeTrainingService` or a worker
that consumes the same contract.
