#!/usr/bin/env python3
"""Execute one Forge training contract in an isolated process."""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPO_ROOT / "EMA"
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from backend.services.forge_training_service import ForgeTrainingService


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: run_forge_contract_worker.py <forge_run_id>", file=sys.stderr)
        return 2

    os.environ["FOUNDRY_FORGE_RUNTIME_MODE"] = "local"
    os.environ.setdefault("FOUNDRY_FORGE_TRAIN_DEVICE", "cpu")
    forge_run_id = sys.argv[1]
    forge = ForgeTrainingService()
    contract = forge.get_contract(forge_run_id)
    if contract is None:
        print(f"Forge contract was not found: {forge_run_id}", file=sys.stderr)
        return 1
    forge.execute_local_training(contract)
    metrics = forge.get_metrics(forge_run_id)
    print(f"completed {forge_run_id} loss={metrics.get('loss')} adapter={metrics.get('adapterPath')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
