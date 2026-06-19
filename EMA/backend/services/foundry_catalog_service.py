from __future__ import annotations

import asyncio
import csv
import ipaddress
import json
import math
import os
import re
import sqlite3
import socket
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from uuid import uuid4

import requests

from .qa_generation_service import QAGenerationRequest, QAGenerationService
from .qa_quality_service import QA_QUALITY_CONFIDENCE_THRESHOLD, QAQualityEvaluator


BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = BASE_DIR / "runtime" / "foundry_catalog.db"
DEFAULT_EXPORT_DIR = BASE_DIR / "runtime" / "materials" / "exports"
DEFAULT_SOURCE_DIR = BASE_DIR / "runtime" / "materials" / "sources"
DEFAULT_MATERIAL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
DEFAULT_WEBSITE_FETCH_MAX_BYTES = 2 * 1024 * 1024
SUPPORTED_IMPORT_EXTENSIONS = {
    "csv": {".csv"},
    "pdf": {".pdf"},
    "jsonl": {".jsonl", ".ndjson"},
    "text": {".txt", ".md", ".markdown", ".text"},
    "transcript": {".txt", ".md", ".text", ".transcript", ".srt", ".vtt"},
    "video-transcript": {".txt", ".md", ".text", ".transcript", ".srt", ".vtt"},
}


