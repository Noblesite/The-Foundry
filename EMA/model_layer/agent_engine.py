import json
import yaml
import time
import asyncio
import torch
from typing import Dict, Optional
from utilities.logger import get_logger
from model_layer.system_prompts import SystemPrompts
from model_layer.model_tools.file_reader_tool import FileReaderTool
from model_layer.model_tools.query_chroma_db_tool import QueryChromaDBTool
from data_layer.vector_database import VectorDatabase
from model_layer.llm_engine import LLMEngine
from model_layer.model_converstation_history import ConversationMemory
from utilities.path_manager import PathManager
from transformers import pipeline, AutoTokenizer, AutoModelForTokenClassification
from workspace_one_workflows.workflows.device_health_report import DeviceHealthReportInterface
from model_layer.model_tools.wso_device_health_report_by_enviroment import WSODeviceHealthReportByEnviroment
from model_layer.model_tools.python_code_reader_tool import PythonCodeReader
from model_layer.intent_engine import IntentEngine
 

class AgentEngine:
    def __init__(self):
        self.logger = get_logger("QueryProcessor")
        self.system_prompts = SystemPrompts()
        self.file_reader_tool = FileReaderTool()
        self.path_manager = PathManager()

        # Load EMA Config
        EMA_CONFIG_PATH = self.path_manager.get_path("EMA_CONFIG_PATH")
        try:
            with open(EMA_CONFIG_PATH, "r") as file:
                EMA_CONFIG = yaml.safe_load(file)
            self.logger.info("EMA config loaded successfully.")
        except FileNotFoundError:
            EMA_CONFIG = {}
            self.logger.error(f"EMA_CONFIG file not found at {EMA_CONFIG_PATH}.")
            raise

        # Initialize ChromaDB
        CHROMA_DB_PATH = self.path_manager.get_path("CHROMA_DB_PATH")
        self.INTENT_MAPPING = self.path_manager.get_path("INTENT_MAPPING")
        EMBEDDING_MODEL = EMA_CONFIG["models"]["embedding_model"]
        LLM = EMA_CONFIG["models"]["coordination_model_name"]
        ZS_MODEL = EMA_CONFIG["models"]["zero_shot_model"]
        NER_MODEL = EMA_CONFIG["models"]["ner_model_name"]

        MAX_CON_HISTORY = EMA_CONFIG["converstation_history"]["max_history"]
        self.conversation_history = ConversationMemory(max_history=MAX_CON_HISTORY)

        self.vector_db = VectorDatabase(CHROMA_DB_PATH, EMBEDDING_MODEL)
        self.chroma_tool = QueryChromaDBTool(self.vector_db)
        self.llm_engine = LLMEngine(model_name=LLM, converstation_history=self.conversation_history)

        # ✅ Load Zero-Shot Intent Classifier
        self.intent_classifier = pipeline("zero-shot-classification", model=ZS_MODEL)
        self.intent_engine = IntentEngine(classifier=self.intent_classifier, config_path=self.INTENT_MAPPING)

        # ✅ Load Named Entity Recognition (NER) Model
        self.ner_tokenizer = AutoTokenizer.from_pretrained(NER_MODEL)
        self.ner_model = AutoModelForTokenClassification.from_pretrained(NER_MODEL)
        self.ner_pipeline = pipeline("ner", model=self.ner_model, tokenizer=self.ner_tokenizer)

        # ✅ Initialize WSO Device Health Tool
        self.wso_device_health_tool = WSODeviceHealthReportByEnviroment()

    async def _parse_intent(self, user_query: str):
       
        top_intent = self.intent_engine.classify_intent(user_query)
        
        self.logger.debug(f"IntentEngine Top Intent Returned: {top_intent} ")

        return top_intent

    async def stream_response(self, text: str):
        yield text
        await asyncio.sleep(0)

    async def process_query(self, user_query: str):
        """
        Processes user queries in an async generator format for WebSocket streaming.
        Uses a switch-case (match-case) structure for better readability.
        """
        intent = await self._parse_intent(user_query)

        match intent: # type: ignore
            case "get_device_records":
                self.logger.info("📊 Fetching Device Health Report.")

                # ✅ Extract Organization Group ID using NER
                extracted_entities = self.ner_pipeline(user_query)
                extracted_data = {entity['word']: entity['score'] for entity in extracted_entities}

                # ✅ Extract the most likely organization group ID
                organization_group_id = next((word for word, score in extracted_data.items() if score > 0.8), None)

                if not organization_group_id:
                    async for chunk in self.stream_response("Missing organization group ID. Please provide one."):
                        yield chunk
                    return

                # ✅ Call WSO Tool
                tool_output = self.wso_device_health_tool._run(int(organization_group_id))

                if tool_output:
                    tool_calls = [f"Device Health Report: {tool_output}"]
                    async for chunk in self.llm_engine.generate_response_stream(user_query, tool_calls=tool_calls):
                        yield chunk
                else:
                    async for chunk in self.stream_response("No data found for the provided organization group ID."):
                        yield chunk

            case "search_api_documents":
                self.logger.info("🔍 Searching API documentation.")

                tool_output = self.file_reader_tool.get_records()

                if tool_output:
                    formatted_results = json.dumps(tool_output, indent=2)
                    tool_calls = [f"API Documentation Results: {formatted_results}"]

                    async for chunk in self.llm_engine.generate_response_stream(
                        user_query,
                        tool_calls=tool_calls
                    ):
                        yield chunk
                else:
                    async for chunk in self.stream_response("No high-confidence results found."):
                        yield chunk

            case "execute_api_call":
                self.logger.info("🛠️ Extracting API parameters and executing request.")

                # ✅ Extract API Parameters using NER
                extracted_entities = self.ner_pipeline(user_query)
                extracted_data = {entity['word']: entity['score'] for entity in extracted_entities}

                tool_calls = [f"Extracted API Parameters: {json.dumps(extracted_data, indent=2)}"]

                async for chunk in self.llm_engine.generate_response_stream(
                    user_query,
                    tool_calls=tool_calls
                ):
                    yield chunk

            case "get_api_workflows":
                self.logger.info("🛠️ Pulling MDM Python Script.")

                mdm_endpoints_path = self.path_manager.get_path("WSO_WF_MDM_ENDPOINTS")

                self.logger.debug(f"get_api_workflows Directory or file: {mdm_endpoints_path}")

                python_code_reader = PythonCodeReader(mdm_endpoints_path)  

                found_files = python_code_reader.scan_directory() 
                self.logger.debug(f"get_api_workflows scan_directory: {found_files}")    

                tool_calls = [f"Mobile Device Managment Endpoints: {found_files}"]

                async for chunk in self.llm_engine.generate_response_stream(
                    user_query,
                    tool_calls=tool_calls
                ):
                    yield chunk

            case _ if intent.startswith("retrieve_"):
                self.logger.info("🔍 Using Dense Retrieval via `QueryChromaDBTool`.")

                # ✅ Use ChromaDB tool to retrieve data
                results = self.chroma_tool._run(user_query)
                parsed_results = json.loads(results) if results else None

                if parsed_results:
                    tool_calls = [f"ChromaDB Response: {parsed_results}"]

                    async for chunk in self.llm_engine.generate_response_stream(
                        user_query,
                        tool_calls=tool_calls
                    ):
                        yield chunk
                else:
                    async for chunk in self.stream_response("No relevant data found."):
                        yield chunk

            case _:
                self.logger.warning("🤖 Unknown intent detected.")
                async for chunk in self.llm_engine.generate_response_stream(user_query):
                    yield chunk

        await asyncio.sleep(0)  # Prevent blocking
