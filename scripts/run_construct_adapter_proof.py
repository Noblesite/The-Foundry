#!/usr/bin/env python3
"""Run a tiny Forge adapter through Construct and save a Trial."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPO_ROOT / "EMA"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from backend.services.construct_inference_service import ConstructInferenceService
from backend.services.forge_smoke_service import LocalForgeSmokeService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService


class ProofError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProofError(message)


async def run_proof() -> dict[str, Any]:
    os.environ["FOUNDRY_FORGE_RUNTIME_MODE"] = "local"
    os.environ["FOUNDRY_FORGE_TRAIN_DEVICE"] = os.getenv("FOUNDRY_FORGE_TRAIN_DEVICE", "cpu")
    os.environ["FOUNDRY_CONSTRUCT_INFERENCE_MODE"] = "transformers"
    os.environ["FOUNDRY_CONSTRUCT_DEVICE"] = os.getenv("FOUNDRY_CONSTRUCT_DEVICE", "cpu")

    catalog = FoundryCatalogService()
    forge = ForgeTrainingService()
    construct_runtime = ConstructInferenceService()
    smoke = LocalForgeSmokeService(catalog, forge)

    started_at = datetime.now(timezone.utc).isoformat()
    smoke_result = await smoke.prepare(run_training=True)
    require(smoke_result["ranTraining"], "Tiny Forge training did not run.")
    artifact = smoke_result.get("artifact")
    require(bool(artifact), "Tiny Forge proof did not register an Artifact.")
    readiness = artifact.get("readiness") or {}
    require(readiness.get("artifactKind") == "lora-adapter", "Proof Artifact is not a LoRA adapter.")
    require(readiness.get("canLoad") is True, readiness.get("message") or "Artifact cannot load.")

    construct = await catalog.load_artifact_into_construct(
        workshop_id=artifact["workshopId"],
        artifact_id=artifact["id"],
    )
    await construct_runtime.configure(
        mode="transformers",
        model_id=artifact["baseModel"],
        device=os.getenv("FOUNDRY_CONSTRUCT_DEVICE", "cpu"),
    )
    runtime = await construct_runtime.load(
        model_id=artifact["baseModel"],
        adapter_path=artifact["adapterPath"],
        artifact_id=artifact["id"],
    )
    loaded_model = (runtime.get("diagnostics") or {}).get("loadedModel") or {}
    require(loaded_model.get("adapterLoaded") is True, "Construct diagnostics did not confirm adapterLoaded.")

    prompt = "In one short sentence, what did this adapter proof validate?"
    prepared = await catalog.prepare_construct_chat_response(
        construct_id=construct["id"],
        conversation_id=f"construct-adapter-proof-{artifact['id']}",
        message=prompt,
        include_library_context=False,
        max_new_tokens=24,
        temperature=0.0,
        system_prompt="Reply as a concise Foundry mentor.",
    )
    streamed_tokens: list[str] = []
    async for token in construct_runtime.stream_tokens(
        prepared_response=prepared,
        user_message=prompt,
        system_prompt="Reply as a concise Foundry mentor.",
    ):
        streamed_tokens.append(token)
    response_text = "".join(streamed_tokens).strip()
    require(bool(response_text), "Construct stream returned no text.")

    await catalog.persist_prepared_construct_chat_response(
        construct_id=construct["id"],
        conversation_id=prepared["conversationId"],
        user_message_id=prepared["userMessageId"],
        assistant_message_id=prepared["message"]["id"],
        user_text=prompt,
        response_text=response_text,
        generation_settings={**prepared["generation"], "runtime": runtime},
        runtime_mode="transformers",
    )
    trial = await catalog.create_trial(
        workshop_id=artifact["workshopId"],
        artifact_id=artifact["id"],
        construct_id=construct["id"],
        message_id=prepared["message"]["id"],
        prompt=prompt,
        response=response_text,
        verdict="pass",
        runtime_mode="transformers",
        token_count=len(response_text.split()),
        generation_settings={**prepared["generation"], "runtime": runtime},
    )

    return {
        "contractVersion": "foundry.construct.adapter-proof.v1",
        "startedAt": started_at,
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "workshopId": artifact["workshopId"],
        "forgeRunId": smoke_result["forgeRun"]["id"],
        "artifactId": artifact["id"],
        "adapterPath": artifact["adapterPath"],
        "constructId": construct["id"],
        "runtime": {
            "mode": runtime["mode"],
            "status": runtime["status"],
            "modelId": runtime["modelId"],
            "device": runtime["device"],
            "adapterLoaded": loaded_model.get("adapterLoaded"),
        },
        "messageId": prepared["message"]["id"],
        "trialId": trial["id"],
        "trialRuntimeProfile": trial.get("runtimeProfile"),
        "responsePreview": response_text[:180],
    }


def main() -> int:
    try:
        report = asyncio.run(run_proof())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: Construct adapter live proof completed.")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
