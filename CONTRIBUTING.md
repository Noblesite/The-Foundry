# Contributing To The Foundry

Thank you for helping build The Foundry.

This project is early, so the most useful contributions are focused, documented,
and easy to review.

## Development Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd EMA/frontend
npm ci
```

Run the public baseline before opening a pull request:

```bash
make check
```

## Local App

Backend:

```bash
make dev-backend
```

Frontend:

```bash
make dev-frontend
```

## Contribution Guidelines

- Keep user-facing language in The Foundry domain unless touching legacy code.
- Keep backend contracts under `/api/v1` stable unless the change is explicitly
  a contract migration.
- Keep model downloads, generated datasets, runtime SQLite files, vector stores,
  and checkpoints out of git.
- Prefer simulator or adapter boundaries for expensive AI workflows.
- Include docs or tooltips when adding concepts users are expected to learn.
- Keep pull requests narrow enough to review.

## Testing Expectations

At minimum:

```bash
make smoke
cd EMA/frontend && npm run lint && npm run build
```

For backend API changes, add or update a focused probe or test that exercises the
contract without requiring a model download.

For frontend behavior changes, prefer typed fixtures from
`EMA/frontend/src/domain/foundry.ts` and keep mock data aligned with the API
contract.

## Public Data Rules

Do not commit:

- `.env` files.
- API tokens or private keys.
- Customer or production datasets.
- Generated JSONL exports.
- Model checkpoints or adapter weights.
- Local SQLite databases.
- Virtual environments or dependency folders.

Use `.env.example` files and ignored `EMA/runtime/` paths instead.
