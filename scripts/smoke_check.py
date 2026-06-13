#!/usr/bin/env python3
"""Public-repo smoke checks that avoid model downloads."""

from __future__ import annotations

import compileall
import asyncio
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPO_ROOT / "EMA"

FORBIDDEN_TRACKED_PATTERNS = (
    ".DS_Store",
    ".env",
    "..txt",
    ".pkl",
    ".pyc",
    ".jsonl",
    "__pycache__",
    "fastapi-env",
)

REQUIRED_PATH_KEYS = (
    "EMA_CONFIG_PATH",
    "FINE_TUNING",
    "SAVED_MODELS_PATH",
    "LOG_DIRECTORY",
    "WSO_TRAIN_DS",
    "WSO_VAL_DS",
)


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def run_compile_check() -> int:
    if not compileall.compile_dir(str(PACKAGE_ROOT), quiet=1):
        return fail("Python source compilation failed.")
    print("OK: Python source compiles.")
    return 0


def run_git_artifact_check() -> int:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    offenders = []
    for path in result.stdout.splitlines():
        if path.endswith(".env.example"):
            continue
        if any(pattern in path for pattern in FORBIDDEN_TRACKED_PATTERNS):
            offenders.append(path)

    if offenders:
        print("Tracked artifact offenders:")
        for path in offenders:
            print(f"  {path}")
        return fail("Forbidden generated/private artifacts are tracked.")

    print("OK: No forbidden generated/private artifacts are tracked.")
    return 0


def run_path_config_check() -> int:
    try:
        import yaml
    except ModuleNotFoundError:
        print("SKIP: PyYAML is not installed; path config parse check skipped.")
        return 0

    config_path = PACKAGE_ROOT / "configs" / "path_config.yaml"
    with config_path.open("r", encoding="utf-8") as file:
        config = yaml.safe_load(file)

    paths = config.get("paths", {}) if isinstance(config, dict) else {}
    missing = [key for key in REQUIRED_PATH_KEYS if key not in paths]
    absolute = [key for key, value in paths.items() if Path(str(value)).is_absolute()]

    if missing:
        return fail(f"path_config.yaml missing keys: {', '.join(missing)}")
    if absolute:
        return fail(f"path_config.yaml contains absolute paths: {', '.join(absolute)}")

    print("OK: path_config.yaml has required portable path keys.")
    return 0


def run_api_transport_boundary_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    source = api_server.read_text(encoding="utf-8")
    forbidden = (
        "from model_layer.agent_engine import AgentEngine",
        "AgentEngine()",
        "from data_layer.vector_database import VectorDatabase",
        "VectorDatabase(",
    )
    offenders = [pattern for pattern in forbidden if pattern in source]

    if offenders:
        return fail(
            "api_server.py directly owns orchestration/model wiring: "
            + ", ".join(offenders)
        )

    print("OK: FastAPI server delegates chat/RAG orchestration.")
    return 0


def run_forge_adapter_boundary_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    forge_service = PACKAGE_ROOT / "backend" / "services" / "forge_training_service.py"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = forge_service.read_text(encoding="utf-8")

    required_api_patterns = (
        "ForgeTrainingService",
        "/api/v1/forges/runtime",
        "build_training_contract",
        "worker/reconcile",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Forge runtime API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "foundry.forge.training.v1",
        "FOUNDRY_FORGE_RUNTIME_MODE",
        "supportsMethods",
        "events.jsonl",
        "contract.json",
        "metrics.json",
        "reconcile_worker_state",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail(
            "ForgeTrainingService contract markers are missing: "
            + ", ".join(missing_service)
        )

    print("OK: Forge runtime adapter contract is present.")
    return 0


def run_trial_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    catalog_service = PACKAGE_ROOT / "backend" / "services" / "foundry_catalog_service.py"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = catalog_service.read_text(encoding="utf-8")

    required_api_patterns = (
        "CreateTrialInput",
        "ExportTrialsInput",
        "/api/v1/workshops/{workshop_id}/trials",
        "/api/v1/workshops/{workshop_id}/trials/export",
        "create_foundry_trial_endpoint",
        "export_foundry_trials_endpoint",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Trial API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "CREATE TABLE IF NOT EXISTS trials",
        "list_trials",
        "create_trial",
        "export_trials_to_material",
        "_refresh_artifact_trial_score",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail("Trial catalog contract is missing: " + ", ".join(missing_service))

    print("OK: Trial persistence contract is present.")
    return 0


def run_chat_service_fake_engine_check() -> int:
    if str(PACKAGE_ROOT) not in sys.path:
        sys.path.insert(0, str(PACKAGE_ROOT))

    from backend.services.chat_orchestration_service import ChatOrchestrationService
    from model_layer.model_converstation_history import ConversationMemory

    class FakeEngine:
        def __init__(self):
            self.conversation_history = ConversationMemory(max_history=10)

        async def process_query(self, user_query: str):
            self.conversation_history.add_message(
                {"role": "user", "content": user_query}
            )
            for token in ("hello", " ", "world"):
                yield token

        def generate_response(self, prompt: str, **generation_options):
            return f"response:{prompt}"

    async def exercise_service() -> int:
        service = ChatOrchestrationService(engine_factory=FakeEngine)
        if service.is_loaded:
            return fail("Chat service loaded the engine before the first request.")

        tokens = [token async for token in service.stream_chat("hello")]
        if tokens != ["hello", " ", "world"]:
            return fail("Chat service did not stream fake engine tokens.")
        if not service.is_loaded:
            return fail("Chat service did not lazy-load the fake engine.")

        response = await service.generate_query_response("question")
        if response != "response:question":
            return fail("Chat service did not delegate query generation.")

        await service.reset_conversation()
        if await service.get_conversation_history() != []:
            return fail("Chat service did not reset conversation memory.")

        return 0

    result = asyncio.run(exercise_service())
    if result:
        return result

    print("OK: Chat orchestration service delegates lazily and resets memory.")
    return 0


def main() -> int:
    checks = (
        run_compile_check,
        run_git_artifact_check,
        run_path_config_check,
        run_api_transport_boundary_check,
        run_forge_adapter_boundary_check,
        run_trial_contract_check,
        run_chat_service_fake_engine_check,
    )
    failures = sum(check() for check in checks)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
