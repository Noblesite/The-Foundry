# The Foundry Frontend

The Foundry frontend is a React, TypeScript, and Vite console for building and
learning AI workflows.

## Local Development

From the repository root:

```bash
make dev-frontend
```

Or from this directory:

```bash
npm ci
npm run dev
```

The default development URL is:

```text
http://127.0.0.1:5173
```

## Data Sources

Use `EMA/frontend/.env` to select the data source:

```bash
VITE_BACKEND_URL=http://127.0.0.1:8000
VITE_FOUNDRY_DATA_SOURCE=mock
```

Options:

- `mock`: offline UI work with local mock Foundry data.
- `api`: hydrate from the FastAPI `/api/v1` backend.

## Checks

```bash
npm run lint
npm run build
```

The frontend uses local Space Grotesk font files under
`public/fonts/space-grotesk` so the Foundry visual style works offline.
