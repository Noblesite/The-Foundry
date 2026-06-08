#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRONTEND_DIR="$REPO_ROOT/EMA/frontend"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Frontend dependencies are missing. Run: cd EMA/frontend && npm ci" >&2
  exit 1
fi

cd "$FRONTEND_DIR"
exec npm run dev -- --host "${FOUNDRY_FRONTEND_HOST:-127.0.0.1}" --port "${FOUNDRY_FRONTEND_PORT:-5173}"
