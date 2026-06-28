# Public Release Checklist

Use this checklist before merging the `development` branch into a public release
branch or tagging an MVP marker.

The goal is not to claim The Foundry is finished. The goal is to make sure a
new technical user can run the honest local learning loop and understand which
parts are real, simulated, optional, or still under construction.

## Branch Review

- Confirm the branch is pushed to `foundry/development`.
- Open a pull request against the intended public branch.
- Review the diff for generated files, private paths, tokens, model weights,
  local databases, JSONL exports, adapter outputs, and runtime logs.
- Keep changes focused enough that the public story is reviewable.
- Do not merge if the README, known limitations, and release notes disagree
  about what is supported.

## Required Baseline Checks

Run these from the repository root:

```bash
make check
git diff --check
```

`make check` must remain no-download and should not require optional ML packages.

Expected coverage:

- Python smoke checks.
- Backend workflow contract rehearsals.
- FastAPI workflow contract rehearsals.
- Archive and Construct diagnostics contract checks.
- Frontend build, lint, and sentinel tests.

## Live MVP Rehearsal

With the backend running, prove the handoff path:

```bash
make mvp-demo
```

The demo should prove:

- Workshop creation.
- tiny Material import.
- QA generation/review/export.
- JSONL Material creation.
- Forge simulator completion.
- Artifact creation.
- Construct load/reply.
- Trial save.

This path is allowed to use deterministic QA and simulated Forge/Construct
runtimes as long as those modes are clearly labeled.

## Optional ML Proofs

Only run these after installing `requirements-ml.txt` and caching the tiny model:

```bash
make ml-proof-preflight
make ml-proof
make construct-adapter-proof
```

These commands are optional release evidence. They should never become a
baseline requirement for first-time users.

## Public Claim Audit

Before merge, confirm these docs tell the same story:

- `README.md`
- `docs/known_limitations.md`
- `docs/first_run_setup.md`
- `docs/mvp_demo_script.md`
- `docs/release_notes_v0.1.0-mvp.md`
- `docs/mvp_missing_features.md`
- `docs/roadmap.md`

The public claim audit should verify:

- Simulated Forge and Construct defaults are named plainly.
- Deterministic QA is described as a smoke/fallback path, not quality training
  data.
- `sshleifer/tiny-gpt2` is described as a compatibility proof model only.
- Optional ML dependencies are separated from baseline setup.
- Model downloads remain opt-in.
- Local runtime outputs stay under ignored `EMA/runtime/` paths.
- Old E.M.A. module names are either intentionally documented or identified as
  cleanup candidates.

## UI Review

Open the frontend against the API-backed mode when possible and spot-check:

- Workshop selector stays visible in the header.
- Runtime Metrics drawer can be opened and closed.
- Tooltips render above the main workbench panels.
- Materials, Forge, Artifacts, Construct, Trials, Academy, and Settings avoid
  white-on-white form fields.
- Simulated, fallback, adapter-backed, and live-local runtime states are visible
  where users make decisions.
- Trial filters distinguish simulated, live-local, adapter-backed, and
  needs-review results.

## Data And Safety Review

Do not merge if the diff includes:

- Hugging Face tokens or usernames with secrets.
- `.env` files.
- Private datasets.
- Generated JSONL Materials.
- SQLite catalog files.
- Model weights.
- Adapter/checkpoint outputs.
- Raw diagnostics with sensitive local values.

Diagnostics shown to users or exported for support should remain redacted.

## Roadmap Guard

Keep these as roadmap items unless they directly unblock the MVP loop:

- RAG as a Forge learning path.
- Attention/QKV activation heat maps.
- Robust crawling and video processing.
- Production auth and team isolation.
- SQL migration hardening beyond the local SQLite catalog.
- Packaged installers and container deployment.

## Merge Criteria

The branch is ready to merge when:

- `make check` passes.
- `git diff --check` passes.
- `make mvp-demo` passes against a running backend or the reason it was skipped
  is documented in the PR.
- Public docs agree on supported, simulated, optional, and missing behavior.
- The PR has no secrets, runtime artifacts, generated datasets, or model files.
- The recommended next implementation slice is recorded in the PR or release
  notes.
