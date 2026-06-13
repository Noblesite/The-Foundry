# The Foundry Catalog Persistence

The frontend now loads Foundry dashboard data through a repository interface that
can use mock data or API-backed data. The backend exposes the matching
`/api/v1/foundry/*` contract endpoints with async handlers and a SQLite-backed
catalog.

## Concurrency posture

- The frontend uses concurrent repository reads for dashboard, navigation,
  section summaries, and the UI catalog.
- The backend keeps route handlers async and gathers bootstrap catalog reads
  concurrently.
- Catalog reads are offloaded through `asyncio.to_thread`, which keeps the event
  loop responsive while SQLite performs blocking file I/O.
- Long-running model work should stay outside request handlers as queued Forge
  jobs, streamed Construct sessions, or background workers.

## SQL recommendation

SQLite is the active first catalog store for self-hosted local development. Move
to Postgres when multi-user scheduling, team workspaces, or enterprise audit
trails arrive.

Suggested first tables:

- `workshops`: project/workshop metadata, subject, voice target, status.
- `materials`: uploaded files, crawled pages, source URI, chunk and QA counts.
- `material_chunks`: generated text chunks tied to a Material and Assembly Line run.
- `qa_pairs`: generated question-answer rows tied to chunks and Materials.
- `forge_runs`: training/QA generation jobs, status, progress, epoch metadata.
- `artifacts`: model adapters, checkpoints, versions, trial scores.
- `constructs`: runnable inference configurations tied to artifacts.
- `trials`: saved Construct prompts, responses, verdicts, runtime settings, and
  the data needed to update Artifact trial scores.
- `academy_concepts`: educational explanations keyed by concept and station.
- `ui_component_catalog`: component id, station, cache key, version, updated time.

The default local database path is `EMA/runtime/foundry_catalog.db`. Override it
with `FOUNDRY_CATALOG_DB_PATH` when tests or deployments need an isolated
catalog.

The `ui_component_catalog` table should be treated as metadata, not as server
rendering authority. The React app should keep rendering locally; SQL should
help the app decide what metadata, lessons, cache keys, and configuration belong
to each screen.

## First indexes

- `workshops(status, updated_at)`
- `materials(workshop_id, status)`
- `forge_runs(workshop_id, status, updated_at)`
- `artifacts(workshop_id, status, version)`
- `constructs(workshop_id, artifact_id)`
- `trials(workshop_id, created_at)`
- `trials(artifact_id, verdict)`
- `academy_concepts(concept)`
- `ui_component_catalog(station, component, cache_key)`
