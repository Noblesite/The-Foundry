import { readFile } from "node:fs/promises";

const files = {
  domain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  repository: await readFile(
    new URL("../src/services/foundryRepository.ts", import.meta.url),
    "utf8"
  ),
  contracts: await readFile(new URL("../src/contracts/foundryApi.ts", import.meta.url), "utf8"),
  construct: await readFile(
    new URL("../src/components/ConstructWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  settings: await readFile(
    new URL("../src/components/SettingsOverlay.tsx", import.meta.url),
    "utf8"
  ),
  systemReadiness: await readFile(
    new URL("../src/components/SystemReadinessPanel.tsx", import.meta.url),
    "utf8"
  ),
  artifacts: await readFile(
    new URL("../src/components/ArtifactsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  forge: await readFile(
    new URL("../src/components/ForgeWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  materials: await readFile(
    new URL("../src/components/MaterialsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  workshopCreate: await readFile(
    new URL("../src/components/WorkshopCreateModal.tsx", import.meta.url),
    "utf8"
  ),
  systemReadinessDomain: await readFile(
    new URL("../src/domain/systemReadiness.ts", import.meta.url),
    "utf8"
  ),
  mockData: await readFile(new URL("../src/mocks/foundryMockData.ts", import.meta.url), "utf8"),
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.domain,
  "huggingFaceUsername: string",
  "Workspace settings include Hugging Face username"
);
assertIncludes(
  files.contracts,
  "username?: string",
  "Archive API requests can carry Hugging Face username"
);
assertIncludes(
  files.contracts,
  "testHuggingFaceAuth:",
  "Frontend contract exposes Hugging Face credential test route"
);
assertIncludes(
  files.contracts,
  "HuggingFaceAuthCheckDto",
  "Frontend contract includes Hugging Face auth check result"
);
assertIncludes(
  files.contracts,
  "preflightArchiveModel:",
  "Frontend contract exposes model access preflight route"
);
assertIncludes(
  files.contracts,
  "ArchiveModelPreflightDto",
  "Frontend contract includes Archive model preflight result"
);
assertIncludes(
  files.settings,
  "Hugging Face username",
  "Settings captures Hugging Face username"
);
assertIncludes(
  files.settings,
  "Test Hugging Face Credentials",
  "Settings can test Hugging Face credentials"
);
assertIncludes(
  files.artifacts,
  "huggingFaceAuth",
  "Artifacts forwards Hugging Face auth to Archive requests"
);
assertIncludes(
  files.artifacts,
  "huggingFaceAuthLabel",
  "Artifacts shows active Hugging Face auth identity"
);
assertIncludes(
  files.artifacts,
  "Preflight Model",
  "Artifacts can preflight selected Hugging Face model"
);
assertIncludes(
  files.artifacts,
  "modelPreflight",
  "Artifacts renders selected model preflight result"
);
assertIncludes(
  files.artifacts,
  "downloadGateState",
  "Artifacts gates Archive download on model preflight"
);
assertIncludes(
  files.artifacts,
  "Engineer override",
  "Artifacts exposes an engineer override for blocked preflight"
);
assertIncludes(
  files.artifacts,
  "Using anonymous Hugging Face access",
  "Artifacts identifies anonymous Hugging Face mode"
);
assertIncludes(
  files.repository,
  "normalizeHuggingFaceError",
  "Repository normalizes Hugging Face auth errors"
);
assertIncludes(
  files.repository,
  "archiveRequest",
  "Repository wraps Archive requests with friendly errors"
);
assertIncludes(
  files.repository,
  "testHuggingFaceAuth:",
  "Repository tests Hugging Face credentials"
);
assertIncludes(
  files.repository,
  "preflightArchiveModel:",
  "Repository preflights Hugging Face models"
);
assertIncludes(
  files.contracts,
  "importMaterialFile:",
  "Frontend contract exposes Material file import route"
);
assertIncludes(
  files.repository,
  "importMaterialFile:",
  "Repository imports local Material files"
);
assertIncludes(
  files.repository,
  "application/octet-stream",
  "Repository sends Material file bytes without multipart dependencies"
);
assertIncludes(
  files.materials,
  "type=\"file\"",
  "Materials workbench renders a local file picker"
);
assertIncludes(
  files.materials,
  "Import Material",
  "Materials workbench labels local file imports"
);
assertIncludes(
  files.styles,
  ".material-form input[type=\"file\"]",
  "Material file picker is styled"
);
assertIncludes(
  files.app,
  "aria-label={`Open ${item.label}`}",
  "Sidebar navigation exposes deterministic accessible labels"
);
assertIncludes(
  files.domain,
  "export interface ConstructRuntimeEvent",
  "Runtime event domain contract"
);
assertIncludes(
  files.domain,
  "export interface ConstructRuntimeValidation",
  "Runtime validation domain contract"
);
assertIncludes(
  files.domain,
  "export interface ConstructRuntimeValidationPage",
  "Runtime validation page contract"
);
assertIncludes(
  files.domain,
  "export interface ConstructRuntimeValidationExport",
  "Runtime validation export contract"
);
assertIncludes(
  files.domain,
  "export interface ConstructDiagnosticsBundleExport",
  "Runtime diagnostics bundle export contract"
);
assertIncludes(
  files.domain,
  "redactionAudit?",
  "Runtime diagnostics bundle exposes structured redaction audit"
);
assertIncludes(
  files.domain,
  "export interface ConstructRuntimeValidationQuery",
  "Runtime validation query contract"
);
assertIncludes(
  files.domain,
  "metadata?: Record<string, unknown>",
  "Runtime event contract supports structured metadata"
);
assertIncludes(
  files.domain,
  "export type CreateConstructRuntimeEventRequest",
  "Runtime event creation contract"
);
assertIncludes(
  files.repository,
  "listConstructRuntimeEvents:",
  "Repository list method"
);
assertIncludes(
  files.repository,
  "recordConstructRuntimeEvent:",
  "Repository record method"
);
assertIncludes(
  files.repository,
  "exportConstructRuntimeEvents:",
  "Repository export runtime history method"
);
assertIncludes(
  files.repository,
  "clearConstructRuntimeEvents:",
  "Repository clear runtime history method"
);
assertIncludes(
  files.repository,
  "listConstructRuntimeValidations:",
  "Repository list runtime validations method"
);
assertIncludes(
  files.repository,
  "createConstructRuntimeValidation:",
  "Repository create runtime validation method"
);
assertIncludes(
  files.contracts,
  "exportConstructRuntimeEvents:",
  "Frontend contract exposes runtime history export route"
);
assertIncludes(
  files.contracts,
  "clearConstructRuntimeEvents:",
  "Frontend contract exposes runtime history clear route"
);
assertIncludes(
  files.contracts,
  "constructRuntimeValidations:",
  "Frontend contract exposes runtime validation route"
);
assertIncludes(
  files.repository,
  "releaseConstructRuntimeMemory:",
  "Repository exposes runtime memory release"
);
assertIncludes(
  files.contracts,
  "releaseConstructRuntimeMemory:",
  "Frontend contract exposes runtime memory release route"
);
assertIncludes(
  files.construct,
  "releaseRuntimeMemory",
  "Construct workbench can request runtime memory release"
);
assertIncludes(
  files.construct,
  "Release Memory",
  "Construct workbench renders runtime memory release action"
);
assertIncludes(
  files.construct,
  "LOCAL_SMOKE_MODEL_ID",
  "Construct smoke test uses a dedicated local smoke model"
);
assertIncludes(
  files.construct,
  "Prepare Smoke Model",
  "Construct smoke test can prepare the tiny model before running"
);
assertIncludes(
  files.construct,
  "smokeModelCached",
  "Construct smoke test is gated on Archive cache state"
);
assertIncludes(
  files.construct,
  "It is not a response-quality benchmark.",
  "Construct smoke model is clearly explained as a wiring test"
);
assertIncludes(
  files.construct,
  "type: \"download-model\"",
  "Construct smoke test can queue Archive model download"
);
assertIncludes(
  files.construct,
  "modelOverride: smokeModel",
  "Construct smoke test loads the smoke model instead of saved heavy settings"
);
assertIncludes(
  files.construct,
  "Loading cached smoke model",
  "Construct smoke test explains cached tiny model loading"
);
assertIncludes(
  files.construct,
  "runtimeSmokeResult",
  "Construct smoke test stores a final result summary"
);
assertIncludes(
  files.construct,
  "recordRuntimeValidation",
  "Construct smoke test records durable runtime validation"
);
assertIncludes(
  files.construct,
  "Runtime Validation",
  "Construct workbench renders runtime validation history"
);
assertIncludes(
  files.construct,
  "selectedRuntimeValidation",
  "Construct workbench can inspect a selected runtime validation"
);
assertIncludes(
  files.construct,
  "validationHistory",
  "Diagnostics bundle includes runtime validation history"
);
assertIncludes(
  files.construct,
  "diagnosticsBundle.validationHistory.filteredExport",
  "Diagnostics bundle attaches the backend filtered runtime validation export"
);
assertIncludes(
  files.construct,
  "validationSummary",
  "Diagnostics preview has a validation export summary"
);
assertIncludes(
  files.construct,
  "Validation export",
  "Diagnostics preview labels the attached validation export"
);
assertIncludes(
  files.construct,
  "Redaction audit",
  "Diagnostics preview renders redaction audit"
);
assertIncludes(
  files.construct,
  "diagnosticsBundlePreview.redactionAudit",
  "Diagnostics preview consumes structured redaction audit"
);
assertIncludes(
  files.construct,
  "runtime-validation-drawer-title",
  "Construct workbench renders a validation detail drawer"
);
assertIncludes(
  files.construct,
  "Inspect validation details",
  "Runtime validation rows are inspectable"
);
assertIncludes(
  files.construct,
  "runtimeValidationModelFilter",
  "Runtime validation history can filter by model"
);
assertIncludes(
  files.construct,
  "runtimeValidationDeviceFilter",
  "Runtime validation history can filter by device"
);
assertIncludes(
  files.construct,
  "runtimeValidationStatusFilter",
  "Runtime validation history can filter by status"
);
assertIncludes(
  files.construct,
  "runtimeValidationPassRate",
  "Runtime validation history summarizes pass rate"
);
assertIncludes(
  files.construct,
  "runtimeValidationPageNumber",
  "Runtime validation history tracks server pages"
);
assertIncludes(
  files.construct,
  "Page {runtimeValidationPage.page}",
  "Runtime validation history renders pagination controls"
);
assertIncludes(
  files.repository,
  "ConstructRuntimeValidationPageDto",
  "Repository consumes paged validation DTOs"
);
assertIncludes(
  files.repository,
  "exportConstructRuntimeValidations:",
  "Repository exports filtered runtime validations"
);
assertIncludes(
  files.repository,
  "exportConstructDiagnosticsBundle:",
  "Repository exports backend diagnostics bundles"
);
assertIncludes(
  files.contracts,
  "exportConstructRuntimeValidations:",
  "Frontend contract exposes runtime validation export route"
);
assertIncludes(
  files.contracts,
  "exportConstructRuntimeDiagnostics:",
  "Frontend contract exposes runtime diagnostics export route"
);
assertIncludes(
  files.repository,
  "pageSize: query.pageSize",
  "Repository sends validation pagination query params"
);
assertIncludes(
  files.construct,
  "downloadRuntimeValidationExport",
  "Construct workbench downloads filtered validation exports"
);
assertIncludes(
  files.construct,
  "foundry-runtime-validations",
  "Runtime validation export uses a Foundry filename"
);
assertIncludes(
  files.construct,
  "and ${runtimeValidationExport.validationCount} validation run",
  "Diagnostics preview message includes validation export count"
);
assertIncludes(
  files.styles,
  ".runtime-validation-card",
  "Runtime validation history is styled"
);
assertIncludes(
  files.styles,
  ".runtime-validation-filter",
  "Runtime validation filters are styled"
);
assertIncludes(
  files.styles,
  ".runtime-validation-summary",
  "Runtime validation summary is styled"
);
assertIncludes(
  files.styles,
  ".runtime-validation-pagination",
  "Runtime validation pagination is styled"
);
assertIncludes(
  files.styles,
  ".runtime-validation-header-actions",
  "Runtime validation export action is styled"
);
assertIncludes(
  files.styles,
  ".runtime-validation-drawer",
  "Runtime validation drawer is styled"
);
assertIncludes(
  files.construct,
  "runtime-smoke-result",
  "Construct smoke test renders the final result panel"
);
assertIncludes(
  files.construct,
  "SMOKE_RESULT_STORAGE_PREFIX",
  "Construct smoke test has a persisted session result key"
);
assertIncludes(
  files.construct,
  "loadPersistedSmokeResult",
  "Construct smoke test restores the last passed result"
);
assertIncludes(
  files.construct,
  "persistSmokeResult(event.construct.id, event.artifact.id, smokeResult)",
  "Construct smoke test persists successful live results"
);
assertIncludes(
  files.construct,
  "latestSmokeResultFromRuntimeEvents",
  "Construct smoke test restores successful backend runtime events"
);
assertIncludes(
  files.construct,
  "metadata: {\n                smokeResult",
  "Construct smoke test records structured event metadata"
);
assertIncludes(
  files.construct,
  "Last smoke test passed",
  "Construct smoke test explains restored session history"
);
assertIncludes(
  files.construct,
  "window.setInterval(pollTimeline, 5000)",
  "Construct timeline polling uses a calmer cadence"
);
assertIncludes(
  files.construct,
  "RUNTIME_HISTORY_FILTERS",
  "Construct runtime history exposes filter chips"
);
assertIncludes(
  files.construct,
  "runtimeHistoryCounts",
  "Construct runtime history shows per-filter counts"
);
assertIncludes(
  files.construct,
  "filteredRuntimeTimeline",
  "Construct runtime history filters visible events"
);
assertIncludes(
  files.construct,
  "No matching events",
  "Construct runtime history has a filtered empty state"
);
assertIncludes(
  files.construct,
  "selectedRuntimeEvent",
  "Construct runtime history supports event detail selection"
);
assertIncludes(
  files.construct,
  "runtime-event-drawer",
  "Construct runtime history shows an event detail drawer"
);
assertIncludes(
  files.construct,
  "formatRuntimeEventMetadata",
  "Construct runtime history renders structured event metadata"
);
assertIncludes(
  files.construct,
  "Confirm Clear",
  "Construct runtime history clear action requires confirmation"
);
assertIncludes(
  files.construct,
  "Export JSON",
  "Construct runtime history can export JSON diagnostics"
);
assertIncludes(
  files.construct,
  "downloadRuntimeHistoryExport",
  "Construct workbench can download runtime history exports"
);
assertIncludes(
  files.construct,
  "foundry-runtime-history-",
  "Runtime history export uses a stable diagnostic filename"
);
assertIncludes(
  files.construct,
  "Preview Bundle",
  "Construct runtime history can preview a diagnostics bundle"
);
assertIncludes(
  files.construct,
  "prepareDiagnosticsBundlePreview",
  "Construct workbench can preview support diagnostics before download"
);
assertIncludes(
  files.construct,
  "repository.exportConstructDiagnosticsBundle",
  "Construct workbench requests backend diagnostics bundles"
);
assertIncludes(
  files.construct,
  "foundry-construct-diagnostics-",
  "Diagnostics bundle uses a stable filename"
);
assertIncludes(
  files.construct,
  "Review export contents",
  "Diagnostics bundle shows an in-app preview before download"
);
assertIncludes(
  files.construct,
  "Download Bundle",
  "Diagnostics bundle preview controls the download action"
);
assertIncludes(
  files.styles,
  ".diagnostics-preview-panel",
  "Diagnostics preview panel is styled"
);
assertIncludes(
  files.styles,
  ".diagnostics-validation-inspector",
  "Diagnostics validation inspector is styled"
);
assertIncludes(
  files.styles,
  ".diagnostics-redaction-audit",
  "Diagnostics redaction audit is styled"
);
assertIncludes(
  files.construct,
  "Hugging Face token value is not exported.",
  "Diagnostics bundle redacts Hugging Face token values"
);
assertIncludes(
  files.domain,
  "contractVersion: \"foundry.construct.diagnostics-bundle.v1\"",
  "Diagnostics bundle exposes a versioned contract"
);
assertIncludes(
  files.construct,
  "clearRuntimeHistory",
  "Construct runtime history can clear saved backend events"
);
assertIncludes(
  files.app,
  "const handleConstructRuntimeChanged = useCallback",
  "App stabilizes runtime changed callback to avoid repeated runtime refreshes"
);
assertIncludes(
  files.app,
  "inspector-learning-stack",
  "App keeps right-rail learning widgets below runtime metrics"
);
assertIncludes(
  files.repository,
  "mockConstructRuntimeEvents",
  "Mock runtime event storage"
);
assertIncludes(
  files.repository,
  "foundry.mock.modelArchiveEntries",
  "Mock Archive entries persist across refresh"
);
assertIncludes(
  files.repository,
  "foundry.mock.modelDownloadJobs",
  "Mock Archive download jobs persist across refresh"
);
assertIncludes(
  files.repository,
  "persistMockArchiveEntries",
  "Mock Archive entry persistence helper"
);
assertIncludes(
  files.repository,
  "persistMockDownloadJobs",
  "Mock Archive job persistence helper"
);
assertIncludes(
  files.repository,
  "clearMockArchiveState:",
  "Repository clears mock Archive state"
);
assertIncludes(
  files.repository,
  "removeMockStorage",
  "Repository removes mock Archive storage"
);
assertIncludes(
  files.repository,
  "constructApiFoundryRepository",
  "Construct API hybrid repository"
);
assertIncludes(
  files.repository,
  "dataSource === \"construct-api\"",
  "Construct API data source switch"
);
assertIncludes(
  files.contracts,
  "constructRuntimeEvents:",
  "Runtime event API route"
);
assertIncludes(
  files.contracts,
  "status: `${FOUNDRY_API_VERSION}/foundry/status`",
  "Foundry status API route"
);
assertIncludes(
  files.domain,
  "export interface FoundryRuntimeStatus",
  "Foundry status domain contract"
);
assertIncludes(
  files.domain,
  "export interface ModelDownloadJob",
  "Model download job domain contract"
);
assertIncludes(
  files.domain,
  "defaultBaseModel: string",
  "Workspace settings default base model contract"
);
assertIncludes(
  files.domain,
  "resolveDefaultBaseModel",
  "Default base model resolver"
);
assertIncludes(
  files.mockData,
  "defaultBaseModel:",
  "Default settings include persisted default base model"
);
assertIncludes(
  files.repository,
  "getFoundryStatus:",
  "Repository status method"
);
assertIncludes(
  files.repository,
  "startModelDownloadJob:",
  "Repository start model download job method"
);
assertIncludes(
  files.repository,
  "getModelDownloadJob:",
  "Repository poll model download job method"
);
assertIncludes(
  files.repository,
  "listModelDownloadJobs:",
  "Repository list model download jobs method"
);
assertIncludes(
  files.repository,
  "cancelModelDownloadJob:",
  "Repository cancel model download job method"
);
assertIncludes(
  files.repository,
  "evictArchiveModel:",
  "Repository evict Archive model method"
);
assertIncludes(
  files.repository,
  "buildApiUnavailableStatus",
  "Repository status fallback"
);
assertIncludes(
  files.construct,
  ".listConstructRuntimeEvents()",
  "Construct timeline hydration"
);
assertIncludes(
  files.construct,
  "events.slice(0, 50)",
  "Construct timeline hydrates the backend event list limit"
);
assertIncludes(
  files.construct,
  "refreshRuntimeTimeline",
  "Construct timeline backend refresh"
);
assertIncludes(
  files.construct,
  "window.setInterval(pollTimeline",
  "Construct timeline active polling"
);
assertIncludes(
  files.construct,
  "activeFoundryDataSource",
  "Construct runtime source indicator"
);
assertIncludes(
  files.settings,
  "Runtime Source",
  "Settings runtime source panel"
);
assertIncludes(
  files.settings,
  "activeFoundryDataSource",
  "Settings data source mode"
);
assertIncludes(
  files.settings,
  "sourceStatus",
  "Settings live source status"
);
assertIncludes(
  files.settings,
  "Default base model",
  "Settings default base model field"
);
assertIncludes(
  files.settings,
  "updateDefaultBaseModel",
  "Settings keeps default base model synchronized"
);
assertIncludes(
  files.settings,
  "Archive Maintenance",
  "Settings Archive maintenance panel"
);
assertIncludes(
  files.settings,
  "Clear Mock Archive",
  "Settings clears mock Archive state"
);
assertIncludes(
  files.settings,
  "activeFoundryDataSource.mode !== \"mock\"",
  "Settings protects live Archive from mock reset"
);
assertIncludes(
  files.construct,
  "sourceReachabilityLabel",
  "Construct live source status"
);
assertIncludes(
  files.construct,
  "configuredModelTarget",
  "Construct uses resolved default model target"
);
assertIncludes(
  files.systemReadinessDomain,
  "buildSystemReadinessSummary",
  "System readiness domain builder"
);
assertIncludes(
  files.systemReadinessDomain,
  "ModelArchiveEntry",
  "System readiness archive contract"
);
assertIncludes(
  files.systemReadinessDomain,
  "Archive state",
  "System readiness archive state step"
);
assertIncludes(
  files.systemReadinessDomain,
  "SystemReadinessModelAction",
  "System readiness model action contract"
);
assertIncludes(
  files.systemReadinessDomain,
  "ModelPreparationActivity",
  "System readiness model preparation activity contract"
);
assertIncludes(
  files.systemReadiness,
  "System readiness",
  "System readiness panel"
);
assertIncludes(
  files.systemReadiness,
  "Prepare Model",
  "System readiness prepare model action"
);
assertIncludes(
  files.systemReadiness,
  "model-preparation-activity",
  "System readiness preparation activity UI"
);
assertIncludes(
  files.systemReadiness,
  "archiveEntries",
  "System readiness archive entries prop"
);
assertIncludes(
  files.artifacts,
  "Archive Jobs",
  "Artifacts Archive Jobs panel"
);
assertIncludes(
  files.artifacts,
  ".listModelDownloadJobs()",
  "Artifacts hydrates Archive jobs"
);
assertIncludes(
  files.artifacts,
  "repository.getModelDownloadJob",
  "Artifacts polls Archive jobs"
);
assertIncludes(
  files.artifacts,
  "repository.startModelDownloadJob",
  "Artifacts queues Archive jobs"
);
assertIncludes(
  files.artifacts,
  "repository.cancelModelDownloadJob",
  "Artifacts cancels Archive jobs"
);
assertIncludes(
  files.artifacts,
  "archive-job-row",
  "Artifacts Archive job row UI"
);
assertIncludes(
  files.artifacts,
  "openDownloadJobInConstruct",
  "Artifacts opens cached Archive jobs in Construct"
);
assertIncludes(
  files.artifacts,
  "Archive Detail",
  "Artifacts Archive detail drawer"
);
assertIncludes(
  files.artifacts,
  "archive-inventory-grid",
  "Artifacts Archive inventory layout"
);
assertIncludes(
  files.artifacts,
  "selectArchiveEntryAsDefault",
  "Artifacts default base model action"
);
assertIncludes(
  files.artifacts,
  "repository.evictArchiveModel",
  "Artifacts evicts Archive cache"
);
assertIncludes(
  files.artifacts,
  "Set Default Base",
  "Artifacts default base model button"
);
assertIncludes(
  files.artifacts,
  "Evict Cache",
  "Artifacts evict cache button"
);
assertIncludes(
  files.artifacts,
  "defaultBaseModel",
  "Artifacts receives persisted default base model"
);
assertIncludes(
  files.forge,
  "resolveDefaultBaseModel",
  "Forge prefills from persisted default base model"
);
assertIncludes(
  files.workshopCreate,
  "resolveDefaultBaseModel",
  "Workshop creation prefills from persisted default base model"
);
assertIncludes(
  files.app,
  "parsedSettings.defaultBaseModel",
  "App migrates old saved settings to default base model"
);
assertIncludes(
  files.app,
  "defaultBaseModel: modelId",
  "App persists Archive-selected default base model"
);
assertIncludes(
  files.app,
  "handleClearMockArchiveState",
  "App handles mock Archive maintenance reset"
);
assertIncludes(
  files.app,
  "handlePrepareModel",
  "App prepare model action handler"
);
assertIncludes(
  files.app,
  "updateModelPreparation",
  "App preparation activity transitions"
);
assertIncludes(
  files.app,
  "repository.startModelDownloadJob",
  "App starts backend model download job"
);
assertIncludes(
  files.app,
  "repository.getModelDownloadJob",
  "App polls backend model download job"
);
assertIncludes(
  files.app,
  "activeModelDownloadJobId",
  "App resumes active model download job"
);
assertIncludes(
  files.app,
  "handleCancelPreparation",
  "App cancels model preparation"
);
assertIncludes(
  files.settings,
  "<SystemReadinessPanel",
  "Settings system readiness panel"
);
assertIncludes(
  files.construct,
  "<SystemReadinessPanel",
  "Construct system readiness panel"
);
assertIncludes(
  files.construct,
  ".recordConstructRuntimeEvent({",
  "Construct timeline persistence"
);
