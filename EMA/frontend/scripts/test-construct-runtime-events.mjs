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
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.domain,
  "export interface ConstructRuntimeEvent",
  "Runtime event domain contract"
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
