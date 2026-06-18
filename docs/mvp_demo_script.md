# MVP Demo Script

This is the smallest honest demo for The Foundry public MVP.

It proves the teachable loop without downloading models or requiring optional
ML packages:

```text
Workshop -> Material -> QA Review -> JSONL Material -> Forge -> Artifact -> Construct -> Trial
```

The demo uses simulated Forge and Construct runtime paths. That is intentional:
the goal is to prove product handoffs, persisted records, review states, and
operator safety before asking a first-time user to install Torch or download a
model.

## 1. Start The App

Terminal 1:

```bash
source .venv/bin/activate
make dev-backend
```

Terminal 2:

```bash
cd EMA/frontend
VITE_FOUNDRY_DATA_SOURCE=api npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## 2. Run The Automated Proof

With the backend running:

```bash
make mvp-demo
```

If your backend runs on a non-default port:

```bash
FOUNDRY_API_BASE_URL=http://127.0.0.1:8011 make mvp-demo
```

Expected result:

```text
PASS: live Foundry MVP rehearsal completed.
```

The command prints the Workshop, Material, Assembly Line, Forge, Artifact,
Construct, Message, and Trial IDs it created.

## 3. Walk The UI

Use the generated Workshop in the left rail, then check these stations:

1. Materials: confirm the tiny source Material, generated chunks, QA pair, and
   exported JSONL Material.
2. Forge: confirm the Forge row, worker events, contract, and simulated
   completion.
3. Artifacts: confirm the created Artifact and readiness state.
4. Construct: confirm the Artifact is loadable and the reply is visibly
   simulated when no local model runtime is active.
5. Trials: confirm the saved pass verdict and prompt/response record.
6. Academy and right rail: confirm learning content explains the concepts while
   staying out of the operator flow.

## 4. What Success Means

Success means the public MVP has a complete, reproducible, local workflow:

- The API is reachable.
- Local catalog persistence works.
- A source Material can become reviewed QA.
- Reviewed QA can become JSONL training Material.
- A Forge contract can create an Artifact record.
- A Construct can reply from that Artifact path.
- A Trial can save a human verdict.

It does not mean the model is high quality yet. Real model quality requires
optional ML dependencies, cached model weights, better source material, and
human review of generated QA pairs.
