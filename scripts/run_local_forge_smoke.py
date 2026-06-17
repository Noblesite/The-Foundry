#!/usr/bin/env python3
"""Prepare and optionally run a tiny local Forge LoRA proof."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPO_ROOT / "EMA"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from backend.services.forge_smoke_service import LocalForgeSmokeService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService


async def prepare_smoke_forge(*, run_training: bool) -> dict:
    service = LocalForgeSmokeService(
        catalog_service=FoundryCatalogService(),
        forge_training_service=ForgeTrainingService(),
    )
    return await service.prepare(run_training=run_training)


def _print_summary(result: dict) -> None:
    preflight = result["preflight"]
    print("Local Forge smoke fixture")
    print(f"  Workshop: {result['workshop']['id']} ({result['workshop']['name']})")
    print(f"  Material: {result['material']['id']} -> {result['material']['sourceUri']}")
    print(f"  Forge:    {result['forgeRun']['id']} ({result['forgeRun']['status']})")
    print(f"  Model:    {preflight['model']['baseModel']}")
    print(f"  Preflight: {preflight['status']} / ok={preflight['ok']}")
    for check in preflight["checks"]:
        print(f"    [{check['status']}] {check['label']}: {check['detail']}")

    if result.get("blocked"):
        print("  Training not run. Blocked checks:")
        for check in result["blocked"]:
            print(f"    - {check['label']}: {check['detail']}")
    elif result["ranTraining"]:
        metrics = result["workerState"]["metrics"]
        print(f"  Training completed: loss={metrics.get('loss')} adapter={metrics.get('adapterPath')}")
        if result.get("artifact"):
            artifact = result["artifact"]
            print(f"  Artifact: {artifact['id']} adapter={artifact.get('adapterPath')}")
    else:
        print("  Training not run. Re-run with --run after preflight passes.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run",
        action="store_true",
        help="Run the local LoRA trainer after preflight passes.",
    )
    args = parser.parse_args()

    result = asyncio.run(prepare_smoke_forge(run_training=args.run))
    _print_summary(result)
    return 1 if result.get("blocked") else 0


if __name__ == "__main__":
    raise SystemExit(main())
