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
    smoke_service = PACKAGE_ROOT / "backend" / "services" / "forge_smoke_service.py"
    forge_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ForgeWorkbench.tsx"
    artifacts_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ArtifactsWorkbench.tsx"
    smoke_script = REPO_ROOT / "scripts" / "run_local_forge_smoke.py"
    construct_adapter_script = REPO_ROOT / "scripts" / "run_construct_adapter_proof.py"
    worker_script = REPO_ROOT / "scripts" / "run_forge_contract_worker.py"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = forge_service.read_text(encoding="utf-8")
    smoke_service_source = smoke_service.read_text(encoding="utf-8")
    forge_workbench_source = forge_workbench.read_text(encoding="utf-8")
    artifacts_workbench_source = artifacts_workbench.read_text(encoding="utf-8")
    smoke_source = smoke_script.read_text(encoding="utf-8")
    construct_adapter_source = construct_adapter_script.read_text(encoding="utf-8")
    worker_source = worker_script.read_text(encoding="utf-8")

    required_api_patterns = (
        "ForgeTrainingService",
        "/api/v1/forges/runtime",
        "purpose: Literal[\"training\", \"evaluation\"]",
        "build_training_contract",
        "worker/reconcile",
        "worker/preflight-local",
        "worker/run-local",
        "/api/v1/forges/smoke-proof",
        "LocalForgeSmokeService",
        "complete_forge_from_worker",
        "adapter_path=state[\"metrics\"].get(\"adapterPath\")",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Forge runtime API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "foundry.forge.training.v1",
        "\"purpose\": purpose",
        "evaluation_completed",
        "foundry.forge.evaluation.v1",
        "build_evaluation_report",
        "FOUNDRY_FORGE_RUNTIME_MODE",
        "supportsMethods",
        "events.jsonl",
        "contract.json",
        "metrics.json",
        "reconcile_worker_state",
        "preflight_local_training",
        "model-cache",
        "memory-fit",
        "set_local_trainer_backend",
        "execute_local_training",
        "_execute_trainer_backend",
        "local_training_started",
        "local_training_completed",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail(
            "ForgeTrainingService contract markers are missing: "
            + ", ".join(missing_service)
        )

    required_smoke_service_patterns = (
        "SMOKE_MODEL_ID = \"sshleifer/tiny-gpt2\"",
        "local-forge-smoke.jsonl",
        "preflight_local_training",
        "complete_forge_from_worker",
        "adapter_path=worker_state[\"metrics\"].get(\"adapterPath\")",
        "run_forge_contract_worker.py",
        "subprocess.run",
    )
    missing_smoke_service = [
        pattern for pattern in required_smoke_service_patterns
        if pattern not in smoke_service_source
    ]
    if missing_smoke_service:
        return fail(
            "Local Forge smoke service markers are missing: "
            + ", ".join(missing_smoke_service)
        )

    required_smoke_patterns = (
        "LocalForgeSmokeService",
        "parser.add_argument(\n        \"--run\"",
    )
    missing_smoke = [
        pattern for pattern in required_smoke_patterns if pattern not in smoke_source
    ]
    if missing_smoke:
        return fail(
            "Local Forge smoke script markers are missing: "
            + ", ".join(missing_smoke)
        )

    required_construct_adapter_patterns = (
        "foundry.construct.adapter-proof.v1",
        "ConstructInferenceService",
        "adapterLoaded",
        "stream_tokens",
        "create_trial",
    )
    missing_construct_adapter = [
        pattern for pattern in required_construct_adapter_patterns
        if pattern not in construct_adapter_source
    ]
    if missing_construct_adapter:
        return fail(
            "Construct adapter proof script markers are missing: "
            + ", ".join(missing_construct_adapter)
        )

    required_worker_patterns = (
        "FOUNDRY_FORGE_RUNTIME_MODE",
        "FOUNDRY_FORGE_TRAIN_DEVICE",
        "execute_local_training",
        "get_metrics",
    )
    missing_worker = [
        pattern for pattern in required_worker_patterns if pattern not in worker_source
    ]
    if missing_worker:
        return fail(
            "Local Forge worker script markers are missing: "
            + ", ".join(missing_worker)
        )

    required_frontend_patterns = (
        "forgeTrainingMethod",
        "forgeAdapterBoundary",
        "forgeProofMode",
        "artifactsReadiness",
        "artifactsPromotionGate",
        "Choose the adapter strategy",
        "Tiny proof keeps training honest",
        "Readiness separates output types",
        "Promotion is evidence, not hope",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if pattern not in forge_workbench_source and pattern not in artifacts_workbench_source
    ]
    if missing_frontend:
        return fail(
            "Forge/Artifact Academy guidance frontend contract is missing: "
            + ", ".join(missing_frontend)
        )

    print("OK: Forge runtime adapter contract is present.")
    return 0


def run_trial_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    catalog_service = PACKAGE_ROOT / "backend" / "services" / "foundry_catalog_service.py"
    trials_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "TrialsWorkbench.tsx"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = catalog_service.read_text(encoding="utf-8")
    trials_source = trials_workbench.read_text(encoding="utf-8")

    required_api_patterns = (
        "CreateTrialInput",
        "ExportTrialsInput",
        "/api/v1/workshops/{workshop_id}/trials",
        "/api/v1/workshops/{workshop_id}/trials/export",
        "/api/v1/forges/{forge_run_id}/evaluation/weak-samples/export",
        "ReviewedEvaluationSampleInput",
        "create_foundry_trial_endpoint",
        "export_foundry_trials_endpoint",
        "export_foundry_evaluation_weak_samples_endpoint",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Trial API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "CREATE TABLE IF NOT EXISTS trials",
        "list_trials",
        "create_trial",
        "export_trials_to_material",
        "export_evaluation_samples_to_material",
        "foundry.evaluation.weak-sample.v1",
        "\"reviewed\": bool(reviewed_samples)",
        "_trial_runtime_profile",
        "\"runtimeProfile\": runtime_profile",
        "\"source\": source",
        "\"adapterLoaded\": adapter_loaded",
        "_refresh_artifact_trial_score",
        "_artifact_readiness",
        "_artifact_present_files",
        "_artifact_output_files",
        "_artifact_trainer_result",
        "_artifact_compatibility",
        "\"readiness\": readiness",
        "\"artifactKind\": artifact_kind",
        "\"trainerResult\": trainer_result",
        "\"compatibility\": compatibility",
        "\"status\": \"verified\"",
        "\"status\": \"simulated\"",
        "\"canLoad\": False",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail("Trial catalog contract is missing: " + ", ".join(missing_service))

    required_frontend_patterns = (
        "trialComparisons",
        "trialComparisonSummary",
        "Saved Trial comparison",
        "trial-comparison-card",
        "runtimeSourceLabel",
        "trialsRuntimeSources",
        "trialsComparePrompts",
        "Read the runtime evidence",
        "Why compare prompts?",
    )
    missing_frontend = [
        pattern for pattern in required_frontend_patterns if pattern not in trials_source
    ]
    if missing_frontend:
        return fail("Trial comparison frontend contract is missing: " + ", ".join(missing_frontend))

    print("OK: Trial persistence contract is present.")
    return 0


def run_academy_progress_map_check() -> int:
    dashboard = PACKAGE_ROOT / "frontend" / "src" / "components" / "Dashboard.tsx"
    focus_callout = PACKAGE_ROOT / "frontend" / "src" / "components" / "LoopFocusCallout.tsx"
    materials_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "MaterialsWorkbench.tsx"
    forge_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ForgeWorkbench.tsx"
    artifacts_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ArtifactsWorkbench.tsx"
    construct_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ConstructWorkbench.tsx"
    trials_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "TrialsWorkbench.tsx"
    app_shell = PACKAGE_ROOT / "frontend" / "src" / "App.tsx"
    app_styles = PACKAGE_ROOT / "frontend" / "src" / "App.css"
    academy_registry = PACKAGE_ROOT / "frontend" / "src" / "domain" / "academyRegistry.ts"
    catalog_service = PACKAGE_ROOT / "backend" / "services" / "foundry_catalog_service.py"
    dashboard_source = dashboard.read_text(encoding="utf-8")
    focus_callout_source = focus_callout.read_text(encoding="utf-8")
    materials_source = materials_workbench.read_text(encoding="utf-8")
    forge_source = forge_workbench.read_text(encoding="utf-8")
    artifacts_source = artifacts_workbench.read_text(encoding="utf-8")
    construct_source = construct_workbench.read_text(encoding="utf-8")
    trials_source = trials_workbench.read_text(encoding="utf-8")
    app_shell_source = app_shell.read_text(encoding="utf-8")
    app_styles_source = app_styles.read_text(encoding="utf-8")
    academy_source = academy_registry.read_text(encoding="utf-8")
    service_source = catalog_service.read_text(encoding="utf-8")

    required_frontend_patterns = (
        "buildLoopSteps",
        "DashboardLoopEvidence",
        "refreshDashboardLoopEvidence",
        "onLoopEvidenceRefresh",
        "loopEvidence",
        "Evidence refreshed",
        "Refreshing evidence",
        "isLoopEvidenceRefreshing",
        "loop-evidence-pulse",
        "learning-loop-evidence-time",
        "learning-loop-evidence-popover",
        "Backend evidence",
        "Why the loop is where it is",
        "evidenceReason",
        "learning-loop-reason",
        "Pending until",
        "acceptedQAPairCount",
        "readyArtifactCount",
        "Foundry Learning Loop",
        "Material",
        "Assembly Line",
        "QA Review",
        "JSONL Material",
        "Forge",
        "Artifact",
        "Construct",
        "Trial",
        "dashboardLearningLoop",
        "foundryLoop",
        "onOpenLoopStep",
        "Resume next required action",
        "learning-loop-resume-target",
        "learning-loop-actions",
        "LOOP_TOUR_STORAGE_KEY",
        "First-run tour",
        "loop-tour-card",
        "Open tour target",
        "Start loop tour",
        "foundry.loopTour.dismissed",
        "loopStepToFocus",
        "Dashboard focus",
        "LoopFocusCallout",
        "Next required action",
        "nextAction",
        "materialsNextAction",
        "forgeNextAction",
        "artifactsNextAction",
        "constructNextAction",
        "trialsNextAction",
        "materialsLoopFocusTarget",
        "jsonlControlsRef",
        "forgeLoopFocusTarget",
        "forgeQueueRef",
        "artifactLoopFocusTarget",
        "artifactCatalogRef",
        "constructRuntimeFocusRef",
        "trialsLoopFocusTarget",
        "trialListRef",
        "is-loop-focused",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if (
            pattern not in dashboard_source
            and pattern not in focus_callout_source
            and pattern not in materials_source
            and pattern not in forge_source
            and pattern not in artifacts_source
            and pattern not in construct_source
            and pattern not in trials_source
            and pattern not in app_shell_source
            and pattern not in app_styles_source
            and pattern not in academy_source
        )
    ]
    if missing_frontend:
        return fail(
            "Academy progress map frontend contract is missing: "
            + ", ".join(missing_frontend)
        )

    required_service_patterns = (
        "_dashboard_loop_evidence",
        "\"loopEvidence\": self._dashboard_loop_evidence",
        "acd-foundry-loop",
        "dashboard.learning-loop",
        "The Foundry Loop",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail(
            "Academy progress map seed data is missing: "
            + ", ".join(missing_service)
        )

    print("OK: Academy progress map contract is present.")
    return 0


def run_material_import_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    catalog_service = PACKAGE_ROOT / "backend" / "services" / "foundry_catalog_service.py"
    qa_generation_service = PACKAGE_ROOT / "backend" / "services" / "qa_generation_service.py"
    materials_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "MaterialsWorkbench.tsx"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = catalog_service.read_text(encoding="utf-8")
    qa_generation_source = qa_generation_service.read_text(encoding="utf-8")
    materials_source = materials_workbench.read_text(encoding="utf-8")

    required_api_patterns = (
        "/api/v1/workshops/{workshop_id}/materials/import-file",
        "/api/v1/workshops/{workshop_id}/qa-pairs/{qa_pair_id}",
        "/api/v1/workshops/{workshop_id}/qa-pairs/export/preview",
        "import_foundry_material_file_endpoint",
        "update_foundry_qa_pair_review_endpoint",
        "preview_foundry_qa_pairs_export_endpoint",
        "/api/v1/workshops/{workshop_id}/materials/website-preview",
        "preview_foundry_website_material_endpoint",
        "/api/v1/workshops/{workshop_id}/materials/{material_id}/preview",
        "preview_foundry_material_source_endpoint",
        "/api/v1/workshops/{workshop_id}/materials/{material_id}/source-evaluation",
        "evaluate_foundry_material_source_endpoint",
        "/api/v1/workshops/{workshop_id}/materials/{material_id}",
        "delete_foundry_material_endpoint",
        "DeleteMaterialInput",
        "SourceEvaluationInput",
        "/api/v1/assembly-line/qa-generator/runtime",
        "/api/v1/assembly-line/qa-generator/runtime/configure",
        "/api/v1/assembly-line/qa-generator/preflight",
        "/api/v1/assembly-line/qa-generator/smoke-proof",
        "/api/v1/assembly-line/qa-generator/quality-proof",
        "/api/v1/workshops/{workshop_id}/assembly-line/qa-generator/quality-proof/latest",
        "QAGeneratorRuntimeInput",
        "QAGeneratorQualityProofInput",
        "latest_foundry_qa_generator_quality_proof_endpoint",
        "remember_foundry_qa_generator_quality_proof_endpoint",
        "UpdateQAPairReviewInput",
        "includeDrafts: bool = False",
        "includeLowQuality: bool = False",
        "Request",
        "request.body()",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Material import API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "SUPPORTED_IMPORT_EXTENSIONS",
        "FOUNDRY_MATERIAL_UPLOAD_MAX_BYTES",
        "import_material_file",
        "_import_material_file_sync",
        "_safe_source_filename",
        "_read_csv_source",
        "_read_jsonl_source",
        "_read_pdf_source",
        "pypdf",
        "_ensure_qa_review_columns",
        "QAGenerationService",
        "QAGenerationRequest",
        "generator_model",
        "confidence",
        "generation_metadata_json",
        "qa_generator_quality_proofs",
        "get_last_qa_generator_quality_proof",
        "remember_qa_generator_quality_proof",
        "_summarize_quality_proof",
        "_qa_export_proof_state",
        "foundry.qa-proof-state.v1",
        "\"qaProofState\": qa_proof_state",
        "qaGeneratorQualityProofs",
        "QA_QUALITY_CONFIDENCE_THRESHOLD",
        "QAQualityEvaluator",
        "_qa_pair_quality_gate",
        "\"metrics\": metrics",
        "\"qualityGate\": self._qa_pair_quality_gate",
        "\"trainingReadiness\": training_readiness",
        "foundry.qa-training-readiness.v1",
        "_qa_training_readiness",
        "_qa_payload_has_source_reference",
        "defaultTrainingSafe",
        "\"lowQualityOverride\": include_low_quality",
        "\"generatorModel\": row[\"generator_model\"]",
        "\"generationMetadata\": generation_metadata",
        "update_qa_pair_review",
        "review_status IN ('accepted', 'edited')",
        "\"reviewStatus\": row[\"review_status\"]",
        "metadata_json TEXT NOT NULL DEFAULT '{}'",
        "_ensure_material_metadata_columns",
        "_snapshot_website_source",
        "preview_website_material",
        "preview_material_source",
        "delete_material",
        "_delete_material_sync",
        "_cleanup_material_runtime_paths",
        "foundry.material.source-preview.v1",
        "evaluate_material_source",
        "foundry.material.website-preview.v1",
        "foundry.material.scrape-metadata.v1",
        "qa-proof-diagnostics",
        "source-overlap",
        "hallucination-risk",
        "\"storedSourceUri\": source_uri",
        "_validate_website_url",
        "_fetch_website_html",
        "_extract_website_text",
        "FOUNDRY_WEBSITE_FETCH_MAX_BYTES",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail("Material import service contract is missing: " + ", ".join(missing_service))

    required_qa_generator_patterns = (
        "foundry.qa-generation.v1",
        "foundry.qa-prompt.source-context.v3",
        "qaType",
        "workshopSubject",
        "voiceTarget",
        "foundry.qa-generator.runtime.v1",
        "foundry.qa-generator.preflight.v1",
        "foundry.qa-generator.smoke-proof.v1",
        "foundry.qa-generator.quality-proof.v1",
        "foundry.source-evaluator.v1",
        "foundry.source-evaluator.system-prompt.v1",
        "evaluate_source_material",
        "FOUNDRY_QA_GENERATOR_MODE",
        "DEFAULT_QA_GENERATOR_MODEL_ID",
        "Qwen/Qwen2.5-0.5B-Instruct",
        "SMOKE_QA_GENERATOR_MODEL_ID",
        "runtime_payload",
        "preflight",
        "smoke_proof",
        "quality_proof",
        "\"proofMode\"",
        "\"source\": \"backend\"",
        "\"simulated\": False",
        "local_files_only=True",
        "proof_source=\"backend-local-model\"",
        "configure",
        "set_model_text_backend",
        "_transformers_available",
        "_generate_with_transformers",
        "_generate_model_text",
        "_model_load_reference",
        "_prepare_model_prompt",
        "apply_chat_template",
        "_generate_deterministic",
        "fallbackReason",
        "confidence",
    )
    missing_qa_generator = [
        pattern for pattern in required_qa_generator_patterns
        if pattern not in qa_generation_source
    ]
    if missing_qa_generator:
        return fail(
            "Material QA generation contract is missing: "
            + ", ".join(missing_qa_generator)
        )

    required_frontend_patterns = (
        "materialsSourceIngestion",
        "materialsChunking",
        "materialsQAGeneration",
        "materialsQAQualityGate",
        "qa-training-readiness",
        "qa-model-proof-card",
        "Model-backed QA proof",
        "Run model-backed proof",
        "qaProofSourceLabel",
        "proof not run",
        "local files only",
        "assembly-generator-warning",
        "qaGeneratorArchiveHandoff",
        "Returned from Archive",
        "QA generator model cached",
        "Generating smoke-grade QA",
        "Model-backed generator is unproven",
        "Configure + preflight",
        "onOpenArchiveModel(preflight.modelId",
        "Training readiness",
        "defaultTrainingSafe",
        "Source evidence comes first",
        "Chunks define what the generator can see",
        "QA generation mode changes data quality",
        "Quality gates protect the Forge",
        "Proof diagnostics explain the why",
        "Learn proof diagnostics",
        "Learn source overlap",
        "Learn hallucination risk",
        "getLastQAGeneratorQualityProof",
        "rememberQAGeneratorQualityProof",
        "qaProofMatchesSelectedModel",
        "qa-export-proof-state",
        "jsonl-preview-proof-state",
        "Export proof evidence",
        "JSONL proof state",
        "materialPendingDeletionId",
        "confirmMaterialDelete",
        "material-delete-confirm",
    )
    missing_frontend = [
        pattern for pattern in required_frontend_patterns if pattern not in materials_source
    ]
    if missing_frontend:
        return fail(
            "Material Academy guidance frontend contract is missing: "
            + ", ".join(missing_frontend)
        )

    print("OK: Material file import contract is present.")
    return 0


def run_construct_runtime_event_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    construct_service = PACKAGE_ROOT / "backend" / "services" / "construct_inference_service.py"
    catalog_service = PACKAGE_ROOT / "backend" / "services" / "foundry_catalog_service.py"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = construct_service.read_text(encoding="utf-8")
    catalog_source = catalog_service.read_text(encoding="utf-8")

    required_api_patterns = (
        "ConstructRuntimeEventInput",
        "FoundryReadinessGateInput",
        "/api/v1/foundry/readiness",
        "foundry.readiness-gate.v1",
        "foundry_readiness_gate_endpoint",
        "metadata: dict[str, Any] | None = None",
        "/api/v1/constructs/runtime/events",
        "/api/v1/constructs/runtime/events/export",
        "/api/v1/constructs/runtime/events/clear",
        "/api/v1/constructs/runtime/validations",
        "/api/v1/constructs/runtime/validations/export",
        "/api/v1/constructs/runtime/diagnostics/export",
        "ConstructRuntimeValidationInput",
        "modelId: str | None = None",
        "adapterPath: str | None = None",
        "artifactId: str | None = None",
        "pageSize: int = 25",
        "foundry_construct_runtime_events_endpoint",
        "export_foundry_construct_runtime_events_endpoint",
        "record_foundry_construct_runtime_event_endpoint",
        "clear_foundry_construct_runtime_events_endpoint",
        "foundry_construct_runtime_validations_endpoint",
        "export_foundry_construct_runtime_validations_endpoint",
        "export_foundry_construct_runtime_diagnostics_endpoint",
        "create_foundry_construct_runtime_validation_endpoint",
        "build_construct_diagnostics_bundle",
        "build_diagnostics_redaction_audit",
        "\"redactionAudit\"",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Construct runtime event API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "_runtime_events",
        "construct_runtime_events",
        "DEFAULT_CATALOG_DB_PATH",
        "DEFAULT_RUNTIME_EVENT_RETENTION_LIMIT",
        "FOUNDRY_CONSTRUCT_RUNTIME_EVENT_RETENTION_LIMIT",
        "list_runtime_events",
        "export_runtime_events",
        "\"contractVersion\": \"foundry.construct.runtime-history.v1\"",
        "record_runtime_event",
        "clear_runtime_events",
        "set_transformers_stream_backend",
        "PeftModel.from_pretrained",
        "_resolve_adapter_reference",
        "_model_cache_key",
        "\"adapterLoaded\": bool(cached.get(\"adapterPath\"))",
        "_persist_runtime_event",
        "_list_persisted_runtime_events",
        "_clear_persisted_runtime_events",
        "_prune_runtime_events",
        "Local Transformers inference could not start.",
        "Install optional ML dependencies and retry.",
        "\"source\": source",
        "\"metadata\": metadata or {}",
        "event_type=\"preflight\"",
        "event_type=\"load\"",
        "event_type=\"probe\"",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail(
            "ConstructInferenceService event contract is missing: "
            + ", ".join(missing_service)
        )

    required_catalog_patterns = (
        "construct_runtime_validations",
        "list_construct_runtime_validations",
        "export_construct_runtime_validations",
        "foundry.construct.runtime-validations-export.v1",
        "\"pageCount\"",
        "\"facets\"",
        "create_construct_runtime_validation",
        "_construct_runtime_validation_from_row",
    )
    missing_catalog = [
        pattern for pattern in required_catalog_patterns if pattern not in catalog_source
    ]
    if missing_catalog:
        return fail(
            "Construct runtime validation catalog contract is missing: "
            + ", ".join(missing_catalog)
        )

    print("OK: Construct runtime event contract is present.")
    return 0


def run_foundry_runtime_status_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    app_shell = PACKAGE_ROOT / "frontend" / "src" / "App.tsx"
    app_styles = PACKAGE_ROOT / "frontend" / "src" / "App.css"
    frontend_contract = PACKAGE_ROOT / "frontend" / "src" / "contracts" / "foundryApi.ts"
    frontend_repository = PACKAGE_ROOT / "frontend" / "src" / "services" / "foundryRepository.ts"
    api_source = api_server.read_text(encoding="utf-8")
    app_source = app_shell.read_text(encoding="utf-8")
    app_styles_source = app_styles.read_text(encoding="utf-8")
    contract_source = frontend_contract.read_text(encoding="utf-8")
    repository_source = frontend_repository.read_text(encoding="utf-8")

    required_api_patterns = (
        "foundry.status.v1",
        "/api/v1/foundry/status",
        "foundry_runtime_status_endpoint",
        "construct_inference_service.runtime_payload()",
        "forge_training_service.runtime_payload()",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Foundry runtime status API boundary is missing: " + ", ".join(missing_api))

    required_frontend_patterns = (
        "status: `${FOUNDRY_API_VERSION}/foundry/status`",
        "getFoundryStatus",
        "FoundryRuntimeStatus",
        "buildApiUnavailableStatus",
        "RUNTIME_INSPECTOR_STORAGE_KEY",
        "runtime-drawer-toggle",
        "inspector-collapsed",
        "Toggle runtime metrics drawer",
        "Runtime Metrics",
        "--z-local-popover",
        "--z-inspector-drawer",
        "--z-modal-drawer",
        "--z-tooltip",
        "tooltip-floating-card",
        "getQAGeneratorRuntime: apiFoundryRepository.getQAGeneratorRuntime",
        "configureQAGeneratorRuntime: apiFoundryRepository.configureQAGeneratorRuntime",
        "preflightQAGenerator: apiFoundryRepository.preflightQAGenerator",
        "runQAGeneratorSmokeProof: apiFoundryRepository.runQAGeneratorSmokeProof",
        "runQAGeneratorQualityProof: apiFoundryRepository.runQAGeneratorQualityProof",
        "findMockCachedArchiveEntry",
        "Mock Archive cache is ready for model-backed QA proof simulation.",
        "mock-cached-model-context-synthesis",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if (
            pattern not in contract_source
            and pattern not in repository_source
            and pattern not in app_source
            and pattern not in app_styles_source
        )
    ]
    if missing_frontend:
        return fail(
            "Foundry runtime status frontend contract is missing: "
            + ", ".join(missing_frontend)
        )

    print("OK: Foundry runtime status contract is present.")
    return 0


def run_model_download_job_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    hf_service = PACKAGE_ROOT / "backend" / "services" / "huggingface_model_service.py"
    frontend_contract = PACKAGE_ROOT / "frontend" / "src" / "contracts" / "foundryApi.ts"
    frontend_repository = PACKAGE_ROOT / "frontend" / "src" / "services" / "foundryRepository.ts"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = hf_service.read_text(encoding="utf-8")
    contract_source = frontend_contract.read_text(encoding="utf-8")
    repository_source = frontend_repository.read_text(encoding="utf-8")

    required_api_patterns = (
        "/api/v1/archive/models/evict",
        "evict_foundry_archive_model_endpoint",
        "/api/v1/archive/models/download-jobs",
        "start_foundry_archive_model_download_job_endpoint",
        "foundry_archive_model_download_job_endpoint",
        "foundry_archive_model_download_jobs_endpoint",
        "cancel_foundry_archive_model_download_job_endpoint",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Model download job API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "evict_archive_model",
        "start_download_job",
        "get_download_job",
        "list_download_jobs",
        "cancel_download_job",
        "_run_download_job",
        "phase=\"downloading\"",
        "phase=\"cataloging\"",
        "create_model_download_job",
        "update_model_download_job",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail("Model download job service contract is missing: " + ", ".join(missing_service))

    required_frontend_patterns = (
        "evictArchiveModel",
        "evictArchiveModel:",
        "startModelDownloadJob",
        "listModelDownloadJobs",
        "getModelDownloadJob",
        "cancelModelDownloadJob",
        "ModelDownloadJob",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if pattern not in contract_source and pattern not in repository_source
    ]
    if missing_frontend:
        return fail("Model download job frontend contract is missing: " + ", ".join(missing_frontend))

    print("OK: Model download job contract is present.")
    return 0


def run_huggingface_auth_contract_check() -> int:
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    hf_service = PACKAGE_ROOT / "backend" / "services" / "huggingface_model_service.py"
    frontend_contract = PACKAGE_ROOT / "frontend" / "src" / "contracts" / "foundryApi.ts"
    frontend_repository = PACKAGE_ROOT / "frontend" / "src" / "services" / "foundryRepository.ts"
    frontend_artifacts = PACKAGE_ROOT / "frontend" / "src" / "components" / "ArtifactsWorkbench.tsx"
    api_source = api_server.read_text(encoding="utf-8")
    service_source = hf_service.read_text(encoding="utf-8")
    contract_source = frontend_contract.read_text(encoding="utf-8")
    repository_source = frontend_repository.read_text(encoding="utf-8")
    artifacts_source = frontend_artifacts.read_text(encoding="utf-8")

    required_api_patterns = (
        "username: str | None = None",
        "username=data.username",
        "/api/v1/archive/huggingface/auth/test",
        "test_foundry_huggingface_auth_endpoint",
        "/api/v1/archive/models/preflight",
        "preflight_foundry_archive_model_endpoint",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Hugging Face auth API boundary is missing: " + ", ".join(missing_api))

    required_service_patterns = (
        "HuggingFaceAccessError",
        "_validate_auth_pair",
        "test_auth",
        "preflight_model",
        "_whoami_sync",
        "_preflight_message",
        "_friendly_huggingface_error",
        "_redact_secret",
        "\"tokenPresent\": bool",
    )
    missing_service = [
        pattern for pattern in required_service_patterns if pattern not in service_source
    ]
    if missing_service:
        return fail("Hugging Face auth service handling is missing: " + ", ".join(missing_service))

    required_frontend_patterns = (
        "username?: string",
        "normalizeHuggingFaceError",
        "archiveRequest",
        "huggingFaceAuthLabel",
        "Using anonymous Hugging Face access",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if pattern not in contract_source
        and pattern not in repository_source
        and pattern not in artifacts_source
    ]
    if missing_frontend:
        return fail("Hugging Face auth frontend handling is missing: " + ", ".join(missing_frontend))

    print("OK: Hugging Face auth handling contract is present.")
    return 0


def run_construct_memory_cleanup_contract_check() -> int:
    construct_service = PACKAGE_ROOT / "backend" / "services" / "construct_inference_service.py"
    api_server = PACKAGE_ROOT / "backend" / "api_server.py"
    construct_workbench = PACKAGE_ROOT / "frontend" / "src" / "components" / "ConstructWorkbench.tsx"
    frontend_contracts = PACKAGE_ROOT / "frontend" / "src" / "contracts" / "foundryApi.ts"
    frontend_repository = PACKAGE_ROOT / "frontend" / "src" / "services" / "foundryRepository.ts"
    service_source = construct_service.read_text(encoding="utf-8")
    api_source = api_server.read_text(encoding="utf-8")
    construct_workbench_source = construct_workbench.read_text(encoding="utf-8")
    contract_source = frontend_contracts.read_text(encoding="utf-8")
    repository_source = frontend_repository.read_text(encoding="utf-8")

    required_patterns = (
        "_clean_runtime_memory",
        "release_memory",
        "memoryCleanup",
        "FOUNDRY_CONSTRUCT_STREAM_TOKEN_TIMEOUT_SECONDS",
        "FOUNDRY_CONSTRUCT_ALLOW_REMOTE_MODEL_DOWNLOAD",
        "DEFAULT_MODEL_ARCHIVE_DIR",
        "_resolve_model_reference",
        "_uncached_model_preflight",
        "_safe_archive_slug",
        "Download the model from Archive",
        "TextIteratorStreamer",
        "timeout=self._stream_token_timeout_seconds",
        "generation_error",
        "torch.inference_mode()",
        "gc.collect()",
        "torch.cuda.empty_cache()",
        "torch.cuda.ipc_collect()",
        "torch.mps.empty_cache()",
        "conservative headroom budget",
        "exceeds {available}GB available",
    )
    missing = [pattern for pattern in required_patterns if pattern not in service_source]
    if missing:
        return fail("Construct runtime memory cleanup contract is missing: " + ", ".join(missing))

    required_api_patterns = (
        "/api/v1/constructs/runtime/release-memory",
        "release_foundry_construct_runtime_memory_endpoint",
        "construct_inference_service.runtime_payload()",
        "Construct stream failed",
    )
    missing_api = [pattern for pattern in required_api_patterns if pattern not in api_source]
    if missing_api:
        return fail("Construct runtime memory cleanup API is missing: " + ", ".join(missing_api))

    required_frontend_patterns = (
        "releaseConstructRuntimeMemory:",
        "releaseConstructRuntimeMemory",
        "constructRuntimeLoading",
        "constructAdapterEvidence",
        "constructMemoryCleanup",
        "Runtime loading is the proof point",
        "Memory cleanup keeps iteration smooth",
    )
    missing_frontend = [
        pattern
        for pattern in required_frontend_patterns
        if (
            pattern not in contract_source
            and pattern not in repository_source
            and pattern not in construct_workbench_source
        )
    ]
    if missing_frontend:
        return fail(
            "Construct runtime memory cleanup frontend contract is missing: "
            + ", ".join(missing_frontend)
        )

    print("OK: Construct runtime memory cleanup contract is present.")
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
        run_academy_progress_map_check,
        run_material_import_contract_check,
        run_construct_runtime_event_contract_check,
        run_foundry_runtime_status_contract_check,
        run_model_download_job_contract_check,
        run_huggingface_auth_contract_check,
        run_construct_memory_cleanup_contract_check,
        run_chat_service_fake_engine_check,
    )
    failures = sum(check() for check in checks)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