class _FoundryHTMLTextExtractor(HTMLParser):
    """Small dependency-free readable-text extractor for MVP website snapshots."""

    BLOCK_TAGS = {
        "article",
        "aside",
        "blockquote",
        "br",
        "dd",
        "div",
        "dl",
        "dt",
        "figcaption",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "td",
        "th",
        "tr",
        "ul",
    }
    IGNORED_TAGS = {
        "canvas",
        "form",
        "iframe",
        "noscript",
        "script",
        "style",
        "svg",
        "template",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.title_parts: List[str] = []
        self.description = ""
        self._ignored_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in self.IGNORED_TAGS:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if normalized_tag == "title":
            self._in_title = True
        if normalized_tag == "meta":
            attributes = {key.lower(): value or "" for key, value in attrs}
            if attributes.get("name", "").lower() == "description":
                self.description = attributes.get("content", "").strip()
        if normalized_tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in self.IGNORED_TAGS and self._ignored_depth:
            self._ignored_depth -= 1
            return
        if self._ignored_depth:
            return
        if normalized_tag == "title":
            self._in_title = False
        if normalized_tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return
        text = unescape(data).strip()
        if not text:
            return
        if self._in_title:
            self.title_parts.append(text)
        self.parts.append(text)
        self.parts.append(" ")

    def readable_text(self) -> str:
        lines = []
        for raw_line in "".join(self.parts).splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            if line:
                lines.append(line)
        return "\n".join(lines)

    def title(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.title_parts)).strip()


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
        self.qa_generator = QAGenerationService()
        self.qa_quality_evaluator = QAQualityEvaluator()
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
            self._ensure_academy_concepts(connection)
            self._ensure_academy_actions(connection)

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
                generator_model TEXT NOT NULL DEFAULT 'legacy-summary',
                confidence REAL NOT NULL DEFAULT 0,
                generation_metadata_json TEXT NOT NULL DEFAULT '{}',
                review_status TEXT NOT NULL DEFAULT 'draft',
                reviewed_at TEXT,
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

            CREATE TABLE IF NOT EXISTS academy_action_mappings (
                id TEXT PRIMARY KEY,
                station TEXT NOT NULL,
                action TEXT NOT NULL,
                label TEXT NOT NULL,
                concept_id TEXT NOT NULL,
                tooltip_title TEXT NOT NULL,
                tooltip_body TEXT NOT NULL,
                FOREIGN KEY(concept_id) REFERENCES academy_concepts(concept)
            );

            CREATE TABLE IF NOT EXISTS ui_component_catalog (
                id TEXT PRIMARY KEY,
                component TEXT NOT NULL,
                station TEXT NOT NULL,
                purpose TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                last_updated TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_archive_entries (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL,
                revision TEXT NOT NULL DEFAULT '',
                local_path TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'huggingface',
                status TEXT NOT NULL DEFAULT 'remote',
                size_on_disk_bytes INTEGER NOT NULL DEFAULT 0,
                parameter_count INTEGER,
                library_name TEXT,
                pipeline_tag TEXT,
                gated INTEGER NOT NULL DEFAULT 0,
                private INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS model_download_jobs (
                id TEXT PRIMARY KEY,
                repo_id TEXT NOT NULL,
                revision TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                phase TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                detail TEXT NOT NULL DEFAULT '',
                archive_entry_id TEXT,
                error TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(archive_entry_id) REFERENCES model_archive_entries(id)
            );

            CREATE TABLE IF NOT EXISTS construct_runtime_validations (
                id TEXT PRIMARY KEY,
                construct_id TEXT,
                artifact_id TEXT,
                model_id TEXT NOT NULL,
                device TEXT NOT NULL,
                status TEXT NOT NULL,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                duration_seconds REAL NOT NULL DEFAULT 0,
                cleanup_status TEXT NOT NULL DEFAULT 'unknown',
                memory_available_gb REAL,
                error TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_concepts_concept_unique
                ON academy_concepts(concept);
            CREATE INDEX IF NOT EXISTS idx_academy_actions_station_action
                ON academy_action_mappings(station, action);
            CREATE INDEX IF NOT EXISTS idx_ui_component_station_component_cache
                ON ui_component_catalog(station, component, cache_key);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_model_archive_source_repo_revision
                ON model_archive_entries(source, repo_id, revision);
            CREATE INDEX IF NOT EXISTS idx_model_archive_status_updated
                ON model_archive_entries(status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_construct_runtime_validations_recent
                ON construct_runtime_validations(created_at DESC, model_id, device);
            """
        )
        self._ensure_forge_contract_columns(connection)
        self._ensure_qa_review_columns(connection)

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

    def _ensure_qa_review_columns(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(qa_pairs)").fetchall()
        }
        migrations = [
            ("review_status", "ALTER TABLE qa_pairs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft'"),
            ("reviewed_at", "ALTER TABLE qa_pairs ADD COLUMN reviewed_at TEXT"),
            ("generator_model", "ALTER TABLE qa_pairs ADD COLUMN generator_model TEXT NOT NULL DEFAULT 'legacy-summary'"),
            ("confidence", "ALTER TABLE qa_pairs ADD COLUMN confidence REAL NOT NULL DEFAULT 0"),
            ("generation_metadata_json", "ALTER TABLE qa_pairs ADD COLUMN generation_metadata_json TEXT NOT NULL DEFAULT '{}'"),
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
                ),
                (
                    "acd-evaluation",
                    "Evaluation",
                    "evaluation",
                    "Evaluation compares model replies against reviewed examples before you promote an Artifact.",
                    json.dumps(["trials", "forge", "artifacts"]),
                ),
                (
                    "acd-weak-sample-review",
                    "Weak Sample Review",
                    "weak-sample-review",
                    "Weak sample review turns failed and needs-work replies into corrected Material for the next Forge.",
                    json.dumps(["trials", "materials", "forge"]),
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

    def _ensure_academy_concepts(self, connection: sqlite3.Connection) -> None:
        academy_rows = [
            (
                "acd-attention-layers",
                "Understanding Attention Layers",
                "attention",
                "Attention helps a model weigh which tokens matter to the next token it generates.",
                json.dumps(["academy", "forge", "construct"]),
            ),
            (
                "acd-evaluation",
                "Evaluation",
                "evaluation",
                "Evaluation compares model replies against reviewed examples before you promote an Artifact.",
                json.dumps(["trials", "forge", "artifacts"]),
            ),
            (
                "acd-weak-sample-review",
                "Weak Sample Review",
                "weak-sample-review",
                "Weak sample review turns failed and needs-work replies into corrected Material for the next Forge.",
                json.dumps(["trials", "materials", "forge"]),
            ),
        ]
        connection.executemany(
            """
            INSERT OR IGNORE INTO academy_concepts (
                id, title, concept, short_explanation, related_stations_json
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            academy_rows,
        )

    def _ensure_academy_actions(self, connection: sqlite3.Connection) -> None:
        action_rows = [
            (
                "dashboard.resume-lesson",
                "workshop",
                "resume-lesson",
                "Resume Lesson",
                "attention",
                "Why attention now?",
                "Attention is the first layer-level concept to understand because it explains how prompts steer the next generated token.",
            ),
            (
                "materials.open-assembly-line",
                "materials",
                "open-assembly-line",
                "Open Academy",
                "attention",
                "Why Materials matter",
                "Materials become chunks and examples. Cleaner inputs make every later training and evaluation step easier to trust.",
            ),
            (
                "forge.open-training",
                "forge",
                "open-training-concepts",
                "Open Academy",
                "attention",
                "Why training metrics need context",
                "Forge metrics are useful only when paired with examples, validation, and layer-level understanding.",
            ),
            (
                "artifacts.open-promotion",
                "artifacts",
                "open-promotion-concepts",
                "Open Academy",
                "evaluation",
                "Why promotion needs Trials",
                "Artifacts should move into Constructs only after evaluation gives you evidence that behavior improved.",
            ),
            (
                "trials.open-evaluation",
                "trials",
                "open-evaluation",
                "Open Academy: Evaluation",
                "evaluation",
                "What is Evaluation?",
                "Evaluation checks model replies against reviewed prompts, expected answers, and rubric scores before promotion.",
            ),
            (
                "trials.review-weak-samples",
                "trials",
                "review-weak-samples",
                "Learn",
                "weak-sample-review",
                "What is Weak Sample Review?",
                "Weak sample review turns failed or needs-work replies into corrected rows that can train the next Artifact.",
            ),
        ]
        connection.executemany(
            """
            INSERT OR REPLACE INTO academy_action_mappings (
                id, station, action, label, concept_id, tooltip_title, tooltip_body
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            action_rows,
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

    def _decode_json_object(self, value: Optional[str]) -> Dict[str, Any]:
        try:
            decoded = json.loads(value or "{}")
        except (TypeError, ValueError):
            return {}
        return decoded if isinstance(decoded, dict) else {}

    def _qa_pair_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        generation_metadata = self._decode_json_object(row["generation_metadata_json"])
        return {
            "id": row["id"],
            "workshopId": row["workshop_id"],
            "materialId": row["material_id"],
            "chunkId": row["chunk_id"],
            "assemblyLineRunId": row["assembly_line_run_id"],
            "question": row["question"],
            "answer": row["answer"],
            "generatorModel": row["generator_model"] or "legacy-summary",
            "confidence": float(row["confidence"] or 0),
            "generationMetadata": generation_metadata,
            "qualityGate": self._qa_pair_quality_gate(row, generation_metadata),
            "reviewStatus": row["review_status"] or "draft",
            "reviewedAt": row["reviewed_at"],
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
            readiness = self._artifact_readiness(artifact)
            if not readiness["canLoad"]:
                raise ValueError(readiness["message"])

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
        reviewed_samples: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._export_evaluation_samples_to_material_sync(
                    forge_run=forge_run,
                    evaluation_report=evaluation_report,
                    name=name,
                    reviewed_samples=reviewed_samples,
                )
            )

    def _export_evaluation_samples_to_material_sync(
        self,
        forge_run: Dict[str, Any],
        evaluation_report: Dict[str, Any],
        name: Optional[str],
        reviewed_samples: Optional[List[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        workshop_id = forge_run["workshopId"]
        weak_samples = reviewed_samples or [
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
                            "reviewed": bool(reviewed_samples),
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
                "SELECT * FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                raise ValueError(f"Workshop {workshop_id} was not found.")

            stored_source_uri = source_uri
            if kind == "website":
                stored_source_uri = self._snapshot_website_source(
                    workshop_id=workshop_id,
                    material_id=material_id,
                    material_name=name,
                    source_url=source_uri,
                )

            connection.execute(
                """
                INSERT INTO materials (
                    id, workshop_id, name, kind, status, source_uri,
                    chunk_count, qa_pair_count
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (material_id, workshop_id, name, kind, "staged", stored_source_uri, 0, 0),
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

    async def preview_website_material(
        self,
        *,
        source_url: str,
    ) -> Dict[str, Any]:
        return await self._run_query(lambda: self._preview_website_material_sync(source_url))

    def _preview_website_material_sync(self, source_url: str) -> Dict[str, Any]:
        safe_url = self._validate_website_url(source_url)
        html = self._fetch_website_html(safe_url)
        extracted = self._extract_website_text(html)
        text = extracted["text"].strip()
        if not text:
            raise ValueError("Website did not contain readable text for the Assembly Line.")
        preview_text = text[:1600].rstrip()
        return {
            "contractVersion": "foundry.material.website-preview.v1",
            "sourceUrl": safe_url,
            "title": extracted["title"],
            "description": extracted["description"],
            "textPreview": preview_text,
            "textLength": len(text),
            "estimatedTokenCount": len(text.split()),
            "fetchLimitBytes": self._website_fetch_max_bytes(),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    async def import_material_file(
        self,
        workshop_id: str,
        name: str,
        kind: str,
        filename: str,
        content: bytes,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._import_material_file_sync(
                    workshop_id,
                    name,
                    kind,
                    filename,
                    content,
                )
            )

    def _import_material_file_sync(
        self,
        workshop_id: str,
        name: str,
        kind: str,
        filename: str,
        content: bytes,
    ) -> Dict[str, Any]:
        if kind not in SUPPORTED_IMPORT_EXTENSIONS:
            raise ValueError("This Material type cannot be uploaded as a local file yet.")
        if not content:
            raise ValueError("Uploaded Material file is empty.")

        max_bytes = self._material_upload_max_bytes()
        if len(content) > max_bytes:
            max_mb = round(max_bytes / (1024 * 1024))
            raise ValueError(f"Uploaded Material exceeds the {max_mb} MB MVP file limit.")

        source_name = Path(filename).name
        suffix = Path(source_name).suffix.lower()
        allowed_suffixes = SUPPORTED_IMPORT_EXTENSIONS[kind]
        if suffix not in allowed_suffixes:
            supported = ", ".join(sorted(allowed_suffixes))
            raise ValueError(f"{kind} uploads must use one of these extensions: {supported}.")

        material_id = f"mat-{uuid4().hex[:12]}"
        safe_filename = self._safe_source_filename(source_name)
        destination_dir = DEFAULT_SOURCE_DIR / self._safe_export_name(workshop_id)
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = destination_dir / f"{material_id}-{safe_filename}"
        destination_path.write_bytes(content)
        source_uri = self._runtime_uri(destination_path)

        with self._connect() as connection:
            workshop = connection.execute(
                "SELECT * FROM workshops WHERE id = ?",
                (workshop_id,),
            ).fetchone()
            if workshop is None:
                try:
                    destination_path.unlink(missing_ok=True)
                except OSError:
                    pass
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

    def _material_upload_max_bytes(self) -> int:
        raw_value = os.getenv("FOUNDRY_MATERIAL_UPLOAD_MAX_BYTES", "").strip()
        if not raw_value:
            return DEFAULT_MATERIAL_UPLOAD_MAX_BYTES
        try:
            parsed = int(raw_value)
        except ValueError:
            return DEFAULT_MATERIAL_UPLOAD_MAX_BYTES
        return max(1, parsed)

    def _safe_source_filename(self, filename: str) -> str:
        path = Path(filename).name
        stem = Path(path).stem
        suffix = Path(path).suffix.lower()
        safe_stem = re.sub(r"[^A-Za-z0-9_.-]+", "-", stem).strip("-")
        return f"{safe_stem or 'material'}{suffix}"

    def _runtime_uri(self, path: Path) -> str:
        try:
            return str(path.relative_to(BASE_DIR))
        except ValueError:
            return str(path)

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
                        SELECT qa_pairs.*, material_chunks.text AS source_text
                        FROM qa_pairs
                        LEFT JOIN material_chunks ON material_chunks.id = qa_pairs.chunk_id
                        WHERE qa_pairs.workshop_id = ? AND qa_pairs.assembly_line_run_id = ?
                        ORDER BY qa_pairs.material_id ASC, qa_pairs.created_at ASC
                        """,
                        (workshop_id, assembly_line_run_id),
                    ).fetchall()
                else:
                    rows = connection.execute(
                        """
                        SELECT qa_pairs.*, material_chunks.text AS source_text
                        FROM qa_pairs
                        LEFT JOIN material_chunks ON material_chunks.id = qa_pairs.chunk_id
                        WHERE qa_pairs.workshop_id = ?
                        ORDER BY datetime(qa_pairs.created_at) DESC
                        LIMIT 200
                        """,
                        (workshop_id,),
                    ).fetchall()
                return [self._qa_pair_from_row(row) for row in rows]

        return await self._run_query(query)

    async def update_qa_pair_review(
        self,
        workshop_id: str,
        qa_pair_id: str,
        question: str,
        answer: str,
        review_status: str,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._update_qa_pair_review_sync(
                    workshop_id,
                    qa_pair_id,
                    question,
                    answer,
                    review_status,
                )
            )

    def _update_qa_pair_review_sync(
        self,
        workshop_id: str,
        qa_pair_id: str,
        question: str,
        answer: str,
        review_status: str,
    ) -> Dict[str, Any]:
        if review_status not in {"draft", "accepted", "rejected", "edited"}:
            raise ValueError("QA review status must be draft, accepted, rejected, or edited.")
        if not question.strip():
            raise ValueError("QA question cannot be empty.")
        if not answer.strip():
            raise ValueError("QA answer cannot be empty.")

        reviewed_at = (
            datetime.now(timezone.utc).isoformat()
            if review_status in {"accepted", "rejected", "edited"}
            else None
        )
        with self._connect() as connection:
            existing = connection.execute(
                """
                SELECT * FROM qa_pairs
                WHERE id = ? AND workshop_id = ?
                """,
                (qa_pair_id, workshop_id),
            ).fetchone()
            if existing is None:
                raise ValueError("QA pair was not found for this Workshop.")

            connection.execute(
                """
                UPDATE qa_pairs
                SET question = ?,
                    answer = ?,
                    review_status = ?,
                    reviewed_at = ?
                WHERE id = ? AND workshop_id = ?
                """,
                (
                    question.strip(),
                    answer.strip(),
                    review_status,
                    reviewed_at,
                    qa_pair_id,
                    workshop_id,
                ),
            )
            row = connection.execute(
                """
                SELECT qa_pairs.*, material_chunks.text AS source_text
                FROM qa_pairs
                LEFT JOIN material_chunks ON material_chunks.id = qa_pairs.chunk_id
                WHERE qa_pairs.id = ? AND qa_pairs.workshop_id = ?
                """,
                (qa_pair_id, workshop_id),
            ).fetchone()
            return self._qa_pair_from_row(row)

    async def export_qa_pairs_to_material(
        self,
        workshop_id: str,
        assembly_line_run_id: str,
        include_drafts: bool = False,
        include_low_quality: bool = False,
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._export_qa_pairs_to_material_sync(
                    workshop_id,
                    assembly_line_run_id,
                    include_drafts,
                    include_low_quality,
                    name,
                )
            )

    def _export_qa_pairs_to_material_sync(
        self,
        workshop_id: str,
        assembly_line_run_id: str,
        include_drafts: bool,
        include_low_quality: bool,
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
                    qa_pairs.generator_model,
                    qa_pairs.confidence,
                    qa_pairs.generation_metadata_json,
                    qa_pairs.review_status,
                    qa_pairs.reviewed_at,
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
                    AND (? OR qa_pairs.review_status IN ('accepted', 'edited'))
                ORDER BY qa_pairs.material_id ASC, qa_pairs.created_at ASC
                """,
                (workshop_id, assembly_line_run_id, 1 if include_drafts else 0),
            ).fetchall()
            if not rows:
                raise ValueError(
                    "This Assembly Line run has no accepted QA pairs to export. Review rows first or use the draft override."
                )
            quality_gates = [
                self._qa_pair_quality_gate(
                    row,
                    self._decode_json_object(row["generation_metadata_json"]),
                )
                for row in rows
            ]
            blocked_gates = [gate for gate in quality_gates if gate["status"] != "passed"]
            if blocked_gates and not include_low_quality:
                blocked_count = len(blocked_gates)
                first_reason = blocked_gates[0]["reasons"][0] if blocked_gates[0]["reasons"] else "quality gate failed"
                raise ValueError(
                    f"QA quality gate blocked export for {blocked_count} row(s): {first_reason}. "
                    "Review the QA rows or enable the low-quality override."
                )

            export_dir = DEFAULT_EXPORT_DIR / workshop_id
            export_dir.mkdir(parents=True, exist_ok=True)
            export_name = self._safe_export_name(name or f"{workshop['name']} QA Dataset")
            export_path = export_dir / f"{export_name}-{assembly_line_run_id}.jsonl"

            with export_path.open("w", encoding="utf-8") as export_file:
                for index, row in enumerate(rows):
                    quality_gate = quality_gates[index]
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
                            "generatorModel": row["generator_model"],
                            "confidence": float(row["confidence"] or 0),
                            "generation": self._decode_json_object(
                                row["generation_metadata_json"]
                            ),
                            "reviewStatus": row["review_status"],
                            "reviewedAt": row["reviewed_at"],
                            "draftOverride": include_drafts,
                            "lowQualityOverride": include_low_quality,
                            "qualityGate": quality_gate,
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
                "qualityGate": {
                    "status": "override" if blocked_gates and include_low_quality else "passed",
                    "checkedRows": len(rows),
                    "blockedRows": len(blocked_gates),
                    "confidenceThreshold": QA_QUALITY_CONFIDENCE_THRESHOLD,
                    "override": include_low_quality,
                },
            }

    def _qa_pair_quality_gate(
        self,
        row: sqlite3.Row,
        generation_metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        reasons = []
        confidence = float(row["confidence"] or 0)
        review_status = row["review_status"] or "draft"
        generator_model = row["generator_model"] or "legacy-summary"
        source_text = row["source_text"] if "source_text" in row.keys() else ""
        metrics = self.qa_quality_evaluator.evaluate(
            question=row["question"],
            answer=row["answer"],
            source_text=source_text or "",
            confidence=confidence,
            generation_metadata=generation_metadata,
        )
        if review_status not in {"accepted", "edited"}:
            reasons.append("row has not been accepted by review")
        if confidence < QA_QUALITY_CONFIDENCE_THRESHOLD:
            reasons.append(
                f"confidence {confidence:.0%} is below the {QA_QUALITY_CONFIDENCE_THRESHOLD:.0%} gate"
            )
        if generation_metadata.get("fallbackReason"):
            reasons.append("row was produced by a generator fallback")
        if generator_model in {"legacy-summary", "deterministic-context-generator"}:
            reasons.append("row was produced by the deterministic smoke generator")
        return {
            "status": "passed" if not reasons else "blocked",
            "reasons": reasons,
            "confidenceThreshold": QA_QUALITY_CONFIDENCE_THRESHOLD,
            "metrics": metrics,
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

    async def ensure_artifact_for_completed_forge(
        self,
        forge_run_id: str,
        adapter_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._ensure_artifact_for_completed_forge_sync(forge_run_id, adapter_path)
            )

    def _ensure_artifact_for_completed_forge_sync(
        self,
        forge_run_id: str,
        adapter_path: Optional[str],
    ) -> Dict[str, Any]:
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

            artifact = self._ensure_artifact_for_forge(connection, row, adapter_path=adapter_path)
            updated = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            return self._forge_run_from_row(updated, artifact_id=artifact["id"])

    async def complete_forge_from_worker(
        self,
        forge_run_id: str,
        adapter_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            return await self._run_query(
                lambda: self._complete_forge_from_worker_sync(forge_run_id, adapter_path)
            )

    def _complete_forge_from_worker_sync(
        self,
        forge_run_id: str,
        adapter_path: Optional[str],
    ) -> Dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            if row is None:
                raise ValueError(f"Forge {forge_run_id} was not found.")
            if row["purpose"] == "evaluation":
                raise ValueError("Evaluation Forges cannot be completed by the local trainer.")
            if row["status"] == "failed":
                raise ValueError("Failed Forges cannot be completed by the local trainer.")

            epoch_total = max(1, row["epoch_total"] or 1)
            connection.execute(
                """
                UPDATE forge_runs
                SET status = 'completed',
                    progress = 100,
                    epoch_current = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (epoch_total, forge_run_id),
            )
            connection.execute(
                """
                UPDATE workshops
                SET status = 'ready',
                    progress = CASE WHEN progress < 72 THEN 72 ELSE progress END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (row["workshop_id"],),
            )
            updated = connection.execute(
                "SELECT * FROM forge_runs WHERE id = ?",
                (forge_run_id,),
            ).fetchone()
            artifact = self._ensure_artifact_for_forge(connection, updated, adapter_path=adapter_path)
            return self._forge_run_from_row(updated, artifact_id=artifact["id"])

    def _forge_progress_step(self, epoch_total: int) -> int:
        return max(10, min(28, round(100 / max(3, epoch_total * 2))))

    def _ensure_artifact_for_forge(
        self,
        connection: sqlite3.Connection,
        forge_run: sqlite3.Row,
        adapter_path: Optional[str] = None,
    ) -> sqlite3.Row:
        existing = connection.execute(
            "SELECT * FROM artifacts WHERE forge_run_id = ?",
            (forge_run["id"],),
        ).fetchone()
        if existing is not None:
            if adapter_path and existing["adapter_path"] != adapter_path:
                connection.execute(
                    """
                    UPDATE artifacts
                    SET adapter_path = ?
                    WHERE id = ?
                    """,
                    (adapter_path, existing["id"]),
                )
                return connection.execute(
                    "SELECT * FROM artifacts WHERE id = ?",
                    (existing["id"],),
                ).fetchone()
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
                adapter_path or f"runtime/artifacts/{artifact_id}/adapter",
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
                "SELECT * FROM workshops WHERE id = ?",
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
                    workshop=workshop,
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
                    qa_pair.get("generator_model", "legacy-summary"),
                    float(qa_pair.get("confidence", 0) or 0),
                    json.dumps(qa_pair.get("generation_metadata", {})),
                )
                for output in material_outputs
                for qa_pair in output["qa_pairs"]
            ]
            if qa_rows:
                connection.executemany(
                    """
                    INSERT INTO qa_pairs (
                        id, workshop_id, material_id, chunk_id,
                        assembly_line_run_id, question, answer,
                        generator_model, confidence, generation_metadata_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        workshop: sqlite3.Row,
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

        qa_pairs = self._build_qa_pairs(material, workshop, run_id, chunks, qa_pairs_per_source)
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
        if material["kind"] not in {
            "text",
            "transcript",
            "video-transcript",
            "csv",
            "jsonl",
            "pdf",
            "website",
        }:
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
            suffix = source_path.suffix.lower()
            if suffix == ".csv":
                return self._read_csv_source(source_path)
            if suffix in {".jsonl", ".ndjson"}:
                return self._read_jsonl_source(source_path)
            if suffix == ".pdf":
                return self._read_pdf_source(source_path)
            return source_path.read_text(encoding="utf-8", errors="ignore")

        if source_path.is_dir():
            text_parts = []
            for path in sorted(source_path.rglob("*")):
                if path.suffix.lower() in {".txt", ".md", ".text", ".transcript"}:
                    text_parts.append(path.read_text(encoding="utf-8", errors="ignore"))
            return "\n\n".join(text_parts)

        return ""

    def _read_csv_source(self, source_path: Path) -> str:
        rows = []
        with source_path.open("r", encoding="utf-8", errors="ignore", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            if reader.fieldnames:
                for index, row in enumerate(reader):
                    values = [
                        f"{field}: {value}"
                        for field, value in row.items()
                        if field and value not in {None, ""}
                    ]
                    if values:
                        rows.append(f"Row {index + 1}. " + "; ".join(values))
            else:
                csv_file.seek(0)
                plain_reader = csv.reader(csv_file)
                for index, row in enumerate(plain_reader):
                    values = [value for value in row if value]
                    if values:
                        rows.append(f"Row {index + 1}. " + "; ".join(values))
        return "\n".join(rows)

    def _read_jsonl_source(self, source_path: Path) -> str:
        rows = []
        with source_path.open("r", encoding="utf-8", errors="ignore") as jsonl_file:
            for index, line in enumerate(jsonl_file, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError:
                    rows.append(stripped)
                    continue
                if isinstance(payload, dict):
                    instruction = str(payload.get("instruction") or payload.get("question") or "").strip()
                    output = str(payload.get("output") or payload.get("answer") or "").strip()
                    if instruction or output:
                        rows.append(f"Row {index}. Instruction: {instruction}. Output: {output}.")
                    else:
                        rows.append(
                            "Row "
                            + str(index)
                            + ". "
                            + "; ".join(
                                f"{key}: {value}"
                                for key, value in payload.items()
                                if value is not None and value != ""
                            )
                        )
                else:
                    rows.append(str(payload))
        return "\n".join(rows)

    def _read_pdf_source(self, source_path: Path) -> str:
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise ValueError(
                "PDF extraction requires pypdf. Install project dependencies before assembling PDF Materials."
            ) from error

        reader = PdfReader(str(source_path))
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"Page {index}. {text.strip()}")
        return "\n\n".join(pages)

    def _snapshot_website_source(
        self,
        *,
        workshop_id: str,
        material_id: str,
        material_name: str,
        source_url: str,
    ) -> str:
        safe_url = self._validate_website_url(source_url)
        html = self._fetch_website_html(safe_url)
        extracted = self._extract_website_text(html)
        text = extracted["text"].strip()
        if not text:
            raise ValueError("Website did not contain readable text for the Assembly Line.")

        destination_dir = DEFAULT_SOURCE_DIR / self._safe_export_name(workshop_id)
        destination_dir.mkdir(parents=True, exist_ok=True)
        safe_name = self._safe_source_filename(f"{material_name or material_id}.website.txt")
        destination_path = destination_dir / f"{material_id}-{safe_name}"
        fetched_at = datetime.now(timezone.utc).isoformat()
        title_line = extracted["title"] or material_name or safe_url
        description = extracted["description"]
        header = [
            "Foundry Website Snapshot",
            f"Source URL: {safe_url}",
            f"Fetched At: {fetched_at}",
            f"Title: {title_line}",
        ]
        if description:
            header.append(f"Description: {description}")
        header.extend(["", "--- Extracted Text ---", ""])
        destination_path.write_text("\n".join(header) + text + "\n", encoding="utf-8")
        return self._runtime_uri(destination_path)

    def _validate_website_url(self, source_url: str) -> str:
        parsed = urlparse(source_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Website Materials must use an http:// or https:// URL.")
        if parsed.username or parsed.password:
            raise ValueError("Website URLs cannot include embedded credentials.")
        hostname = parsed.hostname
        if not hostname:
            raise ValueError("Website URL must include a hostname.")
        if os.getenv("FOUNDRY_ALLOW_PRIVATE_WEBSITE_FETCH", "").lower() in {"1", "true", "yes"}:
            return source_url.strip()

        try:
            address_info = socket.getaddrinfo(hostname, None)
        except socket.gaierror as error:
            raise ValueError(f"Could not resolve website host: {hostname}.") from error

        for item in address_info:
            ip_text = item[4][0]
            try:
                ip_address = ipaddress.ip_address(ip_text)
            except ValueError:
                continue
            if not ip_address.is_global:
                raise ValueError(
                    "Website fetches to private, loopback, or local network addresses are blocked by default."
                )
        return source_url.strip()

    def _fetch_website_html(self, source_url: str) -> str:
        max_bytes = self._website_fetch_max_bytes()
        try:
            response = requests.get(
                source_url,
                headers={
                    "User-Agent": "TheFoundryMaterialScraper/0.1 (+https://github.com/Noblesite/The-Foundry)",
                    "Accept": "text/html,text/plain;q=0.9,*/*;q=0.1",
                },
                stream=True,
                timeout=(5, 12),
            )
            response.raise_for_status()
        except requests.RequestException as error:
            raise ValueError(f"Could not fetch website Material: {error}") from error

        content_type = response.headers.get("content-type", "").lower()
        if content_type and not any(
            accepted in content_type for accepted in ("text/html", "text/plain", "application/xhtml")
        ):
            raise ValueError(f"Website Material returned unsupported content type: {content_type}.")

        chunks: List[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=16 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(
                    f"Website Material exceeds the {round(max_bytes / (1024 * 1024), 1)} MB MVP fetch limit."
                )
            chunks.append(chunk)

        encoding = response.encoding or response.apparent_encoding or "utf-8"
        return b"".join(chunks).decode(encoding, errors="ignore")

    def _extract_website_text(self, html: str) -> Dict[str, str]:
        extractor = _FoundryHTMLTextExtractor()
        extractor.feed(html)
        extractor.close()
        return {
            "title": extractor.title(),
            "description": re.sub(r"\s+", " ", extractor.description).strip(),
            "text": extractor.readable_text(),
        }

    def _website_fetch_max_bytes(self) -> int:
        raw_limit = os.getenv("FOUNDRY_WEBSITE_FETCH_MAX_BYTES", "").strip()
        if not raw_limit:
            return DEFAULT_WEBSITE_FETCH_MAX_BYTES
        try:
            return max(128 * 1024, int(raw_limit))
        except ValueError:
            return DEFAULT_WEBSITE_FETCH_MAX_BYTES

    def _build_qa_pairs(
        self,
        material: sqlite3.Row,
        workshop: sqlite3.Row,
        run_id: str,
        chunks: List[Dict[str, Any]],
        qa_pairs_per_source: int,
    ) -> List[Dict[str, Any]]:
        qa_pairs = []
        requested_count = max(1, qa_pairs_per_source)
        for chunk in chunks:
            remaining_count = requested_count - len(qa_pairs)
            if remaining_count <= 0:
                break
            generated_rows = self.qa_generator.generate(
                QAGenerationRequest(
                    material_name=material["name"],
                    material_kind=material["kind"],
                    chunk_id=chunk["id"],
                    chunk_text=chunk["text"],
                    qa_pair_count=remaining_count,
                    workshop_subject=workshop["subject"],
                    voice_target=workshop["voice_target"],
                )
            )
            qa_pairs.extend(generated_rows[:remaining_count])
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
                        {
                            "id": "gpu",
                            "label": "GPU Usage",
                            "value": 8,
                            "ideal": 35,
                            "state": "idle",
                            "description": "Accelerator load before a model is actively generating.",
                        },
                        {
                            "id": "gpu-memory",
                            "label": "GPU Memory",
                            "value": 12,
                            "ideal": 65,
                            "state": "idle",
                            "description": "Memory budget expected to stay comfortable for small local models.",
                        },
                        {
                            "id": "cpu",
                            "label": "CPU Usage",
                            "value": 14,
                            "ideal": 55,
                            "state": "idle",
                            "description": "Host processor load while the runtime is standing by.",
                        },
                        {
                            "id": "memory",
                            "label": "System Memory",
                            "value": 32,
                            "ideal": 75,
                            "state": "ready",
                            "description": "Unified or system memory used before loading a base model.",
                        },
                        {
                            "id": "storage",
                            "label": "Storage Usage",
                            "value": 30,
                            "ideal": 80,
                            "state": "ready",
                            "description": "Local Archive storage pressure from cached Materials and models.",
                        },
                        {
                            "id": "context",
                            "label": "Context Window",
                            "value": 6,
                            "ideal": 85,
                            "state": "idle",
                            "description": "Prompt budget used by the current Construct conversation.",
                        },
                    ],
                }

        return await self._run_query(query)

    def _artifact_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        readiness = self._artifact_readiness(row)
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
            "readiness": readiness,
            "createdAt": row["created_at"],
        }

    def _artifact_readiness(self, row: sqlite3.Row) -> Dict[str, Any]:
        adapter_path = row["adapter_path"] or ""
        if row["status"] == "archived":
            return {
                "status": "blocked",
                "canLoad": False,
                "message": "Archived Artifacts cannot be loaded into a Construct.",
                "checkedPath": adapter_path,
                "requiredFiles": [],
                "presentFiles": [],
            }
        if not adapter_path:
            return {
                "status": "blocked",
                "canLoad": False,
                "message": "Artifact has no adapter or checkpoint path registered.",
                "checkedPath": "",
                "requiredFiles": [],
                "presentFiles": [],
            }

        artifact_path = self._resolve_catalog_runtime_path(adapter_path)
        present_files = self._artifact_present_files(artifact_path)
        required_files = [
            "trainer-result.json",
            "adapter_model.safetensors",
            "adapter_model.bin",
            "adapter_config.json",
            "config.json",
        ]
        has_output_file = any(file_name in present_files for file_name in required_files)
        if artifact_path.exists() and has_output_file:
            return {
                "status": "verified",
                "canLoad": True,
                "message": "Artifact output files are present.",
                "checkedPath": str(artifact_path),
                "requiredFiles": required_files,
                "presentFiles": present_files,
            }
        if artifact_path.exists() and present_files:
            return {
                "status": "caution",
                "canLoad": True,
                "message": "Artifact path exists, but no standard adapter marker was found.",
                "checkedPath": str(artifact_path),
                "requiredFiles": required_files,
                "presentFiles": present_files,
            }
        if adapter_path.startswith("runtime/artifacts/pending/"):
            return {
                "status": "blocked",
                "canLoad": False,
                "message": "Real Forge output is missing adapter files.",
                "checkedPath": str(artifact_path),
                "requiredFiles": required_files,
                "presentFiles": present_files,
            }
        return {
            "status": "simulated",
            "canLoad": True,
            "message": "Metadata-only Artifact from a simulated Forge; Construct load will stay simulated until real adapter files exist.",
            "checkedPath": str(artifact_path),
            "requiredFiles": required_files,
            "presentFiles": present_files,
        }

    def _artifact_present_files(self, path: Path) -> List[str]:
        if not path.exists():
            return []
        if path.is_file():
            return [path.name]
        names: List[str] = []
        for file_path in path.rglob("*"):
            if file_path.is_file():
                try:
                    names.append(str(file_path.relative_to(path)))
                except ValueError:
                    names.append(file_path.name)
        return sorted(names)

    def _resolve_catalog_runtime_path(self, value: str) -> Path:
        path = Path(value)
        return path if path.is_absolute() else BASE_DIR / path

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

    async def get_academy_concepts(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT
                        id,
                        title,
                        concept,
                        short_explanation AS shortExplanation,
                        related_stations_json
                    FROM academy_concepts
                    ORDER BY title ASC
                    """
                ).fetchall()
                return [
                    {
                        "id": row["id"],
                        "title": row["title"],
                        "concept": row["concept"],
                        "shortExplanation": row["shortExplanation"],
                        "relatedStations": json.loads(row["related_stations_json"]),
                    }
                    for row in rows
                ]

        return await self._run_query(query)

    async def get_academy_actions(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT
                        id,
                        station,
                        action,
                        label,
                        concept_id AS conceptId,
                        tooltip_title AS tooltipTitle,
                        tooltip_body AS tooltipBody
                    FROM academy_action_mappings
                    ORDER BY station ASC, action ASC
                    """
                ).fetchall()
                return [dict(row) for row in rows]

        return await self._run_query(query)

    async def list_model_archive_entries(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM model_archive_entries
                    ORDER BY datetime(updated_at) DESC, repo_id ASC
                    """
                ).fetchall()
                return [self._model_archive_entry_from_row(row) for row in rows]

        return await self._run_query(query)

    async def list_model_download_jobs(self) -> List[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM model_download_jobs
                    ORDER BY datetime(updated_at) DESC
                    LIMIT 25
                    """
                ).fetchall()
                return [self._model_download_job_from_row(connection, row) for row in rows]

        return await self._run_query(query)

    async def list_construct_runtime_validations(
        self,
        *,
        model_id: Optional[str] = None,
        device: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> Dict[str, Any]:
        safe_page = max(1, int(page or 1))
        safe_page_size = min(100, max(1, int(page_size or 25)))
        offset = (safe_page - 1) * safe_page_size

        def query():
            with self._connect() as connection:
                where_clauses = []
                params: List[Any] = []
                if model_id:
                    where_clauses.append("model_id = ?")
                    params.append(model_id)
                if device:
                    where_clauses.append("device = ?")
                    params.append(device)
                if status in {"passed", "failed"}:
                    where_clauses.append("status = ?")
                    params.append(status)
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
                total = connection.execute(
                    f"SELECT COUNT(*) AS total FROM construct_runtime_validations {where_sql}",
                    params,
                ).fetchone()["total"]
                rows = connection.execute(
                    f"""
                    SELECT * FROM construct_runtime_validations
                    {where_sql}
                    ORDER BY datetime(created_at) DESC
                    LIMIT ? OFFSET ?
                    """,
                    (*params, safe_page_size, offset),
                ).fetchall()
                model_facets = connection.execute(
                    """
                    SELECT model_id AS value, COUNT(*) AS count
                    FROM construct_runtime_validations
                    GROUP BY model_id
                    ORDER BY count DESC, model_id ASC
                    """
                ).fetchall()
                device_facets = connection.execute(
                    """
                    SELECT device AS value, COUNT(*) AS count
                    FROM construct_runtime_validations
                    GROUP BY device
                    ORDER BY count DESC, device ASC
                    """
                ).fetchall()
                status_facets = connection.execute(
                    """
                    SELECT status AS value, COUNT(*) AS count
                    FROM construct_runtime_validations
                    GROUP BY status
                    ORDER BY status ASC
                    """
                ).fetchall()
                return {
                    "items": [self._construct_runtime_validation_from_row(row) for row in rows],
                    "total": total,
                    "page": safe_page,
                    "pageSize": safe_page_size,
                    "pageCount": max(1, math.ceil(total / safe_page_size)) if total else 0,
                    "filters": {
                        "modelId": model_id,
                        "device": device,
                        "status": status if status in {"passed", "failed"} else None,
                    },
                    "facets": {
                        "models": [dict(row) for row in model_facets],
                        "devices": [dict(row) for row in device_facets],
                        "statuses": [dict(row) for row in status_facets],
                    },
                }

        return await self._run_query(query)

    async def export_construct_runtime_validations(
        self,
        *,
        model_id: Optional[str] = None,
        device: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        def query():
            with self._connect() as connection:
                where_clauses = []
                params: List[Any] = []
                if model_id:
                    where_clauses.append("model_id = ?")
                    params.append(model_id)
                if device:
                    where_clauses.append("device = ?")
                    params.append(device)
                if status in {"passed", "failed"}:
                    where_clauses.append("status = ?")
                    params.append(status)
                where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
                rows = connection.execute(
                    f"""
                    SELECT * FROM construct_runtime_validations
                    {where_sql}
                    ORDER BY datetime(created_at) DESC
                    """,
                    params,
                ).fetchall()
                validations = [self._construct_runtime_validation_from_row(row) for row in rows]
                return {
                    "contractVersion": "foundry.construct.runtime-validations-export.v1",
                    "exportedAt": datetime.now(timezone.utc).isoformat(),
                    "format": "json",
                    "validationCount": len(validations),
                    "filters": {
                        "modelId": model_id,
                        "device": device,
                        "status": status if status in {"passed", "failed"} else None,
                    },
                    "validations": validations,
                }

        return await self._run_query(query)

    async def create_construct_runtime_validation(
        self,
        *,
        construct_id: Optional[str],
        artifact_id: Optional[str],
        model_id: str,
        device: str,
        status: str,
        total_tokens: int = 0,
        duration_seconds: float = 0,
        cleanup_status: str = "unknown",
        memory_available_gb: Optional[float] = None,
        error: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        validation_id = f"rtv-{uuid4().hex[:12]}"
        safe_status = status if status in {"passed", "failed"} else "failed"
        async with self._write_lock:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO construct_runtime_validations (
                        id,
                        construct_id,
                        artifact_id,
                        model_id,
                        device,
                        status,
                        total_tokens,
                        duration_seconds,
                        cleanup_status,
                        memory_available_gb,
                        error,
                        metadata_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        validation_id,
                        construct_id,
                        artifact_id,
                        model_id,
                        device,
                        safe_status,
                        max(0, int(total_tokens or 0)),
                        max(0.0, float(duration_seconds or 0)),
                        cleanup_status or "unknown",
                        memory_available_gb,
                        error,
                        json.dumps(metadata or {}),
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM construct_runtime_validations WHERE id = ?",
                    (validation_id,),
                ).fetchone()
                return self._construct_runtime_validation_from_row(row)

    def _construct_runtime_validation_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except (TypeError, ValueError):
            metadata = {}
        return {
            "id": row["id"],
            "constructId": row["construct_id"],
            "artifactId": row["artifact_id"],
            "modelId": row["model_id"],
            "device": row["device"],
            "status": row["status"],
            "totalTokens": row["total_tokens"],
            "durationSeconds": row["duration_seconds"],
            "cleanupStatus": row["cleanup_status"],
            "memoryAvailableGb": row["memory_available_gb"],
            "error": row["error"],
            "metadata": metadata if isinstance(metadata, dict) else {},
            "createdAt": row["created_at"],
        }

    async def get_model_download_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM model_download_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
                return self._model_download_job_from_row(connection, row) if row else None

        return await self._run_query(query)

    async def create_model_download_job(
        self,
        *,
        job_id: str,
        repo_id: str,
        revision: str,
        status: str,
        phase: str,
        progress: int,
        detail: str,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO model_download_jobs (
                        id, repo_id, revision, status, phase, progress, detail
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (job_id, repo_id, revision or "", status, phase, progress, detail),
                )
                row = connection.execute(
                    "SELECT * FROM model_download_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
                return self._model_download_job_from_row(connection, row)

    async def update_model_download_job(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        phase: Optional[str] = None,
        progress: Optional[int] = None,
        detail: Optional[str] = None,
        archive_entry_id: Optional[str] = None,
        error: Optional[str] = None,
        cancel_requested: Optional[bool] = None,
    ) -> Dict[str, Any]:
        async with self._write_lock:
            with self._connect() as connection:
                current = connection.execute(
                    "SELECT * FROM model_download_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
                if current is None:
                    raise ValueError("Model download job was not found.")
                connection.execute(
                    """
                    UPDATE model_download_jobs
                    SET status = ?,
                        phase = ?,
                        progress = ?,
                        detail = ?,
                        archive_entry_id = ?,
                        error = ?,
                        cancel_requested = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        status if status is not None else current["status"],
                        phase if phase is not None else current["phase"],
                        progress if progress is not None else current["progress"],
                        detail if detail is not None else current["detail"],
                        archive_entry_id if archive_entry_id is not None else current["archive_entry_id"],
                        error if error is not None else current["error"],
                        int(cancel_requested) if cancel_requested is not None else current["cancel_requested"],
                        job_id,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM model_download_jobs WHERE id = ?",
                    (job_id,),
                ).fetchone()
                return self._model_download_job_from_row(connection, row)

    async def cancel_model_download_job(self, job_id: str) -> Dict[str, Any]:
        return await self.update_model_download_job(
            job_id,
            status="canceled",
            phase="canceled",
            progress=100,
            detail="Cancellation requested.",
            cancel_requested=True,
        )

    async def get_model_archive_entry(
        self,
        repo_id: str,
        revision: str = "",
    ) -> Optional[Dict[str, Any]]:
        def query():
            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT * FROM model_archive_entries
                    WHERE source = 'huggingface'
                        AND repo_id = ?
                        AND revision = ?
                    """,
                    (repo_id, revision or ""),
                ).fetchone()
                return self._model_archive_entry_from_row(row) if row else None

        return await self._run_query(query)

    async def upsert_model_archive_entry(
        self,
        *,
        repo_id: str,
        revision: str = "",
        local_path: str = "",
        source: str = "huggingface",
        status: str = "remote",
        size_on_disk_bytes: int = 0,
        parameter_count: Optional[int] = None,
        library_name: Optional[str] = None,
        pipeline_tag: Optional[str] = None,
        gated: bool = False,
        private: bool = False,
    ) -> Dict[str, Any]:
        safe_revision = revision or ""
        entry_id = f"mdl-{uuid4().hex[:12]}"

        async with self._write_lock:
            with self._connect() as connection:
                existing = connection.execute(
                    """
                    SELECT id FROM model_archive_entries
                    WHERE source = ? AND repo_id = ? AND revision = ?
                    """,
                    (source, repo_id, safe_revision),
                ).fetchone()
                if existing:
                    entry_id = existing["id"]
                    connection.execute(
                        """
                        UPDATE model_archive_entries
                        SET local_path = ?,
                            status = ?,
                            size_on_disk_bytes = ?,
                            parameter_count = ?,
                            library_name = ?,
                            pipeline_tag = ?,
                            gated = ?,
                            private = ?,
                            last_checked_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (
                            local_path,
                            status,
                            size_on_disk_bytes,
                            parameter_count,
                            library_name,
                            pipeline_tag,
                            int(gated),
                            int(private),
                            entry_id,
                        ),
                    )
                else:
                    connection.execute(
                        """
                        INSERT INTO model_archive_entries (
                            id, repo_id, revision, local_path, source, status,
                            size_on_disk_bytes, parameter_count, library_name,
                            pipeline_tag, gated, private
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            entry_id,
                            repo_id,
                            safe_revision,
                            local_path,
                            source,
                            status,
                            size_on_disk_bytes,
                            parameter_count,
                            library_name,
                            pipeline_tag,
                            int(gated),
                            int(private),
                        ),
                    )
                row = connection.execute(
                    "SELECT * FROM model_archive_entries WHERE id = ?",
                    (entry_id,),
                ).fetchone()
                return self._model_archive_entry_from_row(row)

    def _model_archive_entry_from_row(self, row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "repoId": row["repo_id"],
            "revision": row["revision"],
            "localPath": row["local_path"],
            "source": row["source"],
            "status": row["status"],
            "sizeOnDiskBytes": row["size_on_disk_bytes"],
            "parameterCount": row["parameter_count"],
            "libraryName": row["library_name"],
            "pipelineTag": row["pipeline_tag"],
            "gated": bool(row["gated"]),
            "private": bool(row["private"]),
            "lastUsedAt": row["last_used_at"],
            "lastCheckedAt": row["last_checked_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _model_download_job_from_row(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
    ) -> Dict[str, Any]:
        archive_entry = None
        if row["archive_entry_id"]:
            archive_row = connection.execute(
                "SELECT * FROM model_archive_entries WHERE id = ?",
                (row["archive_entry_id"],),
            ).fetchone()
            archive_entry = self._model_archive_entry_from_row(archive_row) if archive_row else None
        return {
            "id": row["id"],
            "repoId": row["repo_id"],
            "revision": row["revision"],
            "status": row["status"],
            "phase": row["phase"],
            "progress": row["progress"],
            "detail": row["detail"],
            "archiveEntry": archive_entry,
            "error": row["error"],
            "cancelRequested": bool(row["cancel_requested"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    async def get_bootstrap(self) -> Dict[str, Any]:
        dashboard, academy_actions, navigation_items, section_summaries, ui_catalog = await asyncio.gather(
            self.get_dashboard(),
            self.get_academy_actions(),
            self.get_navigation_items(),
            self.get_section_summaries(),
            self.get_ui_catalog(),
        )

        return {
            "dashboard": dashboard,
            "academyActions": academy_actions,
            "navigationItems": navigation_items,
            "sectionSummaries": section_summaries,
            "uiCatalog": ui_catalog,
        }
