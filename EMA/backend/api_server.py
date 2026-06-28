
import asyncio
import json
from typing import Any, Literal, Set
from uuid import uuid4
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from utilities.logger import get_logger
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
from backend.services.chat_orchestration_service import ChatOrchestrationService
from backend.services.construct_inference_service import ConstructInferenceService
from backend.services.forge_smoke_service import LocalForgeSmokeService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService
from backend.services.huggingface_model_service import HuggingFaceModelService
from backend.services.qa_generation_service import DEFAULT_QA_GENERATOR_MODEL_ID


# Initialize FastAPI app
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Replace "*" with specific frontend URL(s) in production for better security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define input schemas
class QueryInput(BaseModel):
    query: str

class ChatInput(BaseModel):
    text: str

class FeedbackInput(BaseModel):
    query: str
    llm_response: str
    user_feedback: str

class ConversationInput(BaseModel):
    conversation_id: str

class CreateWorkshopInput(BaseModel):
    name: str
    subject: str
    voiceTarget: str | None = None
    baseModel: str | None = None

class RegisterMaterialInput(BaseModel):
    name: str
    kind: Literal["csv", "pdf", "website", "transcript", "video-transcript", "text", "jsonl"]
    sourceUri: str

class WebsiteMaterialPreviewInput(BaseModel):
    sourceUri: str

class StartAssemblyLineInput(BaseModel):
    materialSourceIds: list[str]
    chunkSizeTokens: int
    chunkOverlapTokens: int
    qaPairsPerSource: int

class QAGeneratorRuntimeInput(BaseModel):
    mode: Literal["deterministic", "transformers", "local"]
    modelId: str = DEFAULT_QA_GENERATOR_MODEL_ID
    maxNewTokens: int = 320
    temperature: float = 0.2

class ExportQAPairsInput(BaseModel):
    assemblyLineRunId: str
    name: str | None = None
    includeDrafts: bool = False
    includeLowQuality: bool = False

class UpdateQAPairReviewInput(BaseModel):
    question: str
    answer: str
    reviewStatus: Literal["draft", "accepted", "rejected", "edited"]

class StartForgeInput(BaseModel):
    materialSetId: str
    baseModel: str
    method: Literal["LoRA", "QLoRA"]
    purpose: Literal["training", "evaluation"] = "training"
    epochs: int
    learningRate: str
    loadIn4Bit: bool

class ForgeRuntimeInput(BaseModel):
    mode: Literal["simulated", "local"]
    worker: str | None = None

class LoadArtifactInput(BaseModel):
    artifactId: str

class ConstructChatInput(BaseModel):
    conversationId: str
    message: str
    systemPrompt: str | None = None
    includeLibraryContext: bool = False
    maxNewTokens: int | None = None
    temperature: float | None = None

class ConstructRuntimeInput(BaseModel):
    mode: Literal["simulated", "transformers"]
    modelId: str | None = None
    device: Literal["auto", "cpu", "cuda", "mps"] = "auto"

class ConstructRuntimeLoadInput(BaseModel):
    modelId: str | None = None
    adapterPath: str | None = None
    artifactId: str | None = None

class ConstructRuntimePreflightInput(BaseModel):
    modelId: str
    device: Literal["auto", "cpu", "cuda", "mps"] = "auto"

class ConstructRuntimeProbeInput(BaseModel):
    modelId: str = "sshleifer/tiny-gpt2"
    prompt: str = "The Foundry is"
    maxNewTokens: int = 24
    device: Literal["auto", "cpu", "cuda", "mps"] = "auto"

class FoundryReadinessGateInput(BaseModel):
    archiveRepoId: str | None = None
    archiveRevision: str | None = None
    archiveUsername: str | None = None
    archiveToken: str | None = None
    constructModelId: str | None = None
    constructDevice: Literal["auto", "cpu", "cuda", "mps"] = "auto"
    forgeRunId: str | None = None

class ForgeSmokeProofInput(BaseModel):
    runTraining: bool = False

class ConstructRuntimeEventInput(BaseModel):
    type: Literal["handoff", "preflight", "configure", "load", "unload", "probe", "smoke"]
    status: Literal["running", "passed", "warning", "failed", "info"]
    title: str
    detail: str
    timestamp: str | None = None
    constructId: str | None = None
    artifactId: str | None = None
    modelId: str | None = None
    runtimeStatus: str | None = None
    source: Literal["frontend", "mock", "backend"] = "frontend"
    metadata: dict[str, Any] | None = None

class ConstructRuntimeValidationInput(BaseModel):
    constructId: str | None = None
    artifactId: str | None = None
    modelId: str
    device: str
    status: Literal["passed", "failed"]
    totalTokens: int = 0
    durationSeconds: float = 0
    cleanupStatus: str = "unknown"
    memoryAvailableGb: float | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None

class SearchArchiveModelsInput(BaseModel):
    query: str = ""
    pipelineTag: str = "text-generation"
    sort: Literal["downloads", "likes", "lastModified"] = "downloads"
    limit: int = 20
    includeGated: bool = False
    username: str | None = None
    token: str | None = None

class InspectArchiveModelInput(BaseModel):
    repoId: str
    revision: str | None = None
    username: str | None = None
    token: str | None = None

class HuggingFaceAuthInput(BaseModel):
    username: str | None = None
    token: str | None = None

class CreateTrialInput(BaseModel):
    artifactId: str
    constructId: str
    messageId: str
    prompt: str
    response: str
    verdict: Literal["pass", "needs-work", "fail"]
    runtimeMode: str
    tokenCount: int
    generationSettings: dict[str, Any]

class ExportTrialsInput(BaseModel):
    trialIds: list[str] = []
    verdicts: list[Literal["pass", "needs-work", "fail"]] = []
    name: str | None = None

class ReviewedEvaluationSampleInput(BaseModel):
    instruction: str
    expected: str
    observed: str = ""
    verdict: Literal["needs-work", "fail"]
    note: str = ""

class ExportEvaluationSamplesInput(BaseModel):
    name: str | None = None
    samples: list[ReviewedEvaluationSampleInput] = []

# Initialize logger
logger = get_logger(__name__)

chat_service = ChatOrchestrationService()
construct_inference_service = ConstructInferenceService()
forge_training_service = ForgeTrainingService()
foundry_catalog_service = FoundryCatalogService()
huggingface_model_service = HuggingFaceModelService(foundry_catalog_service)
local_forge_smoke_service = LocalForgeSmokeService(foundry_catalog_service, forge_training_service)

