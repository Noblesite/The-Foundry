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
