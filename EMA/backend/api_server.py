
import json
from typing import Any, Literal, Set
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from utilities.logger import get_logger
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
from backend.services.chat_orchestration_service import ChatOrchestrationService
from backend.services.construct_inference_service import ConstructInferenceService
from backend.services.forge_training_service import ForgeTrainingService
from backend.services.foundry_catalog_service import FoundryCatalogService


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

class StartAssemblyLineInput(BaseModel):
    materialSourceIds: list[str]
    chunkSizeTokens: int
    chunkOverlapTokens: int
    qaPairsPerSource: int

class ExportQAPairsInput(BaseModel):
    assemblyLineRunId: str
    name: str | None = None

class StartForgeInput(BaseModel):
    materialSetId: str
    baseModel: str
    method: Literal["LoRA", "QLoRA"]
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

# Initialize logger
logger = get_logger(__name__)

chat_service = ChatOrchestrationService()
construct_inference_service = ConstructInferenceService()
forge_training_service = ForgeTrainingService()
foundry_catalog_service = FoundryCatalogService()

active_connections: Set[WebSocket] = set()


def api_envelope(data: Any):
    return {"data": data, "requestId": str(uuid4())}


def sse_event(event_type: str, payload: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


@app.get("/api/v1/constructs/runtime")
async def foundry_construct_runtime_endpoint():
    return api_envelope(construct_inference_service.runtime_payload())


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
        runtime = await construct_inference_service.load(model_id=data.modelId)
        return api_envelope(runtime)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Could not load runtime: {error}")


@app.post("/api/v1/constructs/runtime/unload")
async def unload_foundry_construct_runtime_endpoint():
    return api_envelope(await construct_inference_service.unload())


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


@app.get("/api/v1/workshops/{workshop_id}/assembly-lines")
async def foundry_assembly_lines_endpoint(workshop_id: str):
    return api_envelope(await foundry_catalog_service.list_assembly_line_runs(workshop_id))


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


@app.post("/api/v1/workshops/{workshop_id}/qa-pairs/export")
async def export_foundry_qa_pairs_endpoint(workshop_id: str, data: ExportQAPairsInput):
    run_id = data.assemblyLineRunId.strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="Assembly Line run id cannot be empty.")

    try:
        export = await foundry_catalog_service.export_qa_pairs_to_material(
            workshop_id=workshop_id,
            assembly_line_run_id=run_id,
            name=data.name.strip() if data.name else None,
        )
        return api_envelope(export)
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
        raise HTTPException(status_code=400, detail="Select a JSONL Material for training.")
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
        if forge["status"] == "completed":
            forge = await foundry_catalog_service.ensure_artifact_for_completed_forge(forge_run_id)
            state["forgeRun"] = forge
        return api_envelope(state)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))


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
            runtime = construct_inference_service.describe_runtime()
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
            await foundry_catalog_service.persist_prepared_construct_chat_response(
                construct_id=construct_id,
                conversation_id=conversation_id,
                user_message_id=prepared["userMessageId"],
                assistant_message_id=prepared["message"]["id"],
                user_text=message,
                response_text=response_text,
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
                    "runtime": {
                        "mode": runtime.mode,
                        "status": runtime.status,
                        "detail": runtime.detail,
                        "modelId": runtime.modelId,
                        "device": runtime.device,
                        "loaded": runtime.loaded,
                    },
                },
            )
        except ValueError as error:
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
