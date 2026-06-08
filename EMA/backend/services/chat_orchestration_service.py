from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Callable, Optional

from model_layer.model_converstation_history import ConversationMemory


EngineFactory = Callable[[], Any]


class ChatOrchestrationService:
    """
    Owns chat/RAG orchestration outside the FastAPI transport layer.

    The heavy AgentEngine stack is intentionally loaded lazily so importing the
    API server remains cheap and resilient when models, Chroma data, credentials,
    or optional GPU dependencies are unavailable.
    """

    def __init__(self, engine_factory: Optional[EngineFactory] = None):
        self.logger = logging.getLogger(self.__class__.__name__)
        self._engine_factory = engine_factory or self._default_engine_factory
        self._engine = None
        self._engine_lock = asyncio.Lock()
        self._fallback_history = ConversationMemory(max_history=10)

    @staticmethod
    def _default_engine_factory():
        from model_layer.agent_engine import AgentEngine

        return AgentEngine()

    @property
    def is_loaded(self) -> bool:
        return self._engine is not None

    async def _get_engine(self):
        if self._engine is not None:
            return self._engine

        async with self._engine_lock:
            if self._engine is None:
                self.logger.info("Lazy-loading chat orchestration engine.")
                self._engine = await asyncio.to_thread(self._engine_factory)
        return self._engine

    async def stream_chat(self, message: str) -> AsyncIterator[str]:
        clean_message = message.strip()
        if not clean_message:
            yield "Error: Chat text cannot be empty."
            return

        engine = await self._get_engine()
        async for token in engine.process_query(user_query=clean_message):
            yield token

    async def generate_query_response(self, query: str, **generation_options):
        clean_query = query.strip()
        if not clean_query:
            raise ValueError("Query text cannot be empty.")

        engine = await self._get_engine()
        if hasattr(engine, "generate_response"):
            return engine.generate_response(prompt=clean_query, **generation_options)

        chunks = []
        async for token in engine.process_query(user_query=clean_query):
            chunks.append(token)
        return "".join(chunks)

    async def get_conversation_history(self):
        if self._engine is None:
            return self._fallback_history.get_history()
        return self._engine.conversation_history.get_history()

    async def reset_conversation(self):
        if self._engine is None:
            self._fallback_history.clear_history()
            return
        self._engine.conversation_history.clear_history()
