from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4


BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = BASE_DIR / "runtime" / "foundry_catalog.db"
DEFAULT_EXPORT_DIR = BASE_DIR / "runtime" / "materials" / "exports"


class FoundryCatalogService:
    """
    SQLite-backed Foundry catalog.

    SQLite keeps the first public/self-hosted path simple while preserving a
    clean route surface for a future Postgres-backed repository.
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = Path(
            db_path or os.getenv("FOUNDRY_CATALOG_DB_PATH", str(DEFAULT_DB_PATH))
        )
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = asyncio.Lock()
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            self._create_schema(connection)
            self._seed_defaults(connection)
            self._ensure_trials_catalog_rows(connection)

    def _create_schema(self, connection: sqlite3.Connection) -> None:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS workshops (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                subject TEXT NOT NULL,
                voice_target TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                material_refinement INTEGER NOT NULL DEFAULT 0,
                active_artifact_id TEXT,
                active_construct_id TEXT,
                base_model TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS materials (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                source_uri TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                qa_pair_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id)
            );

            CREATE TABLE IF NOT EXISTS forge_runs (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                material_id TEXT,
                base_model TEXT,
                purpose TEXT NOT NULL DEFAULT 'training',
                label TEXT NOT NULL,
                method TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                epoch_current INTEGER,
                epoch_total INTEGER,
                learning_rate TEXT,
                load_in_4bit INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id),
                FOREIGN KEY(material_id) REFERENCES materials(id)
            );

            CREATE TABLE IF NOT EXISTS assembly_line_runs (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                material_source_ids_json TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                chunk_size_tokens INTEGER NOT NULL,
                chunk_overlap_tokens INTEGER NOT NULL,
                qa_pairs_per_source INTEGER NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                qa_pair_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id)
            );

            CREATE TABLE IF NOT EXISTS material_chunks (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                material_id TEXT NOT NULL,
                assembly_line_run_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                token_count INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id),
                FOREIGN KEY(material_id) REFERENCES materials(id),
                FOREIGN KEY(assembly_line_run_id) REFERENCES assembly_line_runs(id)
            );

            CREATE TABLE IF NOT EXISTS qa_pairs (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                material_id TEXT NOT NULL,
                chunk_id TEXT NOT NULL,
                assembly_line_run_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id),
                FOREIGN KEY(material_id) REFERENCES materials(id),
                FOREIGN KEY(chunk_id) REFERENCES material_chunks(id),
                FOREIGN KEY(assembly_line_run_id) REFERENCES assembly_line_runs(id)
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                forge_run_id TEXT,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                base_model TEXT NOT NULL,
                adapter_path TEXT,
                status TEXT NOT NULL,
                training_method TEXT NOT NULL,
                trial_score INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id)
            );

            CREATE TABLE IF NOT EXISTS constructs (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                streaming_enabled INTEGER NOT NULL DEFAULT 1,
                context_window INTEGER NOT NULL DEFAULT 8192,
                max_new_tokens INTEGER NOT NULL DEFAULT 512,
                temperature REAL NOT NULL DEFAULT 0.7,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id),
                FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
            );

            CREATE TABLE IF NOT EXISTS construct_messages (
                id TEXT PRIMARY KEY,
                construct_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                token_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(construct_id) REFERENCES constructs(id)
            );

            CREATE TABLE IF NOT EXISTS trials (
                id TEXT PRIMARY KEY,
                workshop_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                construct_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                response TEXT NOT NULL,
                verdict TEXT NOT NULL,
                runtime_mode TEXT NOT NULL,
                token_count INTEGER NOT NULL DEFAULT 0,
                generation_settings_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workshop_id) REFERENCES workshops(id),
                FOREIGN KEY(artifact_id) REFERENCES artifacts(id),
                FOREIGN KEY(construct_id) REFERENCES constructs(id)
            );

            CREATE TABLE IF NOT EXISTS academy_concepts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                concept TEXT NOT NULL,
                short_explanation TEXT NOT NULL,
                related_stations_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ui_component_catalog (
                id TEXT PRIMARY KEY,
                component TEXT NOT NULL,
                station TEXT NOT NULL,
                purpose TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                last_updated TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS navigation_items (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                icon TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS section_summaries (
                id TEXT PRIMARY KEY,
                eyebrow TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                stats_json TEXT NOT NULL,
                concept_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_workshops_status_updated
                ON workshops(status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_materials_workshop_status
                ON materials(workshop_id, status);
            CREATE INDEX IF NOT EXISTS idx_forge_runs_workshop_status_updated
                ON forge_runs(workshop_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_assembly_line_runs_workshop_status_updated
                ON assembly_line_runs(workshop_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_material_chunks_material_run
                ON material_chunks(material_id, assembly_line_run_id);
            CREATE INDEX IF NOT EXISTS idx_qa_pairs_material_run
                ON qa_pairs(material_id, assembly_line_run_id);
            CREATE INDEX IF NOT EXISTS idx_artifacts_workshop_status_version
                ON artifacts(workshop_id, status, version);
            CREATE INDEX IF NOT EXISTS idx_constructs_workshop_artifact
                ON constructs(workshop_id, artifact_id);
            CREATE INDEX IF NOT EXISTS idx_construct_messages_construct_conversation
                ON construct_messages(construct_id, conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_trials_workshop_created
                ON trials(workshop_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_trials_artifact_verdict
                ON trials(artifact_id, verdict);
            CREATE INDEX IF NOT EXISTS idx_academy_concepts_concept
                ON academy_concepts(concept);
            CREATE INDEX IF NOT EXISTS idx_ui_component_station_component_cache
                ON ui_component_catalog(station, component, cache_key);
            """
        )
        self._ensure_forge_contract_columns(connection)

    def _ensure_forge_contract_columns(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(forge_runs)").fetchall()
        }
        migrations = [
            ("material_id", "ALTER TABLE forge_runs ADD COLUMN material_id TEXT"),
            ("base_model", "ALTER TABLE forge_runs ADD COLUMN base_model TEXT"),
            ("purpose", "ALTER TABLE forge_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'training'"),
            ("learning_rate", "ALTER TABLE forge_runs ADD COLUMN learning_rate TEXT"),
            ("load_in_4bit", "ALTER TABLE forge_runs ADD COLUMN load_in_4bit INTEGER NOT NULL DEFAULT 0"),
        ]
        for column_name, statement in migrations:
            if column_name not in columns:
                connection.execute(statement)

    def _seed_defaults(self, connection: sqlite3.Connection) -> None:
        if connection.execute("SELECT COUNT(*) FROM workshops").fetchone()[0] > 0:
            return

        workshop_id = "wrk-marshall-001"
        artifact_id = "art-marshall-123"
        construct_id = "con-marshall-local"
        base_model = "mistralai/Mistral-7B-Instruct-v0.2"

        connection.execute(
            """
            INSERT INTO workshops (
                id, name, subject, voice_target, status, progress,
                material_refinement, active_artifact_id, active_construct_id, base_model
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workshop_id,
                "Paw Patrol Workshop",
                "Paw Patrol",
                "Marshall",
                "forging",
                72,
                51,
                artifact_id,
                construct_id,
                base_model,
            ),
        )

        connection.executemany(
            """
            INSERT INTO materials (
                id, workshop_id, name, kind, status, source_uri,
                chunk_count, qa_pair_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "src-episode-transcripts",
                    workshop_id,
                    "Episode transcripts",
                    "transcript",
                    "qa-ready",
                    "runtime/materials/sources/transcripts",
                    524,
                    288,
                ),
                (
                    "src-wiki-pages",
                    workshop_id,
                    "Character wiki pages",
                    "website",
                    "chunked",
                    "https://example.local/paw-patrol/wiki",
                    391,
                    174,
                ),
                (
                    "src-safety-guide",
                    workshop_id,
                    "Rescue safety guide",
                    "pdf",
                    "needs-review",
                    "runtime/materials/sources/safety-guide.pdf",
                    333,
                    180,
                ),
            ],
        )

        connection.executemany(
            """
            INSERT INTO forge_runs (
                id, workshop_id, label, method, status, progress,
                epoch_current, epoch_total, purpose
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("frg-lora-001", workshop_id, "LoRA Training", "LoRA", "running", 45, 2, 3, "training"),
                ("frg-qa-001", workshop_id, "QA Generation", "QA Generation", "running", 87, None, None, "training"),
            ],
        )

        connection.execute(
            """
            INSERT INTO artifacts (
                id, workshop_id, name, version, base_model, status,
                training_method, trial_score
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                workshop_id,
                "Marshall Model",
                "v1.2.3",
                base_model,
                "ready",
                "QLoRA",
                82,
            ),
        )

        connection.execute(
            """
            INSERT INTO constructs (
                id, workshop_id, artifact_id, name, status, streaming_enabled,
                context_window, max_new_tokens, temperature
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                construct_id,
                workshop_id,
                artifact_id,
                "Marshall Local Construct",
                "streaming",
                1,
                8192,
                512,
                0.7,
            ),
        )

        connection.executemany(
            """
            INSERT INTO navigation_items (id, label, icon, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            [
                ("workshop", "Workshop", "fa-screwdriver-wrench", 10),
                ("materials", "Materials", "fa-box-archive", 20),
                ("forge", "Forge", "fa-fire-flame-curved", 30),
                ("artifacts", "Artifacts", "fa-cubes", 40),
                ("construct", "Construct", "fa-play", 50),
                ("library", "Library", "fa-book-open", 60),
                ("trials", "Trials", "fa-scale-balanced", 65),
                ("academy", "Academy", "fa-graduation-cap", 70),
                ("settings", "Settings", "fa-gear", 80),
            ],
        )

        section_rows = self._default_section_rows()
        connection.executemany(
            """
            INSERT INTO section_summaries (
                id, eyebrow, title, body, stats_json, concept_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            section_rows,
        )

        connection.executemany(
            """
            INSERT INTO academy_concepts (
                id, title, concept, short_explanation, related_stations_json
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    "acd-attention-layers",
                    "Understanding Attention Layers",
                    "attention",
                    "Attention helps a model weigh which tokens matter to the next token it generates.",
                    json.dumps(["academy", "forge", "construct"]),
                )
            ],
        )

        connection.executemany(
            """
            INSERT INTO ui_component_catalog (
                id, component, station, purpose, cache_key, last_updated
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "ui-dashboard-progress-ring",
                    "ProgressRing",
                    "workshop",
                    "Shows Workshop completion without requiring a backend render pass.",
                    "foundry:ui:progress-ring:v1",
                    "2026-06-07T00:00:00Z",
                ),
                (
                    "ui-construct-chat",
                    "ConstructWorkbench",
                    "construct",
                    "Hosts local model interaction and token streaming controls.",
                    "foundry:ui:construct-workbench:v1",
                    "2026-06-07T00:00:00Z",
                ),
                (
                    "ui-academy-tooltip",
                    "ConceptTooltip",
                    "academy",
                    "Keeps STEM explanations close to the action the user is taking.",
                    "foundry:ui:concept-tooltip:v1",
                    "2026-06-07T00:00:00Z",
                ),
            ],
        )

    def _ensure_trials_catalog_rows(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            INSERT OR IGNORE INTO navigation_items (id, label, icon, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            ("trials", "Trials", "fa-scale-balanced", 65),
        )
        for row in self._default_section_rows():
            if row[0] != "trials":
                continue
            connection.execute(
                """
                INSERT OR IGNORE INTO section_summaries (
                    id, eyebrow, title, body, stats_json, concept_json
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                row,
            )

    def _default_section_rows(self) -> List[tuple]:
        sections = {
            "materials": {
                "eyebrow": "Raw inputs",
                "title": "Materials",
                "body": "Upload transcripts, PDFs, CSV files, websites, and other source material before the Assembly Line turns them into model-ready examples.",
                "stats": [
                    {"label": "Sources staged", "value": "18"},
                    {"label": "Chunks prepared", "value": "1,248"},
                    {"label": "QA pairs", "value": "642"},
                ],
                "concept": {
                    "title": "Why Materials matter",
                    "body": "Materials define what the model can learn. Better sources create better examples, cleaner retrieval, and safer fine tuning.",
                },
            },
            "forge": {
                "eyebrow": "Training floor",
                "title": "Forge",
                "body": "Configure LoRA and QLoRA runs, watch training progress, and learn what each training metric is telling you.",
                "stats": [
                    {"label": "Active Forges", "value": "2"},
                    {"label": "Adapter method", "value": "QLoRA"},
                    {"label": "Epoch", "value": "2 / 3"},
                ],
                "concept": {
                    "title": "What is LoRA?",
                    "body": "LoRA trains small update matrices instead of changing every model weight, making fine-tuning faster and more memory efficient.",
                },
            },
            "artifacts": {
                "eyebrow": "Models out",
                "title": "Artifacts",
                "body": "Compare trained adapters, checkpoints, quantized builds, and model cards before promoting one into a Construct.",
                "stats": [
                    {"label": "Latest", "value": "Marshall Model v1.2.3"},
                    {"label": "Trials passed", "value": "8 / 10"},
                    {"label": "Ready", "value": "1 Artifact"},
                ],
                "concept": {
                    "title": "What is an Artifact?",
                    "body": "An Artifact is a saved model state, adapter, or checkpoint that can be evaluated, compared, archived, and loaded into a Construct.",
                },
            },
            "library": {
                "eyebrow": "Retrieval shelf",
                "title": "Library",
                "body": "Inspect indexed knowledge, embeddings, citations, and retrieval quality for Library-augmented Constructs.",
                "stats": [
                    {"label": "Indexed chunks", "value": "1,248"},
                    {"label": "Embedding model", "value": "MiniLM"},
                    {"label": "Recall trial", "value": "82%"},
                ],
                "concept": {
                    "title": "Why retrieval exists",
                    "body": "The Library lets a Construct look up source-grounded context instead of relying only on weights learned during training.",
                },
            },
            "trials": {
                "eyebrow": "Evaluation bench",
                "title": "Trials",
                "body": "Review saved Construct replies, compare verdicts, and turn human evaluation into Artifact quality signals.",
                "stats": [
                    {"label": "Saved replies", "value": "0"},
                    {"label": "Verdicts", "value": "Pass / Needs work / Fail"},
                    {"label": "Artifact score", "value": "Live"},
                ],
                "concept": {
                    "title": "Why Trials matter",
                    "body": "Trials capture real prompts, generated replies, settings, and human verdicts so a model can be evaluated before promotion.",
                },
            },
            "academy": {
                "eyebrow": "Learn as you build",
                "title": "Academy",
                "body": "Short lessons, diagrams, token previews, and metric explainers appear exactly where they help the build make sense.",
                "stats": [
                    {"label": "Active lesson", "value": "Understanding Attention Layers"},
                    {"label": "Concepts viewed", "value": "14"},
                    {"label": "Lab mode", "value": "Ready"},
                ],
                "concept": {
                    "title": "Learning is part of the build",
                    "body": "The Academy attaches concepts to real actions, so users learn tokenization, embeddings, attention, and fine tuning while doing the work.",
                },
            },
        }

        return [
            (
                section_id,
                value["eyebrow"],
                value["title"],
                value["body"],
                json.dumps(value["stats"]),
                json.dumps(value["concept"]),
            )
            for section_id, value in sections.items()
        ]

    async def _run_query(self, query):
        return await asyncio.to_thread(query)

    def _workshop_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "subject": row["subject"],
            "voiceTarget": row["voice_target"],
            "status": row["status"],
            "progress": row["progress"],
            "materialRefinement": row["material_refinement"],
            "activeArtifactId": row["active_artifact_id"],
            "activeConstructId": row["active_construct_id"],
        }

    def _material_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "status": row["status"],
            "sourceUri": row["source_uri"],
            "chunkCount": row["chunk_count"],
            "qaPairCount": row["qa_pair_count"],
        }

    def _assembly_line_run_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "materialSourceIds": json.loads(row["material_source_ids_json"]),
            "status": row["status"],
            "progress": row["progress"],
            "chunkSizeTokens": row["chunk_size_tokens"],
            "chunkOverlapTokens": row["chunk_overlap_tokens"],
            "qaPairsPerSource": row["qa_pairs_per_source"],
            "chunkCount": row["chunk_count"],
            "qaPairCount": row["qa_pair_count"],
        }

    def _chunk_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "materialId": row["material_id"],
            "assemblyLineRunId": row["assembly_line_run_id"],
            "chunkIndex": row["chunk_index"],
            "text": row["text"],
            "tokenCount": row["token_count"],
        }

    def _qa_pair_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "materialId": row["material_id"],
            "chunkId": row["chunk_id"],
            "assemblyLineRunId": row["assembly_line_run_id"],
            "question": row["question"],
            "answer": row["answer"],
        }

    async def list_workshops(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM workshops
                    ORDER BY datetime(updated_at) DESC, name ASC
                    """
                ).fetchall()
                return [self._workshop_from_row(row) for row in rows]

        return await self._run_query(query)

    async def create_workshop(
        self,
        name: str,
        subject: str,
        voice_target: Optional[str] = None,
        base_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._create_workshop_sync(name, subject, voice_target, base_model)
            )

    def _create_workshop_sync(
        self,
        name: str,
        subject: str,
        voice_target: Optional[str],
        base_model: Optional[str],
    ) -> Dict[str, Any]:
        workshop_id = f"wrk-{uuid4().hex[:12]}"
        artifact_id = f"art-{uuid4().hex[:12]}"
        construct_id = f"con-{uuid4().hex[:12]}"
        model_name = base_model or "mistralai/Mistral-7B-Instruct-v0.2"
        voice = voice_target or "Assistant"

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO workshops (
                    id, name, subject, voice_target, status, progress,
                    material_refinement, active_artifact_id, active_construct_id,
                    base_model
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workshop_id,
                    name,
                    subject,
                    voice,
                    "planning",
                    0,
                    0,
                    artifact_id,
                    construct_id,
                    model_name,
                ),
            )
            connection.execute(
                """
                INSERT INTO artifacts (
                    id, workshop_id, name, version, base_model, status,
                    training_method, trial_score
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact_id,
                    workshop_id,
                    f"{voice} Model",
                    "v0.0.1",
                    model_name,
                    "draft",
                    "QLoRA",
                    0,
                ),
            )
            connection.execute(
                """
                INSERT INTO constructs (
                    id, workshop_id, artifact_id, name, status,
                    streaming_enabled, context_window, max_new_tokens, temperature
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    construct_id,
                    workshop_id,
                    artifact_id,
                    f"{voice} Local Construct",
                    "offline",
                    1,
                    8192,
                    512,
                    0.7,
                ),
            )
            row = connection.execute(
                "SELECT * FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            return self._workshop_from_row(row)

    async def list_materials(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM materials
                    WHERE workshop_id = ?
                    ORDER BY datetime(created_at) DESC, name ASC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._material_from_row(row) for row in rows]

        return await self._run_query(query)

    async def get_material(self, workshop_id: str, material_id: str) -> Dict[str, Any]:
        def query():
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT * FROM materials
                    WHERE id = ? AND workshop_id = ?
                    """,
                    (material_id, workshop_id),
                ).fetchone()
                if row is None:
                    raise ValueError("Material was not found for this Workshop.")
                return self._material_from_row(row)

        return await self._run_query(query)

    async def list_artifacts(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM artifacts
                    WHERE workshop_id = ?
                    ORDER BY
                        CASE status WHEN 'ready' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END,
                        datetime(created_at) DESC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._artifact_from_row(row) for row in rows]

        return await self._run_query(query)

    async def load_artifact_into_construct(
        self,
        workshop_id: str,
        artifact_id: str,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._load_artifact_into_construct_sync(workshop_id, artifact_id)
            )

    def _load_artifact_into_construct_sync(
        self,
        workshop_id: str,
        artifact_id: str,
    ) -> Dict[str, Any]:
        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT * FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            artifact = connection.execute(
                """
                SELECT * FROM artifacts
                WHERE id = ? AND workshop_id = ?
                """,
                (artifact_id, workshop_id),
            ).fetchone()
            if artifact is None:
                raise ValueError("Artifact was not found for this Workshop.")
            if artifact["status"] == "archived":
                raise ValueError("Archived Artifacts cannot be loaded into a Construct.")

            construct = connection.execute(
                "SELECT * FROM constructs WHERE id = ?",
                (workshop["active_construct_id"],),
            ).fetchone()
            if construct is None:
                construct_id = f"con-{uuid4().hex[:12]}"
                connection.execute(
                    """
                    INSERT INTO constructs (
                        id, workshop_id, artifact_id, name, status,
                        streaming_enabled, context_window, max_new_tokens, temperature
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        construct_id,
                        workshop_id,
                        artifact_id,
                        f"{artifact['name']} Construct",
                        "warming",
                        1,
                        8192,
                        512,
                        0.7,
                    ),
                )
            else:
                construct_id = construct["id"]
                connection.execute(
                    """
                    UPDATE constructs
                    SET artifact_id = ?,
                        name = ?,
                        status = 'warming'
                    WHERE id = ?
                    """,
                    (artifact_id, f"{artifact['name']} Construct", construct_id),
                )

            connection.execute(
                """
                UPDATE workshops
                SET active_artifact_id = ?,
                    active_construct_id = ?,
                    status = 'ready',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (artifact_id, construct_id, workshop_id),
            )
            construct_row = connection.execute(
                "SELECT * FROM constructs WHERE id = ?",
                (construct_id,),
            ).fetchone()
            return self._construct_from_row(construct_row)

    async def list_constructs(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM constructs
                    WHERE workshop_id = ?
                    ORDER BY
                        CASE status WHEN 'streaming' THEN 0 WHEN 'warming' THEN 1 ELSE 2 END,
                        name ASC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._construct_from_row(row) for row in rows]

        return await self._run_query(query)

    async def list_trials(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM trials
                    WHERE workshop_id = ?
                    ORDER BY datetime(created_at) DESC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._trial_from_row(row) for row in rows]

        return await self._run_query(query)

    async def create_trial(
        self,
        workshop_id: str,
        artifact_id: str,
        construct_id: str,
        message_id: str,
        prompt: str,
        response: str,
        verdict: str,
        runtime_mode: str,
        token_count: int,
        generation_settings: Dict[str, Any],
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._create_trial_sync(
                    workshop_id=workshop_id,
                    artifact_id=artifact_id,
                    construct_id=construct_id,
                    message_id=message_id,
                    prompt=prompt,
                    response=response,
                    verdict=verdict,
                    runtime_mode=runtime_mode,
                    token_count=token_count,
                    generation_settings=generation_settings,
                )
            )

    def _create_trial_sync(
        self,
        workshop_id: str,
        artifact_id: str,
        construct_id: str,
        message_id: str,
        prompt: str,
        response: str,
        verdict: str,
        runtime_mode: str,
        token_count: int,
        generation_settings: Dict[str, Any],
    ) -> Dict[str, Any]:
        if verdict not in {"pass", "needs-work", "fail"}:
            raise ValueError("Trial verdict must be pass, needs-work, or fail.")

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            artifact = connection.execute(
                """
                SELECT * FROM artifacts
                WHERE id = ? AND workshop_id = ?
                """,
                (artifact_id, workshop_id),
            ).fetchone()
            if artifact is None:
                raise ValueError("Artifact was not found for this Workshop.")

            construct = connection.execute(
                """
                SELECT * FROM constructs
                WHERE id = ? AND workshop_id = ?
                """,
                (construct_id, workshop_id),
            ).fetchone()
            if construct is None:
                raise ValueError("Construct was not found for this Workshop.")
            if construct["artifact_id"] != artifact_id:
                raise ValueError("Construct is not loaded with the selected Artifact.")

            trial_id = f"trl-{uuid4().hex[:12]}"
            connection.execute(
                """
                INSERT INTO trials (
                    id, workshop_id, artifact_id, construct_id, message_id,
                    prompt, response, verdict, runtime_mode, token_count,
                    generation_settings_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trial_id,
                    workshop_id,
                    artifact_id,
                    construct_id,
                    message_id,
                    prompt,
                    response,
                    verdict,
                    runtime_mode,
                    max(token_count, 0),
                    json.dumps(generation_settings),
                ),
            )
            self._refresh_artifact_trial_score(connection, artifact_id)
            row = connection.execute("SELECT * FROM trials WHERE id = ?", (trial_id,)).fetchone()
            return self._trial_from_row(row)

    async def export_trials_to_material(
        self,
        workshop_id: str,
        trial_ids: List[str],
        verdicts: List[str],
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._export_trials_to_material_sync(
                    workshop_id=workshop_id,
                    trial_ids=trial_ids,
                    verdicts=verdicts,
                    name=name,
                )
            )

    def _export_trials_to_material_sync(
        self,
        workshop_id: str,
        trial_ids: List[str],
        verdicts: List[str],
        name: Optional[str],
    ) -> Dict[str, Any]:
        invalid_verdicts = [verdict for verdict in verdicts if verdict not in {"pass", "needs-work", "fail"}]
        if invalid_verdicts:
            raise ValueError("Trial export verdicts must be pass, needs-work, or fail.")

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id, name FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            filters = ["workshop_id = ?"]
            params: List[Any] = [workshop_id]
            if trial_ids:
                placeholders = ", ".join("?" for _ in trial_ids)
                filters.append(f"id IN ({placeholders})")
                params.extend(trial_ids)
            if verdicts:
                placeholders = ", ".join("?" for _ in verdicts)
                filters.append(f"verdict IN ({placeholders})")
                params.extend(verdicts)

            rows = connection.execute(
                f"""
                SELECT * FROM trials
                WHERE {" AND ".join(filters)}
                ORDER BY datetime(created_at) ASC, id ASC
                """,
                params,
            ).fetchall()
            if not rows:
                raise ValueError("No Trials matched this export selection.")

            if trial_ids and len(rows) != len(set(trial_ids)):
                raise ValueError("One or more selected Trials were not found for this Workshop.")

            export_dir = DEFAULT_EXPORT_DIR / workshop_id
            export_dir.mkdir(parents=True, exist_ok=True)
            export_name = self._safe_export_name(name or f"{workshop['name']} Trial Dataset")
            export_path = export_dir / f"{export_name}-trials-{uuid4().hex[:8]}.jsonl"

            exported_verdicts = sorted({row["verdict"] for row in rows})
            with export_path.open("w", encoding="utf-8") as export_file:
                for index, row in enumerate(rows):
                    generation_settings = json.loads(row["generation_settings_json"])
                    payload = {
                        "id": row["id"],
                        "instruction": row["prompt"],
                        "input": "",
                        "output": row["response"],
                        "prompt": row["prompt"],
                        "response": row["response"],
                        "source": {
                            "workshopId": workshop_id,
                            "trialId": row["id"],
                            "artifactId": row["artifact_id"],
                            "constructId": row["construct_id"],
                            "messageId": row["message_id"],
                        },
                        "metadata": {
                            "format": "foundry.trial.v1",
                            "rowIndex": index,
                            "verdict": row["verdict"],
                            "runtimeMode": row["runtime_mode"],
                            "tokenCount": row["token_count"],
                            "generationSettings": generation_settings,
                            "createdAt": row["created_at"],
                        },
                    }
                    export_file.write(json.dumps(payload, ensure_ascii=False) + "\n")

            material = self._register_material_sync(
                workshop_id=workshop_id,
                name=name or f"{workshop['name']} Trial Dataset",
                kind="jsonl",
                source_uri=str(export_path.relative_to(BASE_DIR)),
            )
            connection.execute(
                """
                UPDATE materials
                SET status = 'qa-ready',
                    chunk_count = ?,
                    qa_pair_count = ?
                WHERE id = ? AND workshop_id = ?
                """,
                (len(rows), len(rows), material["id"], workshop_id),
            )
            connection.execute(
                """
                UPDATE workshops
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (workshop_id,),
            )
            material_row = connection.execute(
                "SELECT * FROM materials WHERE id = ?",
                (material["id"],),
            ).fetchone()

            return {
                "material": self._material_from_row(material_row),
                "exportUri": str(export_path.relative_to(BASE_DIR)),
                "format": "jsonl",
                "trialCount": len(rows),
                "verdicts": exported_verdicts,
            }

    async def export_evaluation_samples_to_material(
        self,
        forge_run: Dict[str, Any],
        evaluation_report: Dict[str, Any],
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._export_evaluation_samples_to_material_sync(
                    forge_run=forge_run,
                    evaluation_report=evaluation_report,
                    name=name,
                )
            )

    def _export_evaluation_samples_to_material_sync(
        self,
        forge_run: Dict[str, Any],
        evaluation_report: Dict[str, Any],
        name: Optional[str],
    ) -> Dict[str, Any]:
        workshop_id = forge_run["workshopId"]
        weak_samples = [
            sample
            for sample in evaluation_report.get("samples", [])
            if sample.get("verdict") in {"needs-work", "fail"}
        ]
        if not weak_samples:
            raise ValueError("This Trial Report has no weak samples to export.")

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id, name FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            export_dir = DEFAULT_EXPORT_DIR / workshop_id
            export_dir.mkdir(parents=True, exist_ok=True)
            export_name = self._safe_export_name(name or f"{workshop['name']} Weak Trial Samples")
            export_path = export_dir / f"{export_name}-weak-samples-{uuid4().hex[:8]}.jsonl"
            exported_verdicts = sorted({sample["verdict"] for sample in weak_samples})

            with export_path.open("w", encoding="utf-8") as export_file:
                for index, sample in enumerate(weak_samples):
                    payload = {
                        "id": f"{evaluation_report['forgeRunId']}-weak-{index}",
                        "instruction": sample["instruction"],
                        "input": "",
                        "output": sample["expected"],
                        "prompt": sample["instruction"],
                        "response": sample["expected"],
                        "source": {
                            "workshopId": workshop_id,
                            "forgeRunId": evaluation_report["forgeRunId"],
                            "materialId": evaluation_report["materialId"],
                            "datasetUri": evaluation_report["datasetUri"],
                        },
                        "metadata": {
                            "format": "foundry.evaluation.weak-sample.v1",
                            "rowIndex": index,
                            "verdict": sample["verdict"],
                            "observed": sample.get("observed", ""),
                            "note": sample.get("note", ""),
                            "reportVersion": evaluation_report["reportVersion"],
                            "createdAt": evaluation_report["createdAt"],
                        },
                    }
                    export_file.write(json.dumps(payload, ensure_ascii=False) + "\n")

            material = self._register_material_sync(
                workshop_id=workshop_id,
                name=name or f"{workshop['name']} Weak Trial Samples",
                kind="jsonl",
                source_uri=str(export_path.relative_to(BASE_DIR)),
            )
            connection.execute(
                """
                UPDATE materials
                SET status = 'qa-ready',
                    chunk_count = ?,
                    qa_pair_count = ?
                WHERE id = ? AND workshop_id = ?
                """,
                (len(weak_samples), len(weak_samples), material["id"], workshop_id),
            )
            connection.execute(
                """
                UPDATE workshops
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (workshop_id,),
            )
            material_row = connection.execute(
                "SELECT * FROM materials WHERE id = ?",
                (material["id"],),
            ).fetchone()

            return {
                "material": self._material_from_row(material_row),
                "exportUri": str(export_path.relative_to(BASE_DIR)),
                "format": "jsonl",
                "sampleCount": len(weak_samples),
                "verdicts": exported_verdicts,
                "forgeRunId": evaluation_report["forgeRunId"],
            }

    async def chat_with_construct(
        self,
        construct_id: str,
        conversation_id: str,
        message: str,
        include_library_context: bool,
        max_new_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._chat_with_construct_sync(
                    construct_id,
                    conversation_id,
                    message,
                    include_library_context,
                    max_new_tokens,
                    temperature,
                    system_prompt,
                )
            )

    async def prepare_construct_chat_response(
        self,
        construct_id: str,
        conversation_id: str,
        message: str,
        include_library_context: bool,
        max_new_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self._run_query(
            lambda: self._prepare_construct_chat_response_sync(
                construct_id,
                conversation_id,
                message,
                include_library_context,
                max_new_tokens,
                temperature,
                system_prompt,
            )
        )

    def _chat_with_construct_sync(
        self,
        construct_id: str,
        conversation_id: str,
        message: str,
        include_library_context: bool,
        max_new_tokens: Optional[int],
        temperature: Optional[float],
        system_prompt: Optional[str],
    ) -> Dict[str, Any]:
        prepared = self._prepare_construct_chat_response_sync(
            construct_id,
            conversation_id,
            message,
            include_library_context,
            max_new_tokens,
            temperature,
            system_prompt,
        )
        with self._connect() as connection:
            self._persist_construct_chat_response(
                connection=connection,
                construct_id=construct_id,
                conversation_id=conversation_id,
                user_message_id=prepared["userMessageId"],
                assistant_message_id=prepared["message"]["id"],
                user_text=message,
                response_text=prepared["message"]["text"],
            )
            construct = connection.execute(
                "SELECT * FROM constructs WHERE id = ?",
                (construct_id,),
            ).fetchone()
            prepared["construct"] = self._construct_from_row(construct)
            return prepared

    def _prepare_construct_chat_response_sync(
        self,
        construct_id: str,
        conversation_id: str,
        message: str,
        include_library_context: bool,
        max_new_tokens: Optional[int],
        temperature: Optional[float],
        system_prompt: Optional[str],
    ) -> Dict[str, Any]:
        with self._connect() as connection:
            construct = connection.execute(
                "SELECT * FROM constructs WHERE id = ?",
                (construct_id,),
            ).fetchone()
            if construct is None:
                raise ValueError(f"Construct {construct_id} was not found.")

            artifact = connection.execute(
                "SELECT * FROM artifacts WHERE id = ?",
                (construct["artifact_id"],),
            ).fetchone()
            if artifact is None:
                raise ValueError("Loaded Artifact was not found for this Construct.")

            user_message_id = f"msg-{uuid4().hex[:12]}"
            assistant_message_id = f"msg-{uuid4().hex[:12]}"
            generation_settings = {
                "contextWindow": construct["context_window"],
                "maxNewTokens": max_new_tokens or construct["max_new_tokens"],
                "temperature": temperature if temperature is not None else construct["temperature"],
                "includeLibraryContext": include_library_context,
            }
            response_text = self._build_construct_response(
                artifact=artifact,
                construct=construct,
                message=message,
                generation_settings=generation_settings,
                system_prompt=system_prompt,
            )

            return {
                "conversationId": conversation_id,
                "construct": self._construct_from_row(construct),
                "artifact": self._artifact_from_row(artifact),
                "userMessageId": user_message_id,
                "message": {
                    "id": assistant_message_id,
                    "sender": "assistant",
                    "text": response_text,
                    "tokenCount": len(response_text.split()),
                },
                "generation": generation_settings,
            }

    async def persist_prepared_construct_chat_response(
        self,
        construct_id: str,
        conversation_id: str,
        user_message_id: str,
        assistant_message_id: str,
        user_text: str,
        response_text: str,
    ) -> None:
        async with self._write_lock:
            await self._run_query(
                lambda: self._persist_prepared_construct_chat_response_sync(
                    construct_id,
                    conversation_id,
                    user_message_id,
                    assistant_message_id,
                    user_text,
                    response_text,
                )
            )

    def _persist_prepared_construct_chat_response_sync(
        self,
        construct_id: str,
        conversation_id: str,
        user_message_id: str,
        assistant_message_id: str,
        user_text: str,
        response_text: str,
    ) -> None:
        with self._connect() as connection:
            self._persist_construct_chat_response(
                connection,
                construct_id,
                conversation_id,
                user_message_id,
                assistant_message_id,
                user_text,
                response_text,
            )

    def _persist_construct_chat_response(
        self,
        connection: sqlite3.Connection,
        construct_id: str,
        conversation_id: str,
        user_message_id: str,
        assistant_message_id: str,
        user_text: str,
        response_text: str,
    ) -> None:
        connection.executemany(
            """
            INSERT OR IGNORE INTO construct_messages (
                id, construct_id, conversation_id, sender, text, token_count
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    user_message_id,
                    construct_id,
                    conversation_id,
                    "user",
                    user_text,
                    len(user_text.split()),
                ),
                (
                    assistant_message_id,
                    construct_id,
                    conversation_id,
                    "assistant",
                    response_text,
                    len(response_text.split()),
                ),
            ],
        )
        connection.execute(
            """
            UPDATE constructs
            SET status = 'streaming'
            WHERE id = ?
            """,
            (construct_id,),
        )

    def _build_construct_response(
        self,
        artifact: sqlite3.Row,
        construct: sqlite3.Row,
        message: str,
        generation_settings: Dict[str, Any],
        system_prompt: Optional[str],
    ) -> str:
        library_line = (
            "Library context is enabled for this turn."
            if generation_settings["includeLibraryContext"]
            else "Library context is disabled for this turn."
        )
        prompt_line = f" System prompt hint: {system_prompt.strip()}" if system_prompt else ""
        return (
            f"Simulated response from {construct['name']} using Artifact "
            f"{artifact['name']} {artifact['version']} ({artifact['training_method']} on "
            f"{artifact['base_model']}). You asked: \"{message}\". "
            f"{library_line} Generation settings are max_new_tokens="
            f"{generation_settings['maxNewTokens']}, temperature="
            f"{generation_settings['temperature']}, context_window="
            f"{generation_settings['contextWindow']}.{prompt_line} "
            "This is the Construct runtime contract; the next engine swap can stream real model tokens here."
        )

    async def register_material(
        self,
        workshop_id: str,
        name: str,
        kind: str,
        source_uri: str,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._register_material_sync(workshop_id, name, kind, source_uri)
            )

    def _register_material_sync(
        self,
        workshop_id: str,
        name: str,
        kind: str,
        source_uri: str,
    ) -> Dict[str, Any]:
        material_id = f"mat-{uuid4().hex[:12]}"

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            connection.execute(
                """
                INSERT INTO materials (
                    id, workshop_id, name, kind, status, source_uri,
                    chunk_count, qa_pair_count
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (material_id, workshop_id, name, kind, "staged", source_uri, 0, 0),
            )
            connection.execute(
                """
                UPDATE workshops
                SET status = CASE WHEN status = 'planning' THEN 'assembling' ELSE status END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (workshop_id,),
            )
            row = connection.execute(
                "SELECT * FROM materials WHERE id = ?",
                (material_id,),
            ).fetchone()
            return self._material_from_row(row)

    async def list_assembly_line_runs(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM assembly_line_runs
                    WHERE workshop_id = ?
                    ORDER BY datetime(created_at) DESC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._assembly_line_run_from_row(row) for row in rows]

        return await self._run_query(query)

    async def list_material_chunks(
        self,
        workshop_id: str,
        assembly_line_run_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                if assembly_line_run_id:
                    rows = connection.execute(
                        """
                        SELECT * FROM material_chunks
                        WHERE workshop_id = ? AND assembly_line_run_id = ?
                        ORDER BY material_id ASC, chunk_index ASC
                        """,
                        (workshop_id, assembly_line_run_id),
                    ).fetchall()
                else:
                    rows = connection.execute(
                        """
                        SELECT * FROM material_chunks
                        WHERE workshop_id = ?
                        ORDER BY datetime(created_at) DESC, material_id ASC, chunk_index ASC
                        LIMIT 200
                        """,
                        (workshop_id,),
                    ).fetchall()
                return [self._chunk_from_row(row) for row in rows]

        return await self._run_query(query)

    async def list_qa_pairs(
        self,
        workshop_id: str,
        assembly_line_run_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                if assembly_line_run_id:
                    rows = connection.execute(
                        """
                        SELECT * FROM qa_pairs
                        WHERE workshop_id = ? AND assembly_line_run_id = ?
                        ORDER BY material_id ASC, created_at ASC
                        """,
                        (workshop_id, assembly_line_run_id),
                    ).fetchall()
                else:
                    rows = connection.execute(
                        """
                        SELECT * FROM qa_pairs
                        WHERE workshop_id = ?
                        ORDER BY datetime(created_at) DESC
                        LIMIT 200
                        """,
                        (workshop_id,),
                    ).fetchall()
                return [self._qa_pair_from_row(row) for row in rows]

        return await self._run_query(query)

    async def export_qa_pairs_to_material(
        self,
        workshop_id: str,
        assembly_line_run_id: str,
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._export_qa_pairs_to_material_sync(
                    workshop_id,
                    assembly_line_run_id,
                    name,
                )
            )

    def _export_qa_pairs_to_material_sync(
        self,
        workshop_id: str,
        assembly_line_run_id: str,
        name: Optional[str],
    ) -> Dict[str, Any]:
        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id, name FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            run = connection.execute(
                """
                SELECT * FROM assembly_line_runs
                WHERE id = ? AND workshop_id = ?
                """,
                (assembly_line_run_id, workshop_id),
            ).fetchone()
            if run is None:
                raise ValueError("Assembly Line run was not found for this Workshop.")

            rows = connection.execute(
                """
                SELECT
                    qa_pairs.id,
                    qa_pairs.question,
                    qa_pairs.answer,
                    qa_pairs.material_id,
                    qa_pairs.chunk_id,
                    qa_pairs.assembly_line_run_id,
                    material_chunks.text AS source_text,
                    materials.name AS material_name,
                    materials.source_uri AS source_uri
                FROM qa_pairs
                LEFT JOIN material_chunks ON material_chunks.id = qa_pairs.chunk_id
                LEFT JOIN materials ON materials.id = qa_pairs.material_id
                WHERE qa_pairs.workshop_id = ?
                    AND qa_pairs.assembly_line_run_id = ?
                ORDER BY qa_pairs.material_id ASC, qa_pairs.created_at ASC
                """,
                (workshop_id, assembly_line_run_id),
            ).fetchall()
            if not rows:
                raise ValueError("This Assembly Line run has no QA pairs to export.")

            export_dir = DEFAULT_EXPORT_DIR / workshop_id
            export_dir.mkdir(parents=True, exist_ok=True)
            export_name = self._safe_export_name(name or f"{workshop['name']} QA Dataset")
            export_path = export_dir / f"{export_name}-{assembly_line_run_id}.jsonl"

            with export_path.open("w", encoding="utf-8") as export_file:
                for index, row in enumerate(rows):
                    payload = {
                        "id": row["id"],
                        "instruction": row["question"],
                        "input": "",
                        "output": row["answer"],
                        "question": row["question"],
                        "answer": row["answer"],
                        "source": {
                            "workshopId": workshop_id,
                            "assemblyLineRunId": row["assembly_line_run_id"],
                            "materialId": row["material_id"],
                            "materialName": row["material_name"],
                            "sourceUri": row["source_uri"],
                            "chunkId": row["chunk_id"],
                            "chunkText": row["source_text"],
                        },
                        "metadata": {
                            "format": "foundry.qa.v1",
                            "rowIndex": index,
                        },
                    }
                    export_file.write(json.dumps(payload, ensure_ascii=False) + "\n")

            material = self._register_material_sync(
                workshop_id=workshop_id,
                name=name or f"{workshop['name']} QA Dataset",
                kind="jsonl",
                source_uri=str(export_path.relative_to(BASE_DIR)),
            )
            connection.execute(
                """
                UPDATE materials
                SET status = 'qa-ready',
                    chunk_count = ?,
                    qa_pair_count = ?
                WHERE id = ? AND workshop_id = ?
                """,
                (len(rows), len(rows), material["id"], workshop_id),
            )
            connection.execute(
                """
                UPDATE workshops
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (workshop_id,),
            )
            material_row = connection.execute(
                "SELECT * FROM materials WHERE id = ?",
                (material["id"],),
            ).fetchone()

            return {
                "material": self._material_from_row(material_row),
                "exportUri": str(export_path.relative_to(BASE_DIR)),
                "format": "jsonl",
                "qaPairCount": len(rows),
                "assemblyLineRunId": assembly_line_run_id,
            }

    async def list_forge_runs(self, workshop_id: str) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM forge_runs
                    WHERE workshop_id = ?
                    ORDER BY datetime(created_at) DESC
                    """,
                    (workshop_id,),
                ).fetchall()
                return [self._forge_run_from_row(row) for row in rows]

        return await self._run_query(query)

    async def get_forge_run(self, forge_run_id: str) -> Dict[str, Any]:
        def query():
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM forge_runs WHERE id = ?",
                    (forge_run_id,),
                ).fetchone()
                if row is None:
                    raise ValueError(f"Forge {forge_run_id} was not found.")
                return self._forge_run_from_row(row)

        return await self._run_query(query)

    async def start_forge(
        self,
        workshop_id: str,
        material_id: str,
        base_model: str,
        method: str,
        purpose: str,
        epochs: int,
        learning_rate: str,
        load_in_4bit: bool,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._start_forge_sync(
                    workshop_id,
                    material_id,
                    base_model,
                    method,
                    purpose,
                    epochs,
                    learning_rate,
                    load_in_4bit,
                )
            )

    def _start_forge_sync(
        self,
        workshop_id: str,
        material_id: str,
        base_model: str,
        method: str,
        purpose: str,
        epochs: int,
        learning_rate: str,
        load_in_4bit: bool,
    ) -> Dict[str, Any]:
        forge_id = f"frg-{uuid4().hex[:12]}"
        if purpose not in {"training", "evaluation"}:
            raise ValueError("Forge purpose must be training or evaluation.")

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id, voice_target FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            material = connection.execute(
                """
                SELECT * FROM materials
                WHERE id = ? AND workshop_id = ?
                """,
                (material_id, workshop_id),
            ).fetchone()
            if material is None:
                raise ValueError("Training Material was not found for this Workshop.")
            if material["kind"] != "jsonl":
                raise ValueError("Forge training currently requires an exported JSONL Material.")
            if material["qa_pair_count"] < 1:
                raise ValueError("Training Material has no QA pairs.")

            connection.execute(
                """
                INSERT INTO forge_runs (
                    id, workshop_id, material_id, base_model, purpose, label, method,
                    status, progress, epoch_current, epoch_total,
                    learning_rate, load_in_4bit
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    forge_id,
                    workshop_id,
                    material_id,
                    base_model,
                    purpose,
                    f"{method} {'Evaluation' if purpose == 'evaluation' else 'Training'}",
                    method,
                    "queued",
                    0,
                    0,
                    epochs,
                    learning_rate,
                    1 if load_in_4bit else 0,
                ),
            )
            connection.execute(
                """
                UPDATE workshops
                SET status = ?,
                    progress = CASE WHEN progress < 45 THEN 45 ELSE progress END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                ("evaluating" if purpose == "evaluation" else "forging", workshop_id),
            )

            row = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_id,),
            ).fetchone()
            return self._forge_run_from_row(row)

    async def advance_forge_simulation(self, forge_run_id: str) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._advance_forge_simulation_sync(forge_run_id)
            )

    def _advance_forge_simulation_sync(self, forge_run_id: str) -> Dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"Forge {forge_run_id} was not found.")
            if row["status"] == "completed":
                if row["purpose"] == "evaluation":
                    return self._forge_run_from_row(row)
                artifact = self._ensure_artifact_for_forge(connection, row)
                return self._forge_run_from_row(row, artifact_id=artifact["id"])
            if row["status"] == "failed":
                return self._forge_run_from_row(row)

            epoch_total = max(1, row["epoch_total"] or 1)
            if row["status"] == "queued":
                next_status = "running"
                next_progress = max(12, row["progress"])
            else:
                next_status = "running"
                next_progress = min(100, row["progress"] + self._forge_progress_step(epoch_total))

            next_epoch = min(
                epoch_total,
                max(0, int((next_progress / 100) * epoch_total)),
            )
            if next_progress >= 100:
                next_status = "completed"
                next_epoch = epoch_total

            connection.execute(
                """
                UPDATE forge_runs
                SET status = ?,
                    progress = ?,
                    epoch_current = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (next_status, next_progress, next_epoch, forge_run_id),
            )
            connection.execute(
                """
                UPDATE workshops
                SET progress = CASE
                        WHEN ? = 'completed' AND progress < 72 THEN 72
                        WHEN progress < 52 THEN 52
                        ELSE progress
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (next_status, row["workshop_id"]),
            )
            artifact = None
            if next_status == "completed":
                if row["purpose"] != "evaluation":
                    artifact = self._ensure_artifact_for_forge(connection, row)

            updated = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            return self._forge_run_from_row(
                updated,
                artifact_id=artifact["id"] if artifact else None,
            )

    async def ensure_artifact_for_completed_forge(self, forge_run_id: str) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._ensure_artifact_for_completed_forge_sync(forge_run_id)
            )

    def _ensure_artifact_for_completed_forge_sync(self, forge_run_id: str) -> Dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"Forge {forge_run_id} was not found.")
            if row["status"] != "completed":
                raise ValueError("Forge must be completed before creating an Artifact.")
            if row["purpose"] == "evaluation":
                raise ValueError("Evaluation Forges do not create Artifacts.")

            artifact = self._ensure_artifact_for_forge(connection, row)
            updated = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            return self._forge_run_from_row(updated, artifact_id=artifact["id"])

    def _forge_progress_step(self, epoch_total: int) -> int:
        return max(10, min(28, round(100 / max(3, epoch_total * 2))))

    def _ensure_artifact_for_forge(
        self,
        connection: sqlite3.Connection,
        forge_run: sqlite3.Row,
    ) -> sqlite3.Row:
        existing = connection.execute(
            "SELECT * FROM artifacts WHERE forge_run_id = ?",
            (forge_run["id"],),
        ).fetchone()
        if existing is not None:
            return existing

        workshop = connection.execute(
            "SELECT voice_target FROM workshops WHERE id = ?",
            (forge_run["workshop_id"],),
        ).fetchone()
        artifact_count = connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE workshop_id = ?",
            (forge_run["workshop_id"],),
        ).fetchone()[0]
        artifact_id = f"art-{uuid4().hex[:12]}"
        version = f"v0.{artifact_count + 1}.0"
        voice_target = workshop["voice_target"] if workshop else "Foundry"
        adapter_name = f"{voice_target} {forge_run['method']} Artifact"

        connection.execute(
            """
            INSERT INTO artifacts (
                id, workshop_id, forge_run_id, name, version, base_model,
                adapter_path, status, training_method, trial_score
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                forge_run["workshop_id"],
                forge_run["id"],
                adapter_name,
                version,
                forge_run["base_model"] or "unknown",
                f"runtime/artifacts/{artifact_id}/adapter",
                "ready",
                forge_run["method"],
                0,
            ),
        )
        connection.execute(
            """
            UPDATE workshops
            SET active_artifact_id = ?,
                status = 'ready',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (artifact_id, forge_run["workshop_id"]),
        )
        return connection.execute(
            "SELECT * FROM artifacts WHERE id = ?",
            (artifact_id,),
        ).fetchone()

    async def start_assembly_line(
        self,
        workshop_id: str,
        material_source_ids: List[str],
        chunk_size_tokens: int,
        chunk_overlap_tokens: int,
        qa_pairs_per_source: int,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._start_assembly_line_sync(
                    workshop_id,
                    material_source_ids,
                    chunk_size_tokens,
                    chunk_overlap_tokens,
                    qa_pairs_per_source,
                )
            )

    def _start_assembly_line_sync(
        self,
        workshop_id: str,
        material_source_ids: List[str],
        chunk_size_tokens: int,
        chunk_overlap_tokens: int,
        qa_pairs_per_source: int,
    ) -> Dict[str, Any]:
        run_id = f"asm-{uuid4().hex[:12]}"

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT id FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            placeholders = ",".join("?" for _ in material_source_ids)
            rows = connection.execute(
                f"""
                SELECT * FROM materials
                WHERE workshop_id = ? AND id IN ({placeholders})
                """,
                (workshop_id, *material_source_ids),
            ).fetchall()
            if len(rows) != len(set(material_source_ids)):
                raise ValueError("One or more Materials were not found for this Workshop.")

            material_outputs = [
                self._prepare_material_output(
                    material=row,
                    run_id=run_id,
                    chunk_size_tokens=chunk_size_tokens,
                    chunk_overlap_tokens=chunk_overlap_tokens,
                    qa_pairs_per_source=qa_pairs_per_source,
                )
                for row in rows
            ]
            chunk_count = sum(len(output["chunks"]) for output in material_outputs)
            qa_pair_count = sum(len(output["qa_pairs"]) for output in material_outputs)

            connection.execute(
                """
                INSERT INTO assembly_line_runs (
                    id, workshop_id, material_source_ids_json, status, progress,
                    chunk_size_tokens, chunk_overlap_tokens, qa_pairs_per_source,
                    chunk_count, qa_pair_count
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    workshop_id,
                    json.dumps(material_source_ids),
                    "completed",
                    100,
                    chunk_size_tokens,
                    chunk_overlap_tokens,
                    qa_pairs_per_source,
                    chunk_count,
                    qa_pair_count,
                ),
            )

            chunk_rows = [
                (
                    chunk["id"],
                    workshop_id,
                    output["material_id"],
                    run_id,
                    chunk["index"],
                    chunk["text"],
                    chunk["token_count"],
                )
                for output in material_outputs
                for chunk in output["chunks"]
            ]
            if chunk_rows:
                connection.executemany(
                    """
                    INSERT INTO material_chunks (
                        id, workshop_id, material_id, assembly_line_run_id,
                        chunk_index, text, token_count
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    chunk_rows,
                )

            qa_rows = [
                (
                    qa_pair["id"],
                    workshop_id,
                    output["material_id"],
                    qa_pair["chunk_id"],
                    run_id,
                    qa_pair["question"],
                    qa_pair["answer"],
                )
                for output in material_outputs
                for qa_pair in output["qa_pairs"]
            ]
            if qa_rows:
                connection.executemany(
                    """
                    INSERT INTO qa_pairs (
                        id, workshop_id, material_id, chunk_id,
                        assembly_line_run_id, question, answer
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    qa_rows,
                )

            per_material_qa = max(1, qa_pairs_per_source)
            connection.executemany(
                """
                UPDATE materials
                SET status = 'qa-ready',
                    chunk_count = ?,
                    qa_pair_count = ?
                WHERE id = ? AND workshop_id = ?
                """,
                [
                    (
                        len(output["chunks"]),
                        len(output["qa_pairs"]) or per_material_qa,
                        output["material_id"],
                        workshop_id,
                    )
                    for output in material_outputs
                ],
            )
            connection.execute(
                """
                UPDATE workshops
                SET status = 'assembling',
                    progress = CASE WHEN progress < 35 THEN 35 ELSE progress END,
                    material_refinement = CASE
                        WHEN material_refinement < 65 THEN 65
                        ELSE material_refinement
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (workshop_id,),
            )

            row = connection.execute(
                "SELECT * FROM assembly_line_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            return self._assembly_line_run_from_row(row)

    def _estimate_chunks(self, material: sqlite3.Row, chunk_size_tokens: int) -> int:
        if material["chunk_count"] > 0:
            return material["chunk_count"]

        base_by_kind = {
            "csv": 48,
            "pdf": 96,
            "website": 80,
            "transcript": 64,
            "video-transcript": 72,
            "text": 24,
            "jsonl": 32,
        }
        base = base_by_kind.get(material["kind"], 24)
        size_factor = max(0.35, min(2.0, 1024 / max(256, chunk_size_tokens)))
        return max(1, round(base * size_factor))

    def _prepare_material_output(
        self,
        material: sqlite3.Row,
        run_id: str,
        chunk_size_tokens: int,
        chunk_overlap_tokens: int,
        qa_pairs_per_source: int,
    ) -> Dict[str, Any]:
        chunks = self._build_text_chunks(material, run_id, chunk_size_tokens, chunk_overlap_tokens)
        if not chunks:
            chunks = [
                {
                    "id": f"chk-{uuid4().hex[:12]}",
                    "index": index,
                    "text": f"Estimated chunk {index + 1} for {material['name']}.",
                    "token_count": chunk_size_tokens,
                }
                for index in range(self._estimate_chunks(material, chunk_size_tokens))
            ]

        qa_pairs = self._build_qa_pairs(material, run_id, chunks, qa_pairs_per_source)
        return {
            "material_id": material["id"],
            "chunks": chunks,
            "qa_pairs": qa_pairs,
        }

    def _build_text_chunks(
        self,
        material: sqlite3.Row,
        run_id: str,
        chunk_size_tokens: int,
        chunk_overlap_tokens: int,
    ) -> List[Dict[str, Any]]:
        if material["kind"] not in {"text", "transcript", "video-transcript"}:
            return []

        text = self._read_text_source(material["source_uri"])
        if not text:
            return []

        tokens = text.split()
        if not tokens:
            return []

        step = max(1, chunk_size_tokens - chunk_overlap_tokens)
        chunks = []
        for index, start in enumerate(range(0, len(tokens), step)):
            chunk_tokens = tokens[start : start + chunk_size_tokens]
            if not chunk_tokens:
                continue
            chunks.append(
                {
                    "id": f"chk-{uuid4().hex[:12]}",
                    "index": index,
                    "text": " ".join(chunk_tokens),
                    "token_count": len(chunk_tokens),
                }
            )
            if start + chunk_size_tokens >= len(tokens):
                break
        return chunks

    def _read_text_source(self, source_uri: str) -> str:
        source_path = Path(source_uri)
        if not source_path.is_absolute():
            source_path = BASE_DIR / source_path

        if source_path.is_file():
            return source_path.read_text(encoding="utf-8", errors="ignore")

        if source_path.is_dir():
            text_parts = []
            for path in sorted(source_path.rglob("*")):
                if path.suffix.lower() in {".txt", ".md", ".text", ".transcript"}:
                    text_parts.append(path.read_text(encoding="utf-8", errors="ignore"))
            return "\n\n".join(text_parts)

        return ""

    def _build_qa_pairs(
        self,
        material: sqlite3.Row,
        run_id: str,
        chunks: List[Dict[str, Any]],
        qa_pairs_per_source: int,
    ) -> List[Dict[str, Any]]:
        qa_pairs = []
        for chunk in chunks[:qa_pairs_per_source]:
            answer = self._summarize_chunk_answer(chunk["text"])
            qa_pairs.append(
                {
                    "id": f"qa-{uuid4().hex[:12]}",
                    "chunk_id": chunk["id"],
                    "question": f"What does {material['name']} say about this part of the source?",
                    "answer": answer,
                }
            )
        return qa_pairs

    def _summarize_chunk_answer(self, text: str) -> str:
        compact_text = " ".join(text.split())
        for delimiter in [". ", "? ", "! ", "\n"]:
            if delimiter in compact_text:
                first_sentence = compact_text.split(delimiter, 1)[0].strip()
                if first_sentence:
                    return first_sentence[:800]
        return compact_text[:800]

    def _safe_export_name(self, value: str) -> str:
        normalized = "".join(
            character.lower() if character.isalnum() else "-"
            for character in value.strip()
        )
        normalized = "-".join(part for part in normalized.split("-") if part)
        return normalized or "qa-dataset"

    async def get_dashboard(self) -> Dict[str, Any]:
        def query():
            with self._connect() as connection:
                workshop = connection.execute(
                    """
                    SELECT * FROM workshops
                    ORDER BY
                        CASE status WHEN 'forging' THEN 0 ELSE 1 END,
                        datetime(updated_at) DESC
                    LIMIT 1
                    """
                ).fetchone()
                if workshop is None:
                    raise RuntimeError("Foundry catalog has no workshops.")

                artifact = connection.execute(
                    "SELECT * FROM artifacts WHERE id = ?",
                    (workshop["active_artifact_id"],),
                ).fetchone()
                construct = connection.execute(
                    "SELECT * FROM constructs WHERE id = ?",
                    (workshop["active_construct_id"],),
                ).fetchone()
                forge_rows = connection.execute(
                    """
                    SELECT * FROM forge_runs
                    WHERE workshop_id = ?
                    ORDER BY datetime(updated_at) DESC
                    LIMIT 5
                    """,
                    (workshop["id"],),
                ).fetchall()

                return {
                    "workshop": self._workshop_from_row(workshop),
                    "currentArtifact": self._artifact_from_row(artifact),
                    "construct": self._construct_from_row(construct),
                    "forgeQueue": [self._forge_run_from_row(row) for row in forge_rows],
                    "academyLesson": {
                        "id": "acd-attention-layers",
                        "title": "Understanding Attention Layers",
                        "concept": "attention",
                        "difficulty": "builder",
                        "progress": 64,
                    },
                    "runtimeMetrics": [
                        {"id": "gpu", "label": "GPU Usage", "value": 75},
                        {"id": "gpu-memory", "label": "GPU Memory Usage", "value": 60},
                        {"id": "cpu", "label": "CPU Usage", "value": 40},
                        {"id": "memory", "label": "Memory Usage", "value": 85},
                        {"id": "storage", "label": "Storage Usage", "value": 30},
                        {"id": "context", "label": "Context Window Usage", "value": 50},
                    ],
                }

        return await self._run_query(query)

    def _artifact_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "forgeRunId": row["forge_run_id"],
            "name": row["name"],
            "version": row["version"],
            "baseModel": row["base_model"],
            "adapterPath": row["adapter_path"],
            "status": row["status"],
            "trainingMethod": row["training_method"],
            "trialScore": row["trial_score"] or 0,
        }

    def _construct_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "name": row["name"],
            "artifactId": row["artifact_id"],
            "status": row["status"],
            "streamingEnabled": bool(row["streaming_enabled"]),
            "contextWindow": row["context_window"],
            "maxNewTokens": row["max_new_tokens"],
            "temperature": row["temperature"],
        }

    def _trial_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "artifactId": row["artifact_id"],
            "constructId": row["construct_id"],
            "messageId": row["message_id"],
            "prompt": row["prompt"],
            "response": row["response"],
            "verdict": row["verdict"],
            "runtimeMode": row["runtime_mode"],
            "tokenCount": row["token_count"],
            "generationSettings": json.loads(row["generation_settings_json"]),
            "createdAt": row["created_at"],
        }

    def _refresh_artifact_trial_score(
        self,
        connection: sqlite3.Connection,
        artifact_id: str,
    ) -> None:
        stats = connection.execute(
            """
            SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END) AS pass_count
            FROM trials
            WHERE artifact_id = ?
            """,
            (artifact_id,),
        ).fetchone()
        total_count = stats["total_count"] or 0
        if total_count == 0:
            score = 0
        else:
            score = round(((stats["pass_count"] or 0) / total_count) * 100)
        connection.execute(
            "UPDATE artifacts SET trial_score = ? WHERE id = ?",
            (score, artifact_id),
        )

    def _forge_run_from_row(
        self,
        row: sqlite3.Row,
        artifact_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        forge_run = {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "materialSetId": row["material_id"],
            "baseModel": row["base_model"],
            "artifactId": artifact_id or self._artifact_id_for_forge(row["id"]),
            "purpose": row["purpose"] if "purpose" in row.keys() else "training",
            "label": row["label"],
            "method": row["method"],
            "status": row["status"],
            "progress": row["progress"],
            "learningRate": row["learning_rate"],
            "loadIn4Bit": bool(row["load_in_4bit"]),
        }
        if row["epoch_current"] is not None and row["epoch_total"] is not None:
            forge_run["epoch"] = {
                "current": row["epoch_current"],
                "total": row["epoch_total"],
            }
        return forge_run

    def _artifact_id_for_forge(self, forge_run_id: str) -> Optional[str]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id FROM artifacts WHERE forge_run_id = ?",
                (forge_run_id,),
            ).fetchone()
            return row["id"] if row else None

    async def get_navigation_items(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT id, label, icon FROM navigation_items ORDER BY sort_order ASC"
                ).fetchall()
                return [dict(row) for row in rows]

        return await self._run_query(query)

    async def get_section_summaries(self) -> Dict[str, Any]:
        def query():
            with self._connect() as connection:
                rows = connection.execute("SELECT * FROM section_summaries").fetchall()
                return {
                    row["id"]: {
                        "eyebrow": row["eyebrow"],
                        "title": row["title"],
                        "body": row["body"],
                        "stats": json.loads(row["stats_json"]),
                        "concept": json.loads(row["concept_json"]),
                    }
                    for row in rows
                }

        return await self._run_query(query)

    async def get_ui_catalog(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT
                        id,
                        component,
                        station,
                        purpose,
                        cache_key AS cacheKey,
                        last_updated AS lastUpdated
                    FROM ui_component_catalog
                    ORDER BY station ASC, component ASC
                    """
                ).fetchall()
                return [dict(row) for row in rows]

        return await self._run_query(query)

    async def get_bootstrap(self) -> Dict[str, Any]:
        dashboard, navigation_items, section_summaries, ui_catalog = await asyncio.gather(
            self.get_dashboard(),
            self.get_navigation_items(),
            self.get_section_summaries(),
            self.get_ui_catalog(),
        )

        return {
            "dashboard": dashboard,
            "navigationItems": navigation_items,
            "sectionSummaries": section_summaries,
            "uiCatalog": ui_catalog,
        }