active_connections: Set[WebSocket] = set()


def api_envelope(data: Any):
    return {"data": data, "requestId": str(uuid4())}


def sse_event(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def readiness_station(
    *,
    station_id: str,
    label: str,
    status: str,
    title: str,
    detail: str,
    next_action: str,
    checks: list[dict[str, Any]] | None = None,
    warnings: list[str] | None = None,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_status = status if status in {"ready", "caution", "blocked"} else "blocked"
    return {
        "id": station_id,
        "label": label,
        "status": normalized_status,
        "canProceed": normalized_status != "blocked",
        "title": title,
        "detail": detail,
        "nextAction": next_action,
        "checks": checks or [],
        "warnings": warnings or [],
        "source": source or {},
    }


def readiness_gate_payload(stations: list[dict[str, Any]]) -> dict[str, Any]:
    if not stations:
        overall_status = "blocked"
        summary = "No readiness stations were requested."
        next_action = "Choose an Archive model, Construct target, or Forge run to evaluate."
    elif any(station["status"] == "blocked" for station in stations):
        overall_status = "blocked"
        summary = "One or more stations are blocked."
        next_action = "Resolve blocked station checks before continuing."
    elif any(station["status"] == "caution" for station in stations):
        overall_status = "caution"
        summary = "The workflow can continue, but one or more stations need review."
        next_action = "Review caution warnings before continuing."
    else:
        overall_status = "ready"
        summary = "Archive, Construct, and Forge checks are ready for the requested path."
        next_action = "Continue to the next workflow step."

    return {
        "contractVersion": "foundry.readiness-gate.v1",
        "status": overall_status,
        "canProceed": overall_status != "blocked",
        "title": "Foundry readiness gate",
        "summary": summary,
        "nextAction": next_action,
        "stations": stations,
        "createdAt": utc_now(),
    }


def build_foundry_runtime_status() -> dict[str, Any]:
    checked_at = utc_now()
    construct_status = {
        "reachable": False,
        "status": "unavailable",
        "detail": "Construct runtime status could not be read.",
        "mode": None,
        "modelLoaded": False,
        "modelId": None,
        "device": None,
        "checkedAt": checked_at,
    }
    forge_status = {
        "reachable": False,
        "status": "unavailable",
        "detail": "Forge runtime status could not be read.",
        "mode": None,
        "ready": False,
        "checkedAt": checked_at,
    }

    try:
        runtime = construct_inference_service.runtime_payload()
        construct_status = {
            "reachable": True,
            "status": runtime["status"],
            "detail": runtime["detail"],
            "mode": runtime["mode"],
            "modelLoaded": runtime["loaded"],
            "modelId": runtime["modelId"],
            "device": runtime["device"],
            "checkedAt": checked_at,
        }
    except Exception as error:
        construct_status["detail"] = str(error)

    try:
        runtime = forge_training_service.runtime_payload()
        forge_status = {
            "reachable": True,
            "status": runtime["status"],
            "detail": runtime["detail"],
            "mode": runtime["mode"],
            "ready": runtime["ready"],
            "checkedAt": checked_at,
        }
    except Exception as error:
        forge_status["detail"] = str(error)

    return {
        "contractVersion": "foundry.status.v1",
        "api": {
            "reachable": True,
            "status": "ready",
            "detail": "FastAPI is serving Foundry v1 contracts.",
            "checkedAt": checked_at,
        },
        "construct": construct_status,
        "forge": forge_status,
        "catalog": {
            "reachable": True,
            "status": "ready",
            "detail": "SQLite Foundry catalog service is initialized.",
            "checkedAt": checked_at,
        },
    }


def build_diagnostics_redaction_audit() -> list[dict[str, str]]:
    return [
        {
            "field": "settings.huggingFaceToken",
            "status": "excluded",
            "risk": "credential",
            "reason": "Access tokens can grant model and account access.",
            "policy": "Never export secret token values in diagnostics bundles.",
        },
        {
            "field": "settings.huggingFaceUsername",
            "status": "excluded",
            "risk": "identity",
            "reason": "Account identifiers are not required for runtime debugging.",
            "policy": "Exclude user identifiers unless explicitly needed for a support workflow.",
        },
        {
            "field": "sourceMaterial.contents",
            "status": "excluded",
            "risk": "private-data",
            "reason": "Uploaded documents, transcripts, and prompts can contain copyrighted or private data.",
            "policy": "Export metadata and runtime state only; do not bundle source content.",
        },
        {
            "field": "chat.messages",
            "status": "excluded",
            "risk": "private-data",
            "reason": "Conversation text may include user secrets or unpublished source material.",
            "policy": "Export runtime event metadata instead of full chat transcripts.",
        },
        {
            "field": "local.paths",
            "status": "limited",
            "risk": "system-fingerprint",
            "reason": "Absolute paths can reveal usernames and local workstation structure.",
            "policy": "Prefer model identifiers and cache status over full filesystem paths.",
        },
    ]


async def build_construct_diagnostics_bundle(
    *,
    model_id: str | None = None,
    device: str | None = None,
    status: Literal["passed", "failed"] | None = None,
) -> dict[str, Any]:
    exported_at = utc_now()
    runtime_history = construct_inference_service.export_runtime_events()
    validation_history = await foundry_catalog_service.export_construct_runtime_validations(
        model_id=model_id,
        device=device,
        status=status,
    )
    redaction_audit = build_diagnostics_redaction_audit()
    return {
        "contractVersion": "foundry.construct.diagnostics-bundle.v1",
        "exportedAt": exported_at,
        "format": "json",
        "source": "backend",
        "serviceStatus": build_foundry_runtime_status(),
        "runtime": {
            "current": construct_inference_service.runtime_payload(),
        },
        "runtimeHistory": runtime_history,
        "validationHistory": {
            "count": validation_history["validationCount"],
            "filteredExport": validation_history,
        },
        "redactions": [
            f"{entry['field']}: {entry['status']} ({entry['risk']})"
            for entry in redaction_audit
        ],
        "redactionAudit": redaction_audit,
    }


@app.get("/api/v1/foundry/status")
async def foundry_runtime_status_endpoint():
    return api_envelope(build_foundry_runtime_status())


@app.post("/api/v1/foundry/readiness")
async def foundry_readiness_gate_endpoint(data: FoundryReadinessGateInput):
    stations: list[dict[str, Any]] = []

    archive_repo_id = (data.archiveRepoId or "").strip()
    if archive_repo_id:
        try:
            archive = await huggingface_model_service.preflight_model(
                repo_id=archive_repo_id,
                revision=data.archiveRevision or "",
                username=data.archiveUsername,
                token=data.archiveToken,
            )
            archive_status = "ready" if archive.get("canDownload") else "blocked"
            stations.append(
                readiness_station(
                    station_id="archive-download",
                    label="Archive download",
                    status=archive_status,
                    title="Model download ready" if archive.get("canDownload") else "Model download blocked",
                    detail=archive.get("message") or "Archive model preflight completed.",
                    next_action=(
                        "Download or register this model in the Archive."
                        if archive.get("canDownload")
                        else "Add required Hugging Face auth or choose a public model."
                    ),
                    checks=[
                        {
                            "id": "download-permission",
                            "label": "Download permission",
                            "status": "pass" if archive.get("canDownload") else "fail",
                            "detail": archive.get("message") or "Archive preflight completed.",
                        }
                    ],
                    warnings=[] if archive.get("canDownload") else [archive.get("message") or "Archive download is blocked."],
                    source=archive,
                )
            )
        except Exception as error:
            stations.append(
                readiness_station(
                    station_id="archive-download",
                    label="Archive download",
                    status="blocked",
                    title="Archive preflight failed",
                    detail=str(error),
                    next_action="Fix Archive model details or Hugging Face credentials, then retry.",
                    checks=[
                        {
                            "id": "archive-preflight",
                            "label": "Archive preflight",
                            "status": "fail",
                            "detail": str(error),
                        }
                    ],
                )
            )

    construct_model_id = (data.constructModelId or "").strip()
    if construct_model_id:
        try:
            construct = await construct_inference_service.preflight_model(
                model_id=construct_model_id,
                device=data.constructDevice,
            )
            if not construct.get("ok"):
                construct_status = "blocked"
            elif construct.get("fitStatus") in {"tight", "unknown"} or construct.get("warnings"):
                construct_status = "caution"
            else:
                construct_status = "ready"
            stations.append(
                readiness_station(
                    station_id="construct-load",
                    label="Construct load",
                    status=construct_status,
                    title="Construct runtime ready" if construct_status == "ready" else "Construct runtime needs review",
                    detail=(
                        "Construct runtime preflight passed."
                        if construct.get("ok")
                        else "Construct runtime preflight is blocked."
                    ),
                    next_action=(
                        "Load the model into Construct."
                        if construct_status == "ready"
                        else "Review failed checks, cache the model, or choose a smaller target."
                    ),
                    checks=construct.get("checks") or [],
                    warnings=construct.get("warnings") or [],
                    source=construct,
                )
            )
        except Exception as error:
            stations.append(
                readiness_station(
                    station_id="construct-load",
                    label="Construct load",
                    status="blocked",
                    title="Construct preflight failed",
                    detail=str(error),
                    next_action="Fix the Construct runtime target, then preflight again.",
                    checks=[
                        {
                            "id": "construct-preflight",
                            "label": "Construct preflight",
                            "status": "fail",
                            "detail": str(error),
                        }
                    ],
                )
            )

    forge_run_id = (data.forgeRunId or "").strip()
    if forge_run_id:
        try:
            forge = await foundry_catalog_service.get_forge_run(forge_run_id)
            material_id = forge.get("materialSetId")
            if not material_id:
                raise ValueError("Forge has no training Material to preflight.")
            material = await foundry_catalog_service.get_material(forge["workshopId"], material_id)
            contract = (
                forge_training_service.get_contract(forge_run_id)
                or forge_training_service.build_training_contract(
                    forge_run=forge,
                    material=material,
                )
            )
            forge_preflight = forge_training_service.preflight_local_training(contract)
            stations.append(
                readiness_station(
                    station_id="forge-start",
                    label="Forge start",
                    status=forge_preflight.get("status") or ("ready" if forge_preflight.get("ok") else "blocked"),
                    title=forge_preflight.get("title") or "Forge preflight completed",
                    detail=forge_preflight.get("summary") or "Forge local trainer preflight completed.",
                    next_action=forge_preflight.get("nextAction") or "Review Forge preflight checks.",
                    checks=forge_preflight.get("checks") or [],
                    warnings=forge_preflight.get("warnings") or [],
                    source=forge_preflight,
                )
            )
        except Exception as error:
            stations.append(
                readiness_station(
                    station_id="forge-start",
                    label="Forge start",
                    status="blocked",
                    title="Forge preflight failed",
                    detail=str(error),
                    next_action="Fix the Forge run or training Material, then retry.",
                    checks=[
                        {
                            "id": "forge-preflight",
                            "label": "Forge preflight",
                            "status": "fail",
                            "detail": str(error),
                        }
                    ],
                )
            )

    return api_envelope(readiness_gate_payload(stations))


@app.get("/api/v1/constructs/runtime")
async def foundry_construct_runtime_endpoint():
    return api_envelope(construct_inference_service.runtime_payload())


@app.get("/api/v1/constructs/runtime/events")
async def foundry_construct_runtime_events_endpoint():
    return api_envelope(construct_inference_service.list_runtime_events())


@app.get("/api/v1/constructs/runtime/events/export")
async def export_foundry_construct_runtime_events_endpoint():
    return api_envelope(construct_inference_service.export_runtime_events())


@app.post("/api/v1/constructs/runtime/events")
async def record_foundry_construct_runtime_event_endpoint(data: ConstructRuntimeEventInput):
    try:
        return api_envelope(
            construct_inference_service.record_runtime_event(
                event_type=data.type,
                status=data.status,
                title=data.title,
                detail=data.detail,
                timestamp=data.timestamp,
                construct_id=data.constructId,
                artifact_id=data.artifactId,
                model_id=data.modelId,
                runtime_status=data.runtimeStatus,
                source=data.source,
                metadata=data.metadata,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/constructs/runtime/events/clear")
async def clear_foundry_construct_runtime_events_endpoint():
    return api_envelope(construct_inference_service.clear_runtime_events())


@app.get("/api/v1/constructs/runtime/validations")
async def foundry_construct_runtime_validations_endpoint(
    modelId: str | None = None,
    device: str | None = None,
    status: Literal["passed", "failed"] | None = None,
    page: int = 1,
    pageSize: int = 25,
):
    return api_envelope(
        await foundry_catalog_service.list_construct_runtime_validations(
            model_id=modelId,
            device=device,
            status=status,
            page=page,
            page_size=pageSize,
        )
    )


@app.get("/api/v1/constructs/runtime/validations/export")
async def export_foundry_construct_runtime_validations_endpoint(
    modelId: str | None = None,
    device: str | None = None,
    status: Literal["passed", "failed"] | None = None,
):
    return api_envelope(
        await foundry_catalog_service.export_construct_runtime_validations(
            model_id=modelId,
            device=device,
            status=status,
        )
    )


@app.get("/api/v1/constructs/runtime/diagnostics/export")
async def export_foundry_construct_runtime_diagnostics_endpoint(
    modelId: str | None = None,
    device: str | None = None,
    status: Literal["passed", "failed"] | None = None,
):
    return api_envelope(
        await build_construct_diagnostics_bundle(
            model_id=modelId,
            device=device,
            status=status,
        )
    )


@app.post("/api/v1/constructs/runtime/validations")
async def create_foundry_construct_runtime_validation_endpoint(data: ConstructRuntimeValidationInput):
    if not data.modelId.strip():
        raise HTTPException(status_code=400, detail="Validation model id cannot be empty.")
    return api_envelope(
        await foundry_catalog_service.create_construct_runtime_validation(
            construct_id=data.constructId,
            artifact_id=data.artifactId,
            model_id=data.modelId,
            device=data.device,
            status=data.status,
            total_tokens=data.totalTokens,
            duration_seconds=data.durationSeconds,
            cleanup_status=data.cleanupStatus,
            memory_available_gb=data.memoryAvailableGb,
            error=data.error,
            metadata=data.metadata,
        )
    )


@app.get("/api/v1/forges/runtime")
async def foundry_forge_runtime_endpoint():
    return api_envelope(forge_training_service.runtime_payload())


@app.post("/api/v1/forges/runtime/configure")
async def configure_foundry_forge_runtime_endpoint(data: ForgeRuntimeInput):
    try:
        runtime = await forge_training_service.configure(
            mode=data.mode,
            worker=data.worker,
        )
        return api_envelope(runtime)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/forges/smoke-proof")
async def run_foundry_forge_smoke_proof_endpoint(data: ForgeSmokeProofInput):
    try:
        return api_envelope(
            await local_forge_smoke_service.prepare(run_training=data.runTraining)
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/constructs/runtime/configure")
async def configure_foundry_construct_runtime_endpoint(data: ConstructRuntimeInput):
    try:
        runtime = await construct_inference_service.configure(
            mode=data.mode,
            model_id=data.modelId,
            device=data.device,
        )
        return api_envelope(runtime)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/constructs/runtime/load")
async def load_foundry_construct_runtime_endpoint(data: ConstructRuntimeLoadInput):
    try:
        runtime = await construct_inference_service.load(
            model_id=data.modelId,
            adapter_path=data.adapterPath,
            artifact_id=data.artifactId,
        )
        return api_envelope(runtime)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Could not load runtime: {error}")


@app.post("/api/v1/constructs/runtime/preflight")
async def preflight_foundry_construct_runtime_endpoint(data: ConstructRuntimePreflightInput):
    try:
        return api_envelope(
            await construct_inference_service.preflight_model(
                model_id=data.modelId,
                device=data.device,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Could not preflight runtime: {error}")


@app.post("/api/v1/constructs/runtime/probe")
async def probe_foundry_construct_runtime_endpoint(data: ConstructRuntimeProbeInput):
    return api_envelope(
        await construct_inference_service.probe_runtime(
            model_id=data.modelId,
            prompt=data.prompt,
            max_new_tokens=data.maxNewTokens,
            device=data.device,
        )
    )


@app.post("/api/v1/constructs/runtime/unload")
async def unload_foundry_construct_runtime_endpoint():
    return api_envelope(await construct_inference_service.unload())


@app.post("/api/v1/constructs/runtime/release-memory")
async def release_foundry_construct_runtime_memory_endpoint():
    return api_envelope(await construct_inference_service.release_memory())


@app.get("/api/v1/archive/models")
async def foundry_model_archive_endpoint():
    return api_envelope(await huggingface_model_service.list_archive_entries())


@app.post("/api/v1/archive/huggingface/auth/test")
async def test_foundry_huggingface_auth_endpoint(data: HuggingFaceAuthInput):
    return api_envelope(
        await huggingface_model_service.test_auth(
            username=data.username,
            token=data.token,
        )
    )


@app.post("/api/v1/archive/models/search")
async def search_foundry_archive_models_endpoint(data: SearchArchiveModelsInput):
    try:
        return api_envelope(
            await huggingface_model_service.search_models(
                query=data.query,
                pipeline_tag=data.pipelineTag,
                sort=data.sort,
                limit=data.limit,
                include_gated=data.includeGated,
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Hugging Face model search failed: {error}")


@app.post("/api/v1/archive/models/inspect")
async def inspect_foundry_archive_model_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.inspect_model(
                repo_id=data.repoId,
                revision=data.revision or "",
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Hugging Face model inspection failed: {error}")


@app.post("/api/v1/archive/models/preflight")
async def preflight_foundry_archive_model_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.preflight_model(
                repo_id=data.repoId,
                revision=data.revision or "",
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Hugging Face model preflight failed: {error}")


@app.post("/api/v1/archive/models/register")
async def register_foundry_archive_model_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.register_remote_model(
                repo_id=data.repoId,
                revision=data.revision or "",
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Hugging Face model registration failed: {error}")


@app.post("/api/v1/archive/models/download")
async def download_foundry_archive_model_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.download_model(
                repo_id=data.repoId,
                revision=data.revision or "",
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Hugging Face model download failed: {error}")


@app.post("/api/v1/archive/models/evict")
async def evict_foundry_archive_model_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.evict_archive_model(
                repo_id=data.repoId,
                revision=data.revision or "",
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/archive/models/download-jobs")
async def start_foundry_archive_model_download_job_endpoint(data: InspectArchiveModelInput):
    try:
        return api_envelope(
            await huggingface_model_service.start_download_job(
                repo_id=data.repoId,
                revision=data.revision or "",
                username=data.username,
                token=data.token,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/v1/archive/models/download-jobs")
async def foundry_archive_model_download_jobs_endpoint():
    return api_envelope(await huggingface_model_service.list_download_jobs())


@app.get("/api/v1/archive/models/download-jobs/{job_id}")
async def foundry_archive_model_download_job_endpoint(job_id: str):
    try:
        return api_envelope(await huggingface_model_service.get_download_job(job_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/archive/models/download-jobs/{job_id}/cancel")
async def cancel_foundry_archive_model_download_job_endpoint(job_id: str):
    try:
        return api_envelope(await huggingface_model_service.cancel_download_job(job_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/foundry/bootstrap")
async def foundry_bootstrap_endpoint():
    """
    Load the frontend's initial Foundry domain data in one response.

    The catalog service gathers each slice concurrently so a future SQL-backed
    implementation can keep dashboard boot time low.
    """
    return api_envelope(await foundry_catalog_service.get_bootstrap())


@app.get("/api/v1/foundry/dashboard")
async def foundry_dashboard_endpoint():
    return api_envelope(await foundry_catalog_service.get_dashboard())


@app.get("/api/v1/workshops/{workshop_id}/dashboard/evidence")
async def foundry_workshop_dashboard_evidence_endpoint(workshop_id: str):
    try:
        return api_envelope(await foundry_catalog_service.get_dashboard_evidence(workshop_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/foundry/navigation")
async def foundry_navigation_endpoint():
    return api_envelope(await foundry_catalog_service.get_navigation_items())


@app.get("/api/v1/foundry/sections")
async def foundry_sections_endpoint():
    return api_envelope(await foundry_catalog_service.get_section_summaries())


@app.get("/api/v1/foundry/ui-catalog")
async def foundry_ui_catalog_endpoint():
    """
    UI component catalog contract.

    This is intentionally shaped like a SQL-backed lookup table: component id,
    station, purpose, cache key, and timestamp are the fields we will index first
    when persistence is introduced.
    """
    return api_envelope(await foundry_catalog_service.get_ui_catalog())


@app.get("/api/v1/academy/concepts")
async def foundry_academy_concepts_endpoint():
    return api_envelope(await foundry_catalog_service.get_academy_concepts())


@app.get("/api/v1/academy/actions")
async def foundry_academy_actions_endpoint():
    return api_envelope(await foundry_catalog_service.get_academy_actions())


@app.get("/api/v1/workshops")
async def foundry_workshops_endpoint():
    return api_envelope(await foundry_catalog_service.list_workshops())


@app.post("/api/v1/workshops")
async def create_foundry_workshop_endpoint(data: CreateWorkshopInput):
    name = data.name.strip()
    subject = data.subject.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workshop name cannot be empty.")
    if not subject:
        raise HTTPException(status_code=400, detail="Workshop subject cannot be empty.")

    workshop = await foundry_catalog_service.create_workshop(
        name=name,
        subject=subject,
        voice_target=data.voiceTarget.strip() if data.voiceTarget else None,
        base_model=data.baseModel.strip() if data.baseModel else None,
    )
    return api_envelope(workshop)


@app.get("/api/v1/workshops/{workshop_id}/materials")
async def foundry_materials_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_materials(workshop_id))


@app.post("/api/v1/workshops/{workshop_id}/materials")
async def register_foundry_material_endpoint(workshop_id: str, data: RegisterMaterialInput):
    name = data.name.strip()
    source_uri = data.sourceUri.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Material name cannot be empty.")
    if not source_uri:
        raise HTTPException(status_code=400, detail="Material source cannot be empty.")

    try:
        material = await foundry_catalog_service.register_material(
            workshop_id=workshop_id,
            name=name,
            kind=data.kind,
            source_uri=source_uri,
        )
        return api_envelope(material)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/workshops/{workshop_id}/materials/website-preview")
async def preview_foundry_website_material_endpoint(workshop_id: str, data: WebsiteMaterialPreviewInput):
    source_uri = data.sourceUri.strip()
    if not source_uri:
        raise HTTPException(status_code=400, detail="Website source cannot be empty.")

    try:
        return api_envelope(
            await foundry_catalog_service.preview_website_material(source_url=source_uri)
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/workshops/{workshop_id}/materials/import-file")
async def import_foundry_material_file_endpoint(
    workshop_id: str,
    request: Request,
    name: str = Query(default=""),
    kind: Literal["csv", "pdf", "transcript", "video-transcript", "text", "jsonl"] = Query(
        default="text"
    ),
    filename: str = Query(default="material.txt"),
):
    material_name = name.strip()
    source_filename = filename.strip()
    if not material_name:
        raise HTTPException(status_code=400, detail="Material name cannot be empty.")
    if not source_filename:
        raise HTTPException(status_code=400, detail="Material filename cannot be empty.")

    content = await request.body()
    try:
        material = await foundry_catalog_service.import_material_file(
            workshop_id=workshop_id,
            name=material_name,
            kind=kind,
            filename=source_filename,
            content=content,
        )
        return api_envelope(material)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/v1/workshops/{workshop_id}/assembly-lines")
async def foundry_assembly_lines_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_assembly_line_runs(workshop_id))


@app.get("/api/v1/assembly-line/qa-generator/runtime")
async def foundry_qa_generator_runtime_endpoint():
    return api_envelope(foundry_catalog_service.qa_generator.runtime_payload())


@app.post("/api/v1/assembly-line/qa-generator/runtime/configure")
async def configure_foundry_qa_generator_runtime_endpoint(data: QAGeneratorRuntimeInput):
    try:
        runtime = foundry_catalog_service.qa_generator.configure(
            mode=data.mode,
            model_id=data.modelId,
            max_new_tokens=data.maxNewTokens,
            temperature=data.temperature,
        )
        return api_envelope(runtime)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/assembly-line/qa-generator/preflight")
async def preflight_foundry_qa_generator_endpoint(data: QAGeneratorRuntimeInput):
    try:
        preflight = foundry_catalog_service.qa_generator.preflight(
            mode=data.mode,
            model_id=data.modelId,
            max_new_tokens=data.maxNewTokens,
            temperature=data.temperature,
        )
        return api_envelope(preflight)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/assembly-line/qa-generator/smoke-proof")
async def smoke_proof_foundry_qa_generator_endpoint():
    return api_envelope(await asyncio.to_thread(foundry_catalog_service.qa_generator.smoke_proof))


@app.post("/api/v1/assembly-line/qa-generator/quality-proof")
async def quality_proof_foundry_qa_generator_endpoint():
    return api_envelope(await asyncio.to_thread(foundry_catalog_service.qa_generator.quality_proof))


@app.post("/api/v1/workshops/{workshop_id}/assembly-lines")
async def start_foundry_assembly_line_endpoint(workshop_id: str, data: StartAssemblyLineInput):
    material_source_ids = [source_id.strip() for source_id in data.materialSourceIds if source_id.strip()]
    if not material_source_ids:
        raise HTTPException(status_code=400, detail="Select at least one Material.")
    if data.chunkSizeTokens < 128:
        raise HTTPException(status_code=400, detail="Chunk size must be at least 128 tokens.")
    if data.chunkOverlapTokens < 0:
        raise HTTPException(status_code=400, detail="Chunk overlap cannot be negative.")
    if data.chunkOverlapTokens >= data.chunkSizeTokens:
        raise HTTPException(status_code=400, detail="Chunk overlap must be smaller than chunk size.")
    if data.qaPairsPerSource < 1:
        raise HTTPException(status_code=400, detail="QA pairs per source must be at least 1.")

    try:
        run = await foundry_catalog_service.start_assembly_line(
            workshop_id=workshop_id,
            material_source_ids=material_source_ids,
            chunk_size_tokens=data.chunkSizeTokens,
            chunk_overlap_tokens=data.chunkOverlapTokens,
            qa_pairs_per_source=data.qaPairsPerSource,
        )
        return api_envelope(run)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/workshops/{workshop_id}/chunks")
async def foundry_chunks_endpoint(
    workshop_id: str,
    runId: str | None = Query(default=None),
):
    return api_envelope(
        await foundry_catalog_service.list_material_chunks(
            workshop_id=workshop_id,
            assembly_line_run_id=runId,
        )
    )


@app.get("/api/v1/workshops/{workshop_id}/qa-pairs")
async def foundry_qa_pairs_endpoint(
    workshop_id: str,
    runId: str | None = Query(default=None),
):
    return api_envelope(
        await foundry_catalog_service.list_qa_pairs(
            workshop_id=workshop_id,
            assembly_line_run_id=runId,
        )
    )


@app.patch("/api/v1/workshops/{workshop_id}/qa-pairs/{qa_pair_id}")
async def update_foundry_qa_pair_review_endpoint(
    workshop_id: str,
    qa_pair_id: str,
    data: UpdateQAPairReviewInput,
):
    try:
        qa_pair = await foundry_catalog_service.update_qa_pair_review(
            workshop_id=workshop_id,
            qa_pair_id=qa_pair_id,
            question=data.question,
            answer=data.answer,
            review_status=data.reviewStatus,
        )
        return api_envelope(qa_pair)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/workshops/{workshop_id}/qa-pairs/export")
async def export_foundry_qa_pairs_endpoint(workshop_id: str, data: ExportQAPairsInput):
    run_id = data.assemblyLineRunId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="Assembly Line run id cannot be empty.")

    try:
        export = await foundry_catalog_service.export_qa_pairs_to_material(
            workshop_id=workshop_id,
            assembly_line_run_id=run_id,
            include_drafts=data.includeDrafts,
            include_low_quality=data.includeLowQuality,
            name=data.name.strip() if data.name else None,
        )
        return api_envelope(export)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/workshops/{workshop_id}/qa-pairs/export/preview")
async def preview_foundry_qa_pairs_export_endpoint(workshop_id: str, data: ExportQAPairsInput):
    run_id = data.assemblyLineRunId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="Assembly Line run id cannot be empty.")

    try:
        preview = await foundry_catalog_service.preview_qa_pairs_export(
            workshop_id=workshop_id,
            assembly_line_run_id=run_id,
            include_drafts=data.includeDrafts,
            include_low_quality=data.includeLowQuality,
        )
        return api_envelope(preview)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/workshops/{workshop_id}/forges")
async def foundry_forge_runs_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_forge_runs(workshop_id))


@app.post("/api/v1/workshops/{workshop_id}/forges")
async def start_foundry_forge_endpoint(workshop_id: str, data: StartForgeInput):
    material_id = data.materialSetId.strip()
    base_model = data.baseModel.strip()
    learning_rate = data.learningRate.strip()
    if not material_id:
        raise HTTPException(status_code=400, detail="Select a JSONL Material for the Forge.")
    if not base_model:
        raise HTTPException(status_code=400, detail="Base model cannot be empty.")
    if data.epochs < 1:
        raise HTTPException(status_code=400, detail="Epochs must be at least 1.")
    if not learning_rate:
        raise HTTPException(status_code=400, detail="Learning rate cannot be empty.")

    try:
        forge = await foundry_catalog_service.start_forge(
            workshop_id=workshop_id,
            material_id=material_id,
            base_model=base_model,
            method=data.method,
            purpose=data.purpose,
            epochs=data.epochs,
            learning_rate=learning_rate,
            load_in_4bit=data.loadIn4Bit,
        )
        material = await foundry_catalog_service.get_material(workshop_id, material_id)
        training_contract = forge_training_service.build_training_contract(
            forge_run=forge,
            material=material,
        )
        worker_state = forge_training_service.initialize_contract(training_contract)
        forge["trainingContract"] = training_contract
        forge["workerState"] = worker_state
        return api_envelope(forge)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/forges/{forge_run_id}/contract")
async def foundry_forge_contract_endpoint(forge_run_id: str):
    try:
        await foundry_catalog_service.get_forge_run(forge_run_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    contract = forge_training_service.get_contract(forge_run_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="Forge contract has not been written yet.")
    return api_envelope(contract)


@app.get("/api/v1/forges/{forge_run_id}/events")
async def foundry_forge_events_endpoint(forge_run_id: str):
    try:
        await foundry_catalog_service.get_forge_run(forge_run_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    return api_envelope(
        {
            "events": forge_training_service.list_events(forge_run_id),
            "metrics": forge_training_service.get_metrics(forge_run_id),
        }
    )


@app.post("/api/v1/forges/{forge_run_id}/worker/reconcile")
async def reconcile_foundry_forge_worker_endpoint(forge_run_id: str):
    try:
        forge = await foundry_catalog_service.get_forge_run(forge_run_id)
        material_id = forge.get("materialSetId")
        if not material_id:
            raise ValueError("Forge has no training Material to reconcile.")
        material = await foundry_catalog_service.get_material(forge["workshopId"], material_id)
        state = forge_training_service.reconcile_worker_state(
            forge_run=forge,
            material=material,
        )
        if forge["status"] == "completed" and forge.get("purpose") != "evaluation":
            forge = await foundry_catalog_service.ensure_artifact_for_completed_forge(
                forge_run_id,
                adapter_path=state["metrics"].get("adapterPath"),
            )
            state["forgeRun"] = forge
        return api_envelope(state)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/forges/{forge_run_id}/worker/preflight-local")
async def preflight_local_foundry_forge_worker_endpoint(forge_run_id: str):
    try:
        forge = await foundry_catalog_service.get_forge_run(forge_run_id)
        material_id = forge.get("materialSetId")
        if not material_id:
            raise ValueError("Forge has no training Material to preflight.")
        material = await foundry_catalog_service.get_material(forge["workshopId"], material_id)
        contract = (
            forge_training_service.get_contract(forge_run_id)
            or forge_training_service.build_training_contract(
                forge_run=forge,
                material=material,
            )
        )
        readiness = forge_training_service.preflight_local_training(contract)
        return api_envelope(readiness)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/forges/{forge_run_id}/worker/run-local")
async def run_local_foundry_forge_worker_endpoint(forge_run_id: str):
    try:
        forge = await foundry_catalog_service.get_forge_run(forge_run_id)
        material_id = forge.get("materialSetId")
        if not material_id:
            raise ValueError("Forge has no training Material to run.")
        material = await foundry_catalog_service.get_material(forge["workshopId"], material_id)
        contract = (
            forge_training_service.get_contract(forge_run_id)
            or forge_training_service.build_training_contract(
                forge_run=forge,
                material=material,
            )
        )
        state = await asyncio.to_thread(forge_training_service.execute_local_training, contract)
        if state["metrics"].get("status") == "completed":
            forge = await foundry_catalog_service.complete_forge_from_worker(
                forge_run_id,
                adapter_path=state["metrics"].get("adapterPath"),
            )
            state["forgeRun"] = forge
        return api_envelope(state)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.post("/api/v1/forges/{forge_run_id}/simulate")
async def simulate_foundry_forge_endpoint(forge_run_id: str):
    try:
        forge = await foundry_catalog_service.advance_forge_simulation(forge_run_id)
        metrics = forge_training_service.record_simulation_step(forge)
        forge["workerState"] = {
            "events": forge_training_service.list_events(forge_run_id),
            "metrics": metrics,
        }
        return api_envelope(forge)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/workshops/{workshop_id}/artifacts")
async def foundry_artifacts_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_artifacts(workshop_id))


@app.post("/api/v1/workshops/{workshop_id}/constructs/load-artifact")
async def load_foundry_artifact_into_construct_endpoint(
    workshop_id: str,
    data: LoadArtifactInput,
):
    artifact_id = data.artifactId.strip()
    if not artifact_id:
        raise HTTPException(status_code=400, detail="Artifact id cannot be empty.")

    try:
        construct = await foundry_catalog_service.load_artifact_into_construct(
            workshop_id=workshop_id,
            artifact_id=artifact_id,
        )
        return api_envelope(construct)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.get("/api/v1/workshops/{workshop_id}/constructs")
async def foundry_constructs_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_constructs(workshop_id))


@app.get("/api/v1/workshops/{workshop_id}/trials")
async def foundry_trials_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_trials(workshop_id))


@app.post("/api/v1/workshops/{workshop_id}/trials")
async def create_foundry_trial_endpoint(workshop_id: str, data: CreateTrialInput):
    artifact_id = data.artifactId.strip()
    construct_id = data.constructId.strip()
    message_id = data.messageId.strip()
    prompt = data.prompt.strip()
    response = data.response.strip()
    runtime_mode = data.runtimeMode.strip()

    if not artifact_id:
        raise HTTPException(status_code=400, detail="Artifact id cannot be empty.")
    if not construct_id:
        raise HTTPException(status_code=400, detail="Construct id cannot be empty.")
    if not message_id:
        raise HTTPException(status_code=400, detail="Message id cannot be empty.")
    if not prompt:
        raise HTTPException(status_code=400, detail="Trial prompt cannot be empty.")
    if not response:
        raise HTTPException(status_code=400, detail="Trial response cannot be empty.")
    if not runtime_mode:
        raise HTTPException(status_code=400, detail="Runtime mode cannot be empty.")
    if data.tokenCount < 0:
        raise HTTPException(status_code=400, detail="Token count cannot be negative.")

    try:
        trial = await foundry_catalog_service.create_trial(
            workshop_id=workshop_id,
            artifact_id=artifact_id,
            construct_id=construct_id,
            message_id=message_id,
            prompt=prompt,
            response=response,
            verdict=data.verdict,
            runtime_mode=runtime_mode,
            token_count=data.tokenCount,
            generation_settings=data.generationSettings,
        )
        return api_envelope(trial)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/workshops/{workshop_id}/trials/export")
async def export_foundry_trials_endpoint(workshop_id: str, data: ExportTrialsInput):
    trial_ids = [trial_id.strip() for trial_id in data.trialIds if trial_id.strip()]
    verdicts = list(dict.fromkeys(data.verdicts))
    if not trial_ids and not verdicts:
        raise HTTPException(status_code=400, detail="Select Trials or verdicts to export.")

    try:
        export = await foundry_catalog_service.export_trials_to_material(
            workshop_id=workshop_id,
            trial_ids=trial_ids,
            verdicts=verdicts,
            name=data.name.strip() if data.name else None,
        )
        return api_envelope(export)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/forges/{forge_run_id}/evaluation/weak-samples/export")
async def export_foundry_evaluation_weak_samples_endpoint(
    forge_run_id: str,
    data: ExportEvaluationSamplesInput,
):
    try:
        forge = await foundry_catalog_service.get_forge_run(forge_run_id)
        if forge.get("purpose") != "evaluation":
            raise ValueError("Only evaluation Forges can export weak samples.")
        metrics = forge_training_service.get_metrics(forge_run_id)
        evaluation_report = metrics.get("evaluationReport")
        if not evaluation_report:
            raise ValueError("Forge evaluation report is not ready yet.")
        export = await foundry_catalog_service.export_evaluation_samples_to_material(
            forge_run=forge,
            evaluation_report=evaluation_report,
            name=data.name.strip() if data.name else None,
            reviewed_samples=[
                {
                    "instruction": sample.instruction.strip(),
                    "expected": sample.expected.strip(),
                    "observed": sample.observed.strip(),
                    "verdict": sample.verdict,
                    "note": sample.note.strip(),
                }
                for sample in data.samples
                if sample.instruction.strip() and sample.expected.strip()
            ],
        )
        return api_envelope(export)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/constructs/{construct_id}/chat")
async def chat_with_foundry_construct_endpoint(construct_id: str, data: ConstructChatInput):
    conversation_id = data.conversationId.strip()
    message = data.message.strip()
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Conversation id cannot be empty.")
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if data.maxNewTokens is not None and data.maxNewTokens < 1:
        raise HTTPException(status_code=400, detail="Max new tokens must be positive.")
    if data.temperature is not None and (data.temperature < 0 or data.temperature > 2):
        raise HTTPException(status_code=400, detail="Temperature must be between 0 and 2.")

    try:
        response = await foundry_catalog_service.chat_with_construct(
            construct_id=construct_id,
            conversation_id=conversation_id,
            message=message,
            system_prompt=data.systemPrompt.strip() if data.systemPrompt else None,
            include_library_context=data.includeLibraryContext,
            max_new_tokens=data.maxNewTokens,
            temperature=data.temperature,
        )
        return api_envelope(response)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


@app.post("/api/v1/constructs/{construct_id}/chat/stream")
async def stream_foundry_construct_chat_endpoint(construct_id: str, data: ConstructChatInput):
    conversation_id = data.conversationId.strip()
    message = data.message.strip()
    if not conversation_id:
        raise HTTPException(status_code=400, detail="Conversation id cannot be empty.")
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    if data.maxNewTokens is not None and data.maxNewTokens < 1:
        raise HTTPException(status_code=400, detail="Max new tokens must be positive.")
    if data.temperature is not None and (data.temperature < 0 or data.temperature > 2):
        raise HTTPException(status_code=400, detail="Temperature must be between 0 and 2.")

    async def event_stream():
        try:
            prepared = await foundry_catalog_service.prepare_construct_chat_response(
                construct_id=construct_id,
                conversation_id=conversation_id,
                message=message,
                system_prompt=data.systemPrompt.strip() if data.systemPrompt else None,
                include_library_context=data.includeLibraryContext,
                max_new_tokens=data.maxNewTokens,
                temperature=data.temperature,
            )
            streamed_tokens = []
            async for token in construct_inference_service.stream_tokens(
                prepared_response=prepared,
                user_message=message,
                system_prompt=data.systemPrompt.strip() if data.systemPrompt else None,
            ):
                streamed_tokens.append(token)
                yield sse_event(
                    "token",
                    {
                        "type": "token",
                        "token": token,
                        "index": len(streamed_tokens) - 1,
                    },
                )

            response_text = "".join(streamed_tokens)
            runtime_payload = construct_inference_service.runtime_payload()
            generation_settings = dict(prepared["generation"])
            generation_settings["runtime"] = runtime_payload
            trial = await foundry_catalog_service.persist_prepared_construct_chat_response(
                construct_id=construct_id,
                conversation_id=conversation_id,
                user_message_id=prepared["userMessageId"],
                assistant_message_id=prepared["message"]["id"],
                user_text=message,
                response_text=response_text,
                generation_settings=generation_settings,
                runtime_mode=runtime_payload.get("mode", "simulated"),
            )
            yield sse_event(
                "done",
                {
                    "type": "done",
                    "messageId": prepared["message"]["id"],
                    "totalTokens": len(response_text.split()),
                    "construct": prepared["construct"],
                    "artifact": prepared["artifact"],
                    "generation": prepared["generation"],
                    "runtime": runtime_payload,
                    "trial": trial,
                },
            )
        except ValueError as error:
            yield sse_event("error", {"type": "error", "message": str(error)})
        except Exception as error:
            construct_inference_service.record_runtime_event(
                event_type="smoke",
                status="failed",
                title="Construct stream failed",
                detail=str(error),
                source="backend",
            )
            yield sse_event("error", {"type": "error", "message": str(error)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/query/")
async def query_endpoint(data: QueryInput):
    """
    Process input prompt to generate QA pairs using the LLM and return the response for further processing.
    """
    query_text = data.query.strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="Query text cannot be empty.")
    
    logger.info(f"Received query: {query_text}")
    
    try:
        logger.info(f"Generating QA pairs for the prompt: {query_text}")
        llm_response = await chat_service.generate_query_response(
            query=query_text,
            max_length=512,  # Adjust based on your specific LLM and use case
            temperature=0.7,
            top_p=0.9
        )
        logger.info(f"LLM Response: {llm_response}")

        return llm_response

    except Exception as e:
        logger.error(f"Error processing query: {e}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {e}")

@app.websocket("/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"WebSocket connection accepted. Active connections: {len(active_connections)}")

    try:
        while True:
            data = await websocket.receive_text()
            message = data.strip()
            if not message:
                await websocket.send_text("Error: Chat text cannot be empty.")
                continue

            logger.info(f"Received chat message: {message}")

            try:
                async for token in chat_service.stream_chat(message):
                    await websocket.send_text(token)
            except Exception as e:
                logger.error(f"Error processing chat: {e}")
                await websocket.send_text("Error: Internal Server Error")
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Active connections: {len(active_connections)}")

@app.post("/feedback/")
async def feedback_endpoint(data: FeedbackInput):
    """
    Collects user feedback on the LLM response.
    """
    logger.info(f"Received feedback for query: {data.query}")
    try:
        # Placeholder: Add logic for processing feedback
        logger.info(f"Feedback details: {data.dict()}")
        return {"status": "success", "message": "Feedback received successfully."}
    except Exception as e:
        logger.error(f"Error processing feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {e}")

@app.on_event("startup")
async def on_startup():
    """
    Startup logic for initializing components.
    """
    logger.info("API server starting. Chat orchestration will load lazily.")

@app.on_event("shutdown")
async def on_shutdown():
    """
    Shutdown logic for cleanup.
    """
    logger.info("API server shutting down...")

@app.post("/conversation/save")
async def save_conversation(data: ConversationInput):
    try:
        history = await chat_service.get_conversation_history()
        return {"conversation_id": data.conversation_id, "messages": history}
    except Exception as e:
        logger.error(f"Error saving conversation: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)
    
@app.post("/conversation/load")
async def load_conversation(data: ConversationInput):
    try:
        memory = await chat_service.get_conversation_history()
        if memory:
            return {"conversation_id": data.conversation_id, "messages": memory}
        else:
            return {"status": "error", "message": f"Conversation {data.conversation_id} not found."}
    except Exception as e:
        logger.error(f"Error loading conversation: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)
    
@app.post("/conversation/reset")
async def reset_conversation():
    """
    Endpoint to start a new conversation by clearing the memory.
    """
    try:
        await chat_service.reset_conversation()
        return {"status": "success", "message": "Conversation reset successfully."}
    except Exception as e:
        logger.error(f"Error resetting conversation: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)
