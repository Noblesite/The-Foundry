#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

sh "$REPO_ROOT/scripts/setup_runtime_dirs.sh"

if [ -d "$REPO_ROOT/.venv" ]; then
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.venv/bin/activate"
fi

export PYTHONPATH="$REPO_ROOT/EMA${PYTHONPATH:+:$PYTHONPATH}"

if ! python3 -c "import uvicorn" >/dev/null 2>&1; then
  echo "Backend dependencies are missing. Run: pip install -r requirements.txt" >&2
  exit 1
fi

exec python3 -m uvicorn backend.api_server:app \
  --reload \
  --host "${FOUNDRY_API_HOST:-127.0.0.1}" \
  --port "${FOUNDRY_API_PORT:-8000}"
