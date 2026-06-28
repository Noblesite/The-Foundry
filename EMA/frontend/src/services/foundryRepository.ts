import {
  ApiEnvelope,
  ApiErrorEnvelope,
  AcademyActionDto,
  AcademyConceptDto,
  ArchiveModelEvictDto,
  ArchiveModelInspectDto,
  ArchiveModelDownloadDto,
  ArchiveModelPreflightDto,
  ArchiveModelRegisterDto,
  ArchiveModelSearchDto,
  ArtifactDto,
  AssemblyLineRunDto,
  ClearConstructRuntimeEventsDto,
  ConfigureConstructRuntimeRequest,
  ConfigureForgeRuntimeRequest,
  ConfigureQAGeneratorRuntimeRequest,
  ConstructDto,
  ConstructChatRequest,
  ConstructChatResponseDto,
  ExportConstructDiagnosticsBundleDto,
  ConstructRuntimeValidationPageDto,
  ConstructRuntimeValidationDto,
  ConstructRuntimePreflightDto,
  ConstructRuntimeProbeDto,
  CreateTrialRequest,
  CreateWorkshopRequest,
  DeleteWorkshopRequest,
  DeleteWorkshopResult,
  ExportEvaluationSamplesDto,
  ExportEvaluationSamplesRequest,
  ExportConstructRuntimeEventsDto,
  ExportConstructRuntimeValidationsDto,
  ExportQAPairsDto,
  ExportQAPairsPreviewDto,
  ExportQAPairsRequest,
  ExportTrialsDto,
  ExportTrialsRequest,
  ForgeLocalTrainerPreflightDto,
  FoundryReadinessGateDto,
  FoundryReadinessGateRequest,
  ForgeSmokeProofDto,
  ForgeSmokeProofRequest,
  ForgeRunDto,
  ForgeWorkerReconcileDto,
  foundryApiRoutes,
  HuggingFaceAuthCheckDto,
  ImportMaterialFileRequest,
  IngestMaterialRequest,
  InspectArchiveModelRequest,
  LoadArtifactIntoConstructRequest,
  LoadConstructRuntimeRequest,
  ModelDownloadJobDto,
  MaterialChunkDto,
  PreviewWebsiteMaterialRequest,
  QAPairDto,
  QAGeneratorPreflightDto,
  QAGeneratorQualityProofDto,
  QAGeneratorRuntimeDto,
  QAGeneratorSmokeProofDto,
  PreflightConstructRuntimeRequest,
  ProbeConstructRuntimeRequest,
  SearchArchiveModelsRequest,
  StartAssemblyLineRequest,
  StartForgeRequest,
  TestHuggingFaceAuthRequest,
  TrialDto,
  UpdateQAPairReviewRequest,
} from "../contracts/foundryApi";
import {
  AcademyAction,
  Artifact,
  AcademyConcept,
  AssemblyLineRun,
  Construct,
  ConstructChatResponse,
  ConstructChatStreamEvent,
  ConstructDiagnosticsBundleExport,
  ConstructRuntimeEvent,
  ConstructRuntime,
  ConstructRuntimeHistoryExport,
  ConstructRuntimeValidation,
  ConstructRuntimeValidationExport,
  ConstructRuntimeValidationPage,
  ConstructRuntimeValidationQuery,
  ConstructRuntimePreflightResult,
  ConstructRuntimeProbeResult,
  CreateConstructRuntimeEventRequest,
  CreateConstructRuntimeValidationRequest,
  DashboardLoopEvidence,
  DashboardSummary,
  FoundryNavigationItem,
  ForgeEvaluationReport,
  ForgeLocalTrainerPreflightResult,
  ForgeSmokeProofResult,
  ForgeTrainingContract,
  ForgeWorkerReconcileResult,
  ForgeWorkerState,
  ForgeRuntime,
  ForgeRun,
  FoundryReadinessGate,
  FoundryRuntimeStatus,
  MaterialChunk,
  MaterialSource,
  ModelArchiveEntry,
  ModelDownloadJob,
  ModelPlatformProfile,
  ModelSearchResult,
  NavigationSection,
  QAPair,
  QAGeneratorPreflightResult,
  QAGeneratorQualityProof,
  QAGeneratorRuntime,
  QAGeneratorSmokeProof,
  SectionSummary,
  Trial,
  WebsiteMaterialPreview,
  Workshop,
} from "../domain/foundry";
import apiClient from "../managers/axiosConfig";
import { defaultAcademyActions, defaultAcademyConcepts } from "../domain/academyRegistry";
import {
  foundryNavigationItems,
  foundrySectionSummaries,
  mockDashboardSummary,
} from "../mocks/foundryMockData";

const DEFAULT_QA_GENERATOR_MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct";
const SMOKE_QA_GENERATOR_MODEL_ID = "sshleifer/tiny-gpt2";

type SectionSummaryMap = Record<
  Exclude<NavigationSection, "workshop" | "settings" | "construct">,
  SectionSummary
>;

export interface UiCatalogItem {
  id: string;
  component: string;
  station: NavigationSection;
  purpose: string;
  cacheKey: string;
  lastUpdated: string;
}

export interface FoundryBootstrap {
  dashboard: DashboardSummary;
  academyActions: AcademyAction[];
  navigationItems: FoundryNavigationItem[];
  sectionSummaries: SectionSummaryMap;
  uiCatalog: UiCatalogItem[];
}

const validationFacetCounts = (validations: ConstructRuntimeValidation[], key: "modelId" | "device" | "status") =>
  Array.from(
    validations.reduce<Map<string, number>>((counts, validation) => {
      const value = validation[key];
      counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    }, new Map())
  )
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));

const constructRuntimeValidationPage = (
  validations: ConstructRuntimeValidation[],
  query: ConstructRuntimeValidationQuery = {}
): ConstructRuntimeValidationPage => {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.max(1, query.pageSize || 5);
  const filtered = validations.filter((validation) => {
    const modelMatches = !query.modelId || validation.modelId === query.modelId;
    const deviceMatches = !query.device || validation.device === query.device;
    const statusMatches = !query.status || validation.status === query.status;
    return modelMatches && deviceMatches && statusMatches;
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    pageCount: filtered.length ? Math.ceil(filtered.length / pageSize) : 0,
    filters: {
      modelId: query.modelId || null,
      device: query.device || null,
      status: query.status || null,
    },
    facets: {
      models: validationFacetCounts(validations, "modelId"),
      devices: validationFacetCounts(validations, "device"),
      statuses: validationFacetCounts(validations, "status"),
    },
  };
};

const constructRuntimeValidationExport = (
  validations: ConstructRuntimeValidation[],
  query: Omit<ConstructRuntimeValidationQuery, "page" | "pageSize"> = {}
): ConstructRuntimeValidationExport => {
  const filtered = validations.filter((validation) => {
    const modelMatches = !query.modelId || validation.modelId === query.modelId;
    const deviceMatches = !query.device || validation.device === query.device;
    const statusMatches = !query.status || validation.status === query.status;
    return modelMatches && deviceMatches && statusMatches;
  });
  return {
    contractVersion: "foundry.construct.runtime-validations-export.v1",
    exportedAt: new Date().toISOString(),
    format: "json",
    validationCount: filtered.length,
    filters: {
      modelId: query.modelId || null,
      device: query.device || null,
      status: query.status || null,
    },
    validations: filtered,
  };
};

const fallbackDiagnosticsRedactionAudit = [
  {
    field: "settings.huggingFaceToken",
    status: "excluded",
    risk: "credential",
    reason: "Access tokens can grant model and account access.",
    policy: "Never export secret token values in diagnostics bundles.",
  },
  {
    field: "settings.huggingFaceUsername",
    status: "excluded",
    risk: "identity",
    reason: "Account identifiers are not required for runtime debugging.",
    policy: "Exclude user identifiers unless explicitly needed for a support workflow.",
  },
  {
    field: "sourceMaterial.contents",
    status: "excluded",
    risk: "private-data",
    reason: "Uploaded documents, transcripts, and prompts can contain copyrighted or private data.",
    policy: "Export metadata and runtime state only; do not bundle source content.",
  },
  {
    field: "chat.messages",
    status: "excluded",
    risk: "private-data",
    reason: "Conversation text may include user secrets or unpublished source material.",
    policy: "Export runtime event metadata instead of full chat transcripts.",
  },
  {
    field: "local.paths",
    status: "limited",
    risk: "system-fingerprint",
    reason: "Absolute paths can reveal usernames and local workstation structure.",
    policy: "Prefer model identifiers and cache status over full filesystem paths.",
  },
];

const constructDiagnosticsBundleExport = (
  runtimeHistory: ConstructRuntimeHistoryExport,
  validationHistory: ConstructRuntimeValidationExport,
  serviceStatus?: FoundryRuntimeStatus | null,
  runtime?: ConstructRuntime
): ConstructDiagnosticsBundleExport => ({
  contractVersion: "foundry.construct.diagnostics-bundle.v1",
  exportedAt: new Date().toISOString(),
  format: "json",
  source: "frontend-fallback",
  serviceStatus: serviceStatus || null,
  runtime: {
    current: runtime || runtimeHistory.runtime,
  },
  runtimeHistory,
  validationHistory: {
    count: validationHistory.validationCount,
    filteredExport: validationHistory,
  },
  redactions: [
    ...fallbackDiagnosticsRedactionAudit.map(
      (entry) => `${entry.field}: ${entry.status} (${entry.risk})`
    ),
    "frontendFallback: limited (runtime-state)",
  ],
  redactionAudit: fallbackDiagnosticsRedactionAudit,
});

export interface FoundryRepository {
  getFoundryStatus: () => Promise<FoundryRuntimeStatus>;
  checkReadinessGate: (request: FoundryReadinessGateRequest) => Promise<FoundryReadinessGate>;
  createWorkshop: (request: CreateWorkshopRequest) => Promise<Workshop>;
  deleteWorkshop: (
    workshopId: string,
    request: DeleteWorkshopRequest
  ) => Promise<DeleteWorkshopResult>;
  getDashboard: () => Promise<DashboardSummary>;
  getDashboardEvidence: (workshopId: string) => Promise<DashboardLoopEvidence>;
  getNavigationItems: () => Promise<FoundryNavigationItem[]>;
  getSectionSummaries: () => Promise<SectionSummaryMap>;
  getUiCatalog: () => Promise<UiCatalogItem[]>;
  listAcademyActions: () => Promise<AcademyAction[]>;
  listAcademyConcepts: () => Promise<AcademyConcept[]>;
  listWorkshops: () => Promise<Workshop[]>;
  listMaterials: (workshopId: string) => Promise<MaterialSource[]>;
  loadBootstrap: () => Promise<FoundryBootstrap>;
  registerMaterial: (
    workshopId: string,
    request: IngestMaterialRequest
  ) => Promise<MaterialSource>;
  previewWebsiteMaterial: (
    workshopId: string,
    request: PreviewWebsiteMaterialRequest
  ) => Promise<WebsiteMaterialPreview>;
  importMaterialFile: (
    workshopId: string,
    request: ImportMaterialFileRequest
  ) => Promise<MaterialSource>;
  listAssemblyLineRuns: (workshopId: string) => Promise<AssemblyLineRun[]>;
  getQAGeneratorRuntime: () => Promise<QAGeneratorRuntime>;
  configureQAGeneratorRuntime: (
    request: ConfigureQAGeneratorRuntimeRequest
  ) => Promise<QAGeneratorRuntime>;
  preflightQAGenerator: (
    request: ConfigureQAGeneratorRuntimeRequest
  ) => Promise<QAGeneratorPreflightResult>;
  runQAGeneratorSmokeProof: () => Promise<QAGeneratorSmokeProof>;
  runQAGeneratorQualityProof: () => Promise<QAGeneratorQualityProof>;
  startAssemblyLine: (
    workshopId: string,
    request: StartAssemblyLineRequest
  ) => Promise<AssemblyLineRun>;
  listMaterialChunks: (workshopId: string, runId?: string) => Promise<MaterialChunk[]>;
  listQAPairs: (workshopId: string, runId?: string) => Promise<QAPair[]>;
  updateQAPairReview: (
    workshopId: string,
    qaPairId: string,
    request: UpdateQAPairReviewRequest
  ) => Promise<QAPair>;
  exportQAPairs: (
    workshopId: string,
    request: ExportQAPairsRequest
  ) => Promise<ExportQAPairsDto>;
  previewQAPairsExport: (
    workshopId: string,
    request: ExportQAPairsRequest
  ) => Promise<ExportQAPairsPreviewDto>;
  listForgeRuns: (workshopId: string) => Promise<ForgeRun[]>;
  startForge: (workshopId: string, request: StartForgeRequest) => Promise<ForgeRun>;
  advanceForgeSimulation: (forgeRunId: string) => Promise<ForgeRun>;
  getForgeContract: (forgeRunId: string) => Promise<ForgeTrainingContract>;
  getForgeWorkerState: (forgeRunId: string) => Promise<ForgeWorkerState>;
  reconcileForgeWorkerState: (forgeRunId: string) => Promise<ForgeWorkerReconcileResult>;
  preflightLocalForgeWorker: (forgeRunId: string) => Promise<ForgeLocalTrainerPreflightResult>;
  runLocalForgeWorker: (forgeRunId: string) => Promise<ForgeWorkerReconcileResult>;
  runForgeSmokeProof: (request: ForgeSmokeProofRequest) => Promise<ForgeSmokeProofResult>;
  getForgeRuntime: () => Promise<ForgeRuntime>;
  configureForgeRuntime: (request: ConfigureForgeRuntimeRequest) => Promise<ForgeRuntime>;
  listArtifacts: (workshopId: string) => Promise<Artifact[]>;
  listTrials: (workshopId: string) => Promise<Trial[]>;
  createTrial: (workshopId: string, request: CreateTrialRequest) => Promise<Trial>;
  exportTrials: (workshopId: string, request: ExportTrialsRequest) => Promise<ExportTrialsDto>;
  exportEvaluationWeakSamples: (
    forgeRunId: string,
    request: ExportEvaluationSamplesRequest
  ) => Promise<ExportEvaluationSamplesDto>;
  loadArtifactIntoConstruct: (
    workshopId: string,
    request: LoadArtifactIntoConstructRequest
  ) => Promise<Construct>;
  listConstructs: (workshopId: string) => Promise<Construct[]>;
  chatWithConstruct: (
    constructId: string,
    request: ConstructChatRequest
  ) => Promise<ConstructChatResponse>;
  streamConstructChat: (
    constructId: string,
    request: ConstructChatRequest,
    onEvent: (event: ConstructChatStreamEvent) => void
  ) => Promise<void>;
  getConstructRuntime: () => Promise<ConstructRuntime>;
  listConstructRuntimeEvents: () => Promise<ConstructRuntimeEvent[]>;
  recordConstructRuntimeEvent: (
    request: CreateConstructRuntimeEventRequest
  ) => Promise<ConstructRuntimeEvent>;
  exportConstructRuntimeEvents: () => Promise<ExportConstructRuntimeEventsDto>;
  exportConstructDiagnosticsBundle: (
    query?: Omit<ConstructRuntimeValidationQuery, "page" | "pageSize">
  ) => Promise<ConstructDiagnosticsBundleExport>;
  clearConstructRuntimeEvents: () => Promise<ClearConstructRuntimeEventsDto>;
  listConstructRuntimeValidations: (
    query?: ConstructRuntimeValidationQuery
  ) => Promise<ConstructRuntimeValidationPage>;
  exportConstructRuntimeValidations: (
    query?: Omit<ConstructRuntimeValidationQuery, "page" | "pageSize">
  ) => Promise<ConstructRuntimeValidationExport>;
  createConstructRuntimeValidation: (
    request: CreateConstructRuntimeValidationRequest
  ) => Promise<ConstructRuntimeValidation>;
  configureConstructRuntime: (
    request: ConfigureConstructRuntimeRequest
  ) => Promise<ConstructRuntime>;
  loadConstructRuntime: (request: LoadConstructRuntimeRequest) => Promise<ConstructRuntime>;
  preflightConstructRuntime: (
    request: PreflightConstructRuntimeRequest
  ) => Promise<ConstructRuntimePreflightResult>;
  probeConstructRuntime: (
    request: ProbeConstructRuntimeRequest
  ) => Promise<ConstructRuntimeProbeResult>;
  unloadConstructRuntime: () => Promise<ConstructRuntime>;
  releaseConstructRuntimeMemory: () => Promise<ConstructRuntime>;
  listModelArchiveEntries: () => Promise<ModelArchiveEntry[]>;
  testHuggingFaceAuth: (
    request: TestHuggingFaceAuthRequest
  ) => Promise<HuggingFaceAuthCheckDto>;
  searchArchiveModels: (request: SearchArchiveModelsRequest) => Promise<ArchiveModelSearchDto>;
  preflightArchiveModel: (
    request: InspectArchiveModelRequest
  ) => Promise<ArchiveModelPreflightDto>;
  inspectArchiveModel: (request: InspectArchiveModelRequest) => Promise<ArchiveModelInspectDto>;
  registerArchiveModel: (request: InspectArchiveModelRequest) => Promise<ArchiveModelRegisterDto>;
  downloadArchiveModel: (request: InspectArchiveModelRequest) => Promise<ArchiveModelDownloadDto>;
  evictArchiveModel: (request: InspectArchiveModelRequest) => Promise<ArchiveModelEvictDto>;
  clearMockArchiveState: () => Promise<{
    archiveEntries: ModelArchiveEntry[];
    downloadJobs: ModelDownloadJob[];
  }>;
  startModelDownloadJob: (request: InspectArchiveModelRequest) => Promise<ModelDownloadJob>;
  listModelDownloadJobs: () => Promise<ModelDownloadJob[]>;
  getModelDownloadJob: (jobId: string) => Promise<ModelDownloadJob>;
  cancelModelDownloadJob: (jobId: string) => Promise<ModelDownloadJob>;
}

const mockMaterialSources: MaterialSource[] = [
  {
    id: "src-episode-transcripts",
    name: "Episode transcripts",
    kind: "transcript",
    status: "qa-ready",
    sourceUri: "runtime/materials/sources/transcripts",
    chunkCount: 524,
    qaPairCount: 288,
  },
  {
    id: "src-wiki-pages",
    name: "Character wiki pages",
    kind: "website",
    status: "chunked",
    sourceUri: "https://example.local/paw-patrol/wiki",
    chunkCount: 391,
    qaPairCount: 174,
  },
  {
    id: "src-safety-guide",
    name: "Rescue safety guide",
    kind: "pdf",
    status: "needs-review",
    sourceUri: "runtime/materials/sources/safety-guide.pdf",
    chunkCount: 333,
    qaPairCount: 180,
  },
];

const mockUiCatalog: UiCatalogItem[] = [
  {
    id: "ui-dashboard-progress-ring",
    component: "ProgressRing",
    station: "workshop",
    purpose: "Shows Workshop completion without requiring a backend render pass.",
    cacheKey: "foundry:ui:progress-ring:v1",
    lastUpdated: "2026-06-07T00:00:00Z",
  },
  {
    id: "ui-construct-chat",
    component: "ConstructWorkbench",
    station: "construct",
    purpose: "Hosts local model interaction and token streaming controls.",
    cacheKey: "foundry:ui:construct-workbench:v1",
    lastUpdated: "2026-06-07T00:00:00Z",
  },
  {
    id: "ui-academy-tooltip",
    component: "ConceptTooltip",
    station: "academy",
    purpose: "Keeps STEM explanations close to the action the user is taking.",
    cacheKey: "foundry:ui:concept-tooltip:v1",
    lastUpdated: "2026-06-07T00:00:00Z",
  },
];

const mockAssemblyLineRuns: AssemblyLineRun[] = [];
const mockMaterialChunks: MaterialChunk[] = [];
const mockQAPairs: QAPair[] = [];
let mockQAGeneratorRuntime: QAGeneratorRuntime = {
  contractVersion: "foundry.qa-generator.runtime.v1",
  mode: "deterministic",
  modelId: DEFAULT_QA_GENERATOR_MODEL_ID,
  maxNewTokens: 320,
  temperature: 0.2,
  ready: true,
  status: "ready",
  detail: "Using the offline deterministic QA generator for fast smoke tests.",
  dependencies: {
    transformers: false,
  },
};
const mockForgeRuns: ForgeRun[] = [...mockDashboardSummary.forgeQueue];
const mockArtifacts: Artifact[] = [mockDashboardSummary.currentArtifact];
const mockTrials: Trial[] = [];
const mockForgeWorkerStates: Record<string, ForgeWorkerState> = {};
const MOCK_ARCHIVE_ENTRIES_STORAGE_KEY = "foundry.mock.modelArchiveEntries";
const MOCK_DOWNLOAD_JOBS_STORAGE_KEY = "foundry.mock.modelDownloadJobs";
const mockPlatformProfile: ModelPlatformProfile = {
  os: "Darwin",
  machine: "arm64",
  python: "3.12",
  accelerator: "mps",
  systemMemoryBytes: 36 * 1024 ** 3,
  availableMemoryBytes: 18 * 1024 ** 3,
  acceleratorMemoryBytes: 18 * 1024 ** 3,
  unifiedMemory: true,
  torch: {
    cudaAvailable: false,
    mpsAvailable: true,
  },
};

const mockArtifactReadiness = (
  kind: "metadata-only" | "lora-adapter",
  adapterPath: string,
  baseModel: string
): Artifact["readiness"] => {
  const isAdapter = kind === "lora-adapter";
  return {
    status: isAdapter ? "verified" : "simulated",
    canLoad: true,
    message: isAdapter
      ? "Mock local trainer produced adapter metadata for UI rehearsal."
      : "Metadata-only Artifact from a simulated Forge; Construct load will stay simulated until real adapter files exist.",
    artifactKind: kind,
    checkedPath: adapterPath,
    requiredFiles: [
      "trainer-result.json",
      "adapter_model.safetensors",
      "adapter_model.bin",
      "adapter_config.json",
      "config.json",
    ],
    presentFiles: isAdapter ? ["trainer-result.json", "adapter_model.safetensors"] : [],
    outputFiles: isAdapter
      ? [
          { path: "trainer-result.json", role: "trainer-summary", sizeBytes: 256 },
          { path: "adapter_model.safetensors", role: "adapter-weights", sizeBytes: 1024 },
        ]
      : [],
    trainerResult: isAdapter
      ? {
          adapterPath,
          baseModel,
          device: "mock",
          loss: 0.1234,
          rowsUsed: 1,
          datasetRows: 1,
          targetModules: ["c_attn"],
          createdAt: new Date().toISOString(),
        }
      : null,
    compatibility: {
      status: isAdapter ? "matched" : "simulated",
      message: isAdapter
        ? "Mock trainer result base model matches the Artifact base model."
        : "No adapter compatibility check is possible for metadata-only simulated output.",
      baseModel,
      trainedBaseModel: isAdapter ? baseModel : null,
      adapterAppliesToBase: isAdapter ? true : null,
    },
  };
};

mockDashboardSummary.currentArtifact.readiness = mockArtifactReadiness(
  "metadata-only",
  mockDashboardSummary.currentArtifact.adapterPath || "runtime/artifacts/mock/metadata-only",
  mockDashboardSummary.currentArtifact.baseModel
);

const mockTrialRuntimeProfile = (
  artifact: Artifact | undefined,
  constructId: string,
  runtimeMode: string,
  generationSettings: Record<string, unknown>
): Trial["runtimeProfile"] => {
  const runtime = generationSettings.runtime as { diagnostics?: Record<string, unknown>; modelId?: string; device?: string } | undefined;
  const loadedModel = (runtime?.diagnostics?.loadedModel || {}) as Record<string, unknown>;
  const artifactKind = artifact?.readiness?.artifactKind || "metadata-only";
  const adapterLoaded = Boolean(loadedModel.adapterLoaded) || (runtimeMode === "transformers" && artifactKind === "lora-adapter");
  const source =
    runtimeMode === "simulated" || artifact?.readiness?.status === "simulated"
      ? "simulated"
      : adapterLoaded
        ? "adapter-backed"
        : "base-only";
  return {
    source,
    runtimeMode,
    baseModel: artifact?.baseModel || String(loadedModel.baseModelId || ""),
    modelId: String(loadedModel.modelId || runtime?.modelId || generationSettings.modelId || ""),
    artifactId: artifact?.id || "",
    artifactKind,
    adapterPath: artifactKind === "lora-adapter" ? artifact?.adapterPath || null : null,
    adapterLoaded,
    constructId,
    readinessStatus: artifact?.readiness?.status || null,
    device: String(loadedModel.device || runtime?.device || generationSettings.device || ""),
  };
};

const upsertMockTrialForMessage = (
  workshopId: string,
  request: {
    artifact: Artifact;
    constructId: string;
    messageId: string;
    prompt: string;
    response: string;
    verdict: Trial["verdict"];
    runtimeMode: string;
    tokenCount: number;
    generationSettings: Record<string, unknown>;
  }
): Trial => {
  const runtimeProfile = mockTrialRuntimeProfile(
    request.artifact,
    request.constructId,
    request.runtimeMode,
    request.generationSettings
  );
  const existingIndex = mockTrials.findIndex(
    (trial) => trial.workshopId === workshopId && trial.messageId === request.messageId
  );
  const generationSettings = {
    contextWindow: Number(request.generationSettings.contextWindow || mockConstruct.contextWindow),
    maxNewTokens: Number(request.generationSettings.maxNewTokens || mockConstruct.maxNewTokens),
    temperature: Number(request.generationSettings.temperature || mockConstruct.temperature),
    includeLibraryContext: Boolean(request.generationSettings.includeLibraryContext),
    ...request.generationSettings,
    runtimeProfile,
  };
  const trial: Trial = {
    id: existingIndex >= 0 ? mockTrials[existingIndex].id : `trl-${Date.now()}`,
    workshopId,
    artifactId: request.artifact.id,
    constructId: request.constructId,
    messageId: request.messageId,
    prompt: request.prompt,
    response: request.response,
    verdict: request.verdict,
    runtimeMode: request.runtimeMode,
    tokenCount: request.tokenCount,
    generationSettings:
      request.verdict === "needs-review"
        ? {
            ...generationSettings,
            autoTrial: {
              contractVersion: "foundry.construct.auto-trial.v1",
              verdict: "needs-review",
              reviewRequired: true,
            },
          }
        : generationSettings,
    runtimeProfile,
    createdAt: existingIndex >= 0 ? mockTrials[existingIndex].createdAt : new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    mockTrials.splice(existingIndex, 1, trial);
  } else {
    mockTrials.unshift(trial);
  }
  const reviewedTrials = mockTrials.filter(
    (item) =>
      item.artifactId === request.artifact.id &&
      (item.verdict === "pass" || item.verdict === "needs-work" || item.verdict === "fail")
  );
  const passCount = reviewedTrials.filter((item) => item.verdict === "pass").length;
  request.artifact.trialScore = reviewedTrials.length
    ? Math.round((passCount / reviewedTrials.length) * 100)
    : 0;
  mockDashboardSummary.currentArtifact = request.artifact;
  return trial;
};

const mockQAGeneratorSelection = (
  mode: QAGeneratorRuntime["mode"],
  modelId: string,
  maxNewTokens: number,
  archiveModelCached = false
): QAGeneratorRuntime["selection"] => {
  const isDeterministic = mode === "deterministic";
  const selectedTier = isDeterministic ? 0 : 1;
  return {
    contractVersion: "foundry.qa-generator.selection.v1",
    selectedTier,
    selectedProvider: isDeterministic ? "deterministic" : "transformers",
    selectedMode: mode,
    selectedModelId: isDeterministic ? "deterministic-context-generator" : modelId,
    qualityPreference: "balanced",
    fallbackPolicy: "fall back to deterministic rows with fallbackReason metadata; block fallback rows from default export",
    contextWindowRequirement: {
      promptContextTokens: 2048,
      maxNewTokens,
      estimatedRequiredContextTokens: 2048 + maxNewTokens,
      reason: "Mock mode does not inspect local model context windows.",
    },
    platform: mockPlatformProfile,
    tiers: [
      {
        tier: 0,
        label: "Deterministic offline fallback",
        provider: "deterministic",
        mode: "deterministic",
        modelId: "deterministic-context-generator",
        status: "ready",
        fitStatus: "fits",
        quality: "smoke",
        speed: "fast",
        reason: "Always available for smoke tests, demos, CI, and no-download first-run workflows.",
        nextAction: "Use for baseline validation, then switch to API mode for model-backed QA checks.",
      },
      {
        tier: 1,
        label: "Small cached local model",
        provider: "transformers",
        mode: "transformers",
        modelId,
        status: archiveModelCached ? "ready" : "blocked",
        fitStatus: archiveModelCached ? "fits" : "unknown",
        quality: "modest",
        speed: archiveModelCached ? "simulated-proof" : "backend-dependent",
        reason: archiveModelCached
          ? "Mock Archive has a cached model entry, so the UI can rehearse the model-backed QA proof loop."
          : "Mock mode cannot verify optional ML dependencies until the model is cached in Archive.",
        nextAction: archiveModelCached
          ? "Run the model-backed proof simulation, then use API mode for the real Transformers path."
          : "Cache the generator model in Archive before running the model-backed proof.",
      },
      {
        tier: 2,
        label: "Stronger local model",
        provider: "transformers",
        mode: "transformers",
        modelId,
        status: "candidate",
        fitStatus: "unknown",
        quality: "higher",
        speed: "moderate",
        reason: "This is a planning candidate; backend preflight decides fit.",
        nextAction: "Use Archive and backend preflight before selecting a stronger generator.",
      },
      {
        tier: 3,
        label: "User-provided inference endpoint",
        provider: "openai-compatible-endpoint",
        mode: "endpoint",
        modelId,
        status: "not-configured",
        fitStatus: "external",
        quality: "user-selected",
        speed: "endpoint-dependent",
        reason: "Endpoint adapters are optional and not active in mock mode.",
        nextAction: "Configure an endpoint when endpoint adapters are enabled.",
      },
    ],
  };
};

mockQAGeneratorRuntime = {
  ...mockQAGeneratorRuntime,
  platform: mockPlatformProfile,
  selection: mockQAGeneratorSelection(
    mockQAGeneratorRuntime.mode,
    mockQAGeneratorRuntime.modelId,
    mockQAGeneratorRuntime.maxNewTokens
  ),
};

const readMockStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(key);
    return storedValue ? (JSON.parse(storedValue) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeMockStorage = (key: string, value: unknown) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Mock persistence should never block the workbench if storage is unavailable.
  }
};

const removeMockStorage = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Mock maintenance should never block the workbench if storage is unavailable.
  }
};

const mockModelArchiveEntries: ModelArchiveEntry[] = readMockStorage<ModelArchiveEntry[]>(
  MOCK_ARCHIVE_ENTRIES_STORAGE_KEY,
  []
);
const mockModelDownloadJobs: Record<string, ModelDownloadJob> = readMockStorage<
  Record<string, ModelDownloadJob>
>(MOCK_DOWNLOAD_JOBS_STORAGE_KEY, {});

const persistMockArchiveEntries = () => {
  writeMockStorage(MOCK_ARCHIVE_ENTRIES_STORAGE_KEY, mockModelArchiveEntries);
};

const persistMockDownloadJobs = () => {
  writeMockStorage(MOCK_DOWNLOAD_JOBS_STORAGE_KEY, mockModelDownloadJobs);
};

const findMockCachedArchiveEntry = (modelId: string): ModelArchiveEntry | undefined =>
  mockModelArchiveEntries.find(
    (entry) =>
      entry.repoId === modelId &&
      Boolean(entry.localPath) &&
      (entry.status === "cached" || entry.status === "ready")
  );

const mockArchiveModels: ModelSearchResult[] = [
  {
    repoId: DEFAULT_QA_GENERATOR_MODEL_ID,
    author: "Qwen",
    sha: "mock",
    lastModified: new Date().toISOString(),
    downloads: 7600000,
    likes: 6200,
    libraryName: "transformers",
    pipelineTag: "text-generation",
    tags: ["transformers", "pytorch", "qwen", "instruct", "qa-quality-preset"],
    gated: false,
    private: false,
    parameterCount: 500_000_000,
    sizeBytes: 1_000_000_000,
    fitEstimate: {
      status: "fits",
      recommendedRuntime: "mps",
      estimatedBytes: 1_350_000_000,
      availableBytes: mockPlatformProfile.availableMemoryBytes,
      assumedQuantization: "fp16",
      reason: "Estimated memory fits with comfortable runtime headroom for local QA proof.",
    },
  },
  {
    repoId: SMOKE_QA_GENERATOR_MODEL_ID,
    author: "sshleifer",
    sha: "mock",
    lastModified: new Date().toISOString(),
    downloads: 184000,
    likes: 98,
    libraryName: "transformers",
    pipelineTag: "text-generation",
    tags: ["transformers", "pytorch", "gpt2", "tiny"],
    gated: false,
    private: false,
    parameterCount: 102714,
    sizeBytes: 2514146,
    fitEstimate: {
      status: "fits",
      recommendedRuntime: "mps",
      estimatedBytes: 3394097,
      availableBytes: mockPlatformProfile.availableMemoryBytes,
      assumedQuantization: "int4",
      reason: "Estimated memory fits with comfortable runtime headroom.",
    },
  },
  {
    repoId: "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    author: "TinyLlama",
    sha: "mock",
    lastModified: new Date().toISOString(),
    downloads: 921000,
    likes: 2000,
    libraryName: "transformers",
    pipelineTag: "text-generation",
    tags: ["transformers", "pytorch", "llama", "1.1b"],
    gated: false,
    private: false,
    parameterCount: 1_100_000_000,
    sizeBytes: 2_200_000_000,
    fitEstimate: {
      status: "fits",
      recommendedRuntime: "mps",
      estimatedBytes: 2_970_000_000,
      availableBytes: mockPlatformProfile.availableMemoryBytes,
      assumedQuantization: "int4",
      reason: "Estimated memory fits with comfortable runtime headroom.",
    },
  },
];
let mockConstruct: Construct = mockDashboardSummary.construct;
let mockConstructRuntimeEvents: ConstructRuntimeEvent[] = [];
let mockConstructRuntimeValidations: ConstructRuntimeValidation[] = [];
let mockRuntimeLoadEvent: Record<string, unknown> = {
  status: "idle",
  modelId: "active Artifact base model",
  device: "none",
  durationSeconds: null,
  startedAt: null,
  finishedAt: null,
  failureReason: null,
};
const mockRuntimeDiagnostics = (runtime?: Partial<ConstructRuntime>): Record<string, unknown> => ({
  torchVersion: "mock",
  cudaAvailable: false,
  mpsBuilt: true,
  mpsAvailable: true,
  memory: {
    totalGb: 36,
    availableGb: runtime?.loaded ? 21 : 24,
    percentUsed: runtime?.loaded ? 42 : 33,
  },
  loadedModel: {
    modelId: runtime?.modelId || "active Artifact base model",
    device: runtime?.device || "none",
    loaded: runtime?.loaded ?? false,
    cacheSize: runtime?.loaded ? 1 : 0,
  },
  loadEvent: mockRuntimeLoadEvent,
});
let mockConstructRuntime: ConstructRuntime = {
  mode: "simulated",
  status: "fallback",
  detail: "Mock repository uses deterministic simulated token streaming.",
  modelId: "active Artifact base model",
  device: "none",
  loaded: true,
  diagnostics: mockRuntimeDiagnostics({
    modelId: "active Artifact base model",
    device: "none",
    loaded: true,
  }),
};

const recordMockConstructRuntimeEvent = (
  request: CreateConstructRuntimeEventRequest
): ConstructRuntimeEvent => {
  const event: ConstructRuntimeEvent = {
    ...request,
    id: `runtime-event-${Date.now()}-${mockConstructRuntimeEvents.length}`,
    timestamp: request.timestamp || new Date().toISOString(),
    source: request.source || "mock",
  };
  mockConstructRuntimeEvents = [event, ...mockConstructRuntimeEvents].slice(0, 25);
  return event;
};
let mockForgeRuntime: ForgeRuntime = {
  mode: "simulated",
  status: "ready",
  detail: "Mock Forge runtime uses deterministic progress simulation.",
  worker: "in-process-simulator",
  ready: true,
  supportsMethods: ["LoRA", "QLoRA"],
};

const buildMockFoundryStatus = (): FoundryRuntimeStatus => {
  const checkedAt = new Date().toISOString();
  return {
    contractVersion: "foundry.status.v1",
    api: {
      reachable: false,
      status: "mock",
      detail: "FastAPI is not required in mock mode.",
      checkedAt,
    },
    construct: {
      reachable: true,
      status: mockConstructRuntime.status,
      detail: mockConstructRuntime.detail,
      mode: mockConstructRuntime.mode,
      modelLoaded: mockConstructRuntime.loaded,
      modelId: mockConstructRuntime.modelId,
      device: mockConstructRuntime.device,
      checkedAt,
    },
    forge: {
      reachable: true,
      status: mockForgeRuntime.status,
      detail: mockForgeRuntime.detail,
      mode: mockForgeRuntime.mode,
      ready: mockForgeRuntime.ready,
      checkedAt,
    },
    catalog: {
      reachable: true,
      status: "mock",
      detail: "Catalog reads from local mock data.",
      checkedAt,
    },
  };
};

const buildMockEvaluationReport = (
  forgeRun: ForgeRun,
  material: MaterialSource | undefined,
  rowCount: number
): ForgeEvaluationReport => {
  const safeRowCount = Math.max(1, rowCount);
  const passCount = Math.round(safeRowCount * 0.68);
  const needsWorkCount = Math.round(safeRowCount * 0.22);
  const failCount = safeRowCount - passCount - needsWorkCount;
  const passRate = Math.round((passCount / safeRowCount) * 100);
  const sampleName = material?.name || "selected Trial Material";

  return {
    reportVersion: "foundry.forge.evaluation.v1",
    forgeRunId: forgeRun.id,
    materialId: forgeRun.materialSetId || "unknown",
    datasetUri: material?.sourceUri || "runtime/materials/exports/mock.jsonl",
    rowCount: safeRowCount,
    passCount,
    needsWorkCount,
    failCount,
    passRate,
    rubric: [
      {
        label: "Instruction match",
        score: Math.min(96, passRate + 8),
        explanation: "Checks whether replies follow the requested task and persona constraints.",
      },
      {
        label: "Expected answer overlap",
        score: Math.max(38, passRate - 2),
        explanation: "Compares generated content against reviewed reference answers.",
      },
      {
        label: "Safety and tone",
        score: Math.min(98, passRate + 12),
        explanation: "Flags harsh, unsafe, or off-character responses before promotion.",
      },
    ],
    samples: [
      {
        instruction: `Answer a representative prompt from ${sampleName}.`,
        expected: "The reviewed Trial answer stays on task and in character.",
        observed: "The simulated Construct stayed on task and matched the reviewed answer.",
        verdict: "pass",
        note: "Reference answer and simulated Construct reply line up well.",
      },
      {
        instruction: `Handle a harder edge case from ${sampleName}.`,
        expected: "The response should stay grounded in the Material.",
        observed: "The response was useful but missed one grounding detail.",
        verdict: "needs-work",
        note: "Reply is directionally useful but should be tightened before promotion.",
      },
    ],
    recommendations: [
      "Review failed and needs-work samples before promoting a new Artifact.",
      "Export corrected Trial rows back into Materials when the same mistake repeats.",
      "Compare this Trial Report against the next Artifact before deployment.",
    ],
    createdAt: new Date().toISOString(),
  };
};

const unwrap = <T>(response: { data: ApiEnvelope<T> }): T => response.data.data;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeHuggingFaceError = (message: string) => {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("rejected the saved token") ||
    lowered.includes("gated or private") ||
    lowered.includes("could not find that model")
  ) {
    return message;
  }
  if (
    lowered.includes("invalid token") ||
    lowered.includes("token is invalid") ||
    lowered.includes("unauthorized") ||
    lowered.includes("401")
  ) {
    return "Hugging Face rejected the saved token. Check Settings, paste a current access token, and make sure it belongs to the selected username.";
  }
  if (
    lowered.includes("gated") ||
    lowered.includes("private") ||
    lowered.includes("restricted") ||
    lowered.includes("access to model")
  ) {
    return "This model is gated or private. Sign in to Hugging Face, accept the model terms if required, then save your username and access token in Settings.";
  }
  if (lowered.includes("repository not found") || lowered.includes("404")) {
    return "Hugging Face could not find that model, or the account saved in Settings does not have access to it.";
  }
  return message;
};

const apiErrorMessage = (error: unknown, fallback: string) => {
  if (isRecord(error) && isRecord(error.response)) {
    const data = error.response.data;
    if (isRecord(data)) {
      const detail = data.detail;
      if (typeof detail === "string") {
        return normalizeHuggingFaceError(detail);
      }
      const envelope = data as Partial<ApiErrorEnvelope>;
      if (envelope.error?.message) {
        return normalizeHuggingFaceError(envelope.error.message);
      }
    }
  }

  if (error instanceof Error && error.message) {
    return normalizeHuggingFaceError(error.message);
  }

  return fallback;
};

const archiveRequest = async <T>(request: Promise<{ data: ApiEnvelope<T> }>, fallback: string) => {
  try {
    return unwrap(await request);
  } catch (error: unknown) {
    throw new Error(apiErrorMessage(error, fallback));
  }
};

const buildApiUnavailableStatus = (detail: string): FoundryRuntimeStatus => {
  const checkedAt = new Date().toISOString();
  return {
    contractVersion: "foundry.status.v1",
    api: {
      reachable: false,
      status: "unreachable",
      detail,
      checkedAt,
    },
    construct: {
      reachable: false,
      status: "unavailable",
      detail: "Construct runtime status is unavailable until FastAPI responds.",
      mode: null,
      modelLoaded: false,
      modelId: null,
      device: null,
      checkedAt,
    },
    forge: {
      reachable: false,
      status: "unavailable",
      detail: "Forge runtime status is unavailable until FastAPI responds.",
      mode: null,
      ready: false,
      checkedAt,
    },
    catalog: {
      reachable: false,
      status: "unavailable",
      detail: "Catalog status is unavailable until FastAPI responds.",
      checkedAt,
    },
  };
};

const mockReadinessGate = async (
  request: FoundryReadinessGateRequest
): Promise<FoundryReadinessGate> => {
  const stations: FoundryReadinessGate["stations"] = [];
  if (request.archiveRepoId) {
    const preflight = await mockFoundryRepository.preflightArchiveModel({
      repoId: request.archiveRepoId,
      revision: request.archiveRevision || "",
      username: request.archiveUsername || undefined,
      token: request.archiveToken || undefined,
    });
    stations.push({
      id: "archive-download",
      label: "Archive download",
      status: preflight.canDownload ? "ready" : "blocked",
      canProceed: preflight.canDownload,
      title: preflight.canDownload ? "Model download ready" : "Model download blocked",
      detail: preflight.message,
      nextAction: preflight.canDownload
        ? "Download or register this model in the Archive."
        : "Add required Hugging Face auth or choose a public model.",
      checks: [
        {
          id: "download-permission",
          label: "Download permission",
          status: preflight.canDownload ? "pass" : "fail",
          detail: preflight.message,
        },
      ],
      warnings: preflight.canDownload ? [] : [preflight.message],
      source: preflight as unknown as Record<string, unknown>,
    });
  }
  if (request.constructModelId) {
    const preflight = await mockFoundryRepository.preflightConstructRuntime({
      modelId: request.constructModelId,
      device: request.constructDevice || "auto",
    });
    const status = !preflight.ok
      ? "blocked"
      : preflight.fitStatus === "tight" || preflight.fitStatus === "unknown" || preflight.warnings.length
        ? "caution"
        : "ready";
    stations.push({
      id: "construct-load",
      label: "Construct load",
      status,
      canProceed: status !== "blocked",
      title: status === "ready" ? "Construct runtime ready" : "Construct runtime needs review",
      detail: preflight.ok ? "Construct runtime preflight passed." : "Construct runtime preflight is blocked.",
      nextAction:
        status === "ready"
          ? "Load the model into Construct."
          : "Review failed checks, cache the model, or choose a smaller target.",
      checks: preflight.checks,
      warnings: preflight.warnings,
      source: preflight as unknown as Record<string, unknown>,
    });
  }
  if (request.forgeRunId) {
    const preflight = await mockFoundryRepository.preflightLocalForgeWorker(request.forgeRunId);
    stations.push({
      id: "forge-start",
      label: "Forge start",
      status: preflight.status,
      canProceed: preflight.status !== "blocked",
      title: preflight.title,
      detail: preflight.summary,
      nextAction: preflight.nextAction,
      checks: preflight.checks,
      warnings: preflight.warnings,
      source: preflight as unknown as Record<string, unknown>,
    });
  }

  const status = stations.some((station) => station.status === "blocked")
    ? "blocked"
    : stations.some((station) => station.status === "caution")
      ? "caution"
      : stations.length
        ? "ready"
        : "blocked";
  return {
    contractVersion: "foundry.readiness-gate.v1",
    status,
    canProceed: status !== "blocked",
    title: "Foundry readiness gate",
    summary:
      status === "ready"
        ? "Archive, Construct, and Forge checks are ready for the requested path."
        : status === "caution"
          ? "The workflow can continue, but one or more stations need review."
          : "One or more stations are blocked.",
    nextAction:
      status === "ready"
        ? "Continue to the next workflow step."
        : status === "caution"
          ? "Review caution warnings before continuing."
          : "Resolve blocked station checks before continuing.",
    stations,
    createdAt: new Date().toISOString(),
  };
};

export const mockFoundryRepository: FoundryRepository = {
  checkReadinessGate: mockReadinessGate,
  getFoundryStatus: async () => buildMockFoundryStatus(),
  createWorkshop: async (request) => ({
    id: `wrk-${request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: request.name,
    subject: request.subject,
    voiceTarget: request.voiceTarget || "Assistant",
    status: "planning",
    progress: 0,
    materialRefinement: 0,
    activeArtifactId: "art-draft",
    activeConstructId: "con-draft",
  }),
  deleteWorkshop: async (workshopId, request) => {
    if (workshopId === mockDashboardSummary.workshop.id) {
      throw new Error("Create another Workshop before deleting the last one.");
    }
    return {
      deletedWorkshopId: workshopId,
      deletedWorkshopName: request.confirmationName,
      deletedCounts: {
        workshops: 1,
        materials: 0,
        assemblyLineRuns: 0,
        materialChunks: 0,
        qaPairs: 0,
        forgeRuns: 0,
        artifacts: 0,
        constructs: 0,
        constructMessages: 0,
        trials: 0,
      },
      removedRuntimePaths: [],
      nextWorkshop: mockDashboardSummary.workshop,
    };
  },
  getDashboard: async () => mockDashboardSummary,
  getDashboardEvidence: async () => mockDashboardSummary.loopEvidence!,
  getNavigationItems: async () => foundryNavigationItems,
  getSectionSummaries: async () => foundrySectionSummaries,
  getUiCatalog: async () => mockUiCatalog,
  listAcademyActions: async () => defaultAcademyActions,
  listAcademyConcepts: async () => defaultAcademyConcepts,
  listWorkshops: async () => [mockDashboardSummary.workshop],
  listMaterials: async () => mockMaterialSources,
  loadBootstrap: async () => ({
    dashboard: mockDashboardSummary,
    academyActions: defaultAcademyActions,
    navigationItems: foundryNavigationItems,
    sectionSummaries: foundrySectionSummaries,
    uiCatalog: mockUiCatalog,
  }),
  registerMaterial: async (_workshopId, request) => {
    const material: MaterialSource = {
      id: `mat-${request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: request.name,
      kind: request.kind,
      status: "staged",
      sourceUri: request.sourceUri,
      chunkCount: 0,
      qaPairCount: 0,
    };
    mockMaterialSources.unshift(material);
    return material;
  },
  previewWebsiteMaterial: async (_workshopId, request) => ({
    contractVersion: "foundry.material.website-preview.v1",
    sourceUrl: request.sourceUri,
    title: "Mock website snapshot",
    description: "Mock preview generated without network access.",
    textPreview:
      "Marshall uses a water cannon during rescue practice. He helps Adventure Bay with ladder safety and teamwork.",
    textLength: 103,
    estimatedTokenCount: 16,
    fetchLimitBytes: 2 * 1024 * 1024,
    createdAt: new Date().toISOString(),
  }),
  importMaterialFile: async (_workshopId, request) => {
    const material: MaterialSource = {
      id: `mat-${request.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: request.name,
      kind: request.kind,
      status: "staged",
      sourceUri: `runtime/materials/sources/${request.file.name}`,
      chunkCount: 0,
      qaPairCount: 0,
    };
    mockMaterialSources.unshift(material);
    return material;
  },
  listAssemblyLineRuns: async () => mockAssemblyLineRuns,
  getQAGeneratorRuntime: async () => mockQAGeneratorRuntime,
  configureQAGeneratorRuntime: async (request) => {
    const modelId = request.modelId || DEFAULT_QA_GENERATOR_MODEL_ID;
    const isDeterministic = request.mode === "deterministic";
    const cachedArchiveEntry = findMockCachedArchiveEntry(modelId);
    const modelReady = isDeterministic || Boolean(cachedArchiveEntry);
    mockQAGeneratorRuntime = {
      ...mockQAGeneratorRuntime,
      mode: request.mode,
      modelId,
      maxNewTokens: request.maxNewTokens,
      temperature: request.temperature,
      ready: modelReady,
      status: modelReady ? "ready" : "blocked",
      detail:
        isDeterministic
          ? "Using the offline deterministic QA generator for fast smoke tests."
          : cachedArchiveEntry
            ? `Using cached mock Archive model ${modelId} for model-backed QA proof simulation.`
            : "Cache this QA generator model in Archive before running the model-backed proof.",
      dependencies: {
        transformers: !isDeterministic && Boolean(cachedArchiveEntry),
      },
      platform: mockPlatformProfile,
      selection: mockQAGeneratorSelection(
        request.mode,
        modelId,
        request.maxNewTokens,
        Boolean(cachedArchiveEntry)
      ),
    };
    return mockQAGeneratorRuntime;
  },
  preflightQAGenerator: async (request) => {
    const isDeterministic = request.mode === "deterministic";
    const modelId = request.modelId || DEFAULT_QA_GENERATOR_MODEL_ID;
    const cachedArchiveEntry = findMockCachedArchiveEntry(modelId);
    const archiveModelCached = Boolean(cachedArchiveEntry);
    const estimatedLoadBytes = isDeterministic
      ? 0
      : Math.max(512 * 1024 ** 2, Math.round((cachedArchiveEntry?.sizeOnDiskBytes || 0) * 2.2));
    const memoryFits =
      isDeterministic || estimatedLoadBytes < mockPlatformProfile.availableMemoryBytes * 0.85;
    const checks = isDeterministic
      ? [
          {
            id: "runtime-mode",
            label: "Runtime mode",
            status: "pass" as const,
            detail: "Deterministic QA generation is available in mock mode.",
          },
        ]
      : [
          {
            id: "runtime-mode",
            label: "Runtime mode",
            status: "pass" as const,
            detail: "Local Transformers mode selected.",
          },
          {
            id: "dependencies",
            label: "Transformers dependency",
            status: archiveModelCached ? ("pass" as const) : ("warn" as const),
            detail: archiveModelCached
              ? "Mock mode is simulating a cached local Transformers generator; use API mode for real dependency checks."
              : "Mock mode cannot verify optional ML dependencies until the model is cached in Archive.",
          },
          {
            id: "archive-cache",
            label: "Local model cache",
            status: archiveModelCached ? ("pass" as const) : ("fail" as const),
            detail: archiveModelCached
              ? `Mock Archive cache is ready at ${cachedArchiveEntry?.localPath}.`
              : "Cache the QA generator model in Archive before running model-backed QA proof.",
          },
          {
            id: "memory-fit",
            label: "Memory fit",
            status: memoryFits ? ("pass" as const) : ("warn" as const),
            detail: memoryFits
              ? "Mock memory estimate fits the current platform profile."
              : "Mock memory estimate may exceed the conservative local budget.",
          },
        ];
    const status = isDeterministic || archiveModelCached ? "ready" : "blocked";
    return {
      contractVersion: "foundry.qa-generator.preflight.v1",
      ok: isDeterministic || archiveModelCached,
      status,
      title: isDeterministic
        ? "Deterministic QA generator ready"
        : archiveModelCached
          ? "Local QA generator ready"
          : "Local QA generator waiting on Archive cache",
      summary: isDeterministic
        ? "Smoke-test QA generation can run offline."
        : archiveModelCached
          ? "Mock Archive cache is ready for model-backed QA proof simulation."
          : "Cache this tiny generator model in Archive before model-backed QA generation.",
      nextAction: isDeterministic
        ? "Run Smoke proof or start the Assembly Line."
        : archiveModelCached
          ? "Configure Local Transformers, then run Quality proof."
          : "Open Archive and cache this generator model.",
      mode: request.mode,
      modelId,
      maxNewTokens: request.maxNewTokens,
      temperature: request.temperature,
      model: {
        modelId,
        path: cachedArchiveEntry?.localPath || null,
        cached: archiveModelCached,
        sizeOnDiskBytes: cachedArchiveEntry?.sizeOnDiskBytes || 0,
        message: archiveModelCached
          ? "Mock Archive cache is ready for the QA generator proof loop."
          : "Mock Archive does not have this QA generator cached yet.",
      },
      memory: {
        fitStatus: memoryFits ? "fits" : "tight",
        checkStatus: isDeterministic || memoryFits ? "pass" : "warn",
        estimatedLoadBytes,
        availableBytes: mockPlatformProfile.availableMemoryBytes,
        message: isDeterministic
          ? "No model memory needed for deterministic QA generation."
          : memoryFits
            ? "Mock memory estimate fits the local profile; API mode performs the real runtime check."
            : "Mock memory estimate needs review before loading a larger generator.",
      },
      platform: mockPlatformProfile,
      selection: mockQAGeneratorSelection(
        request.mode,
        modelId,
        request.maxNewTokens,
        archiveModelCached
      ),
      checks,
      warnings: checks.filter((check) => check.status !== "pass").map((check) => check.detail),
      createdAt: new Date().toISOString(),
    };
  },
  runQAGeneratorSmokeProof: async () => {
    const row: QAPair = {
      id: `qa-smoke-${Date.now()}`,
      workshopId: mockDashboardSummary.workshop.id,
      materialId: "mat-smoke-qa-generator",
      chunkId: "chk-smoke-qa-generator",
      assemblyLineRunId: "asm-smoke-qa-generator",
      question: "What should a model learn about Marshall from the smoke material?",
      answer: "Marshall helps the team solve emergencies and keeps trying until everyone is safe.",
      generatorModel:
        mockQAGeneratorRuntime.mode === "deterministic"
          ? "deterministic-context-generator"
          : mockQAGeneratorRuntime.modelId,
      confidence: 0.68,
      generationMetadata: {
        contractVersion: "foundry.qa-generation.v1",
        mode: mockQAGeneratorRuntime.mode,
        strategy: "context-sentence",
      },
      reviewStatus: "draft",
      reviewedAt: null,
    };
    const status = mockQAGeneratorRuntime.ready ? "passed" : "warning";
    return {
      contractVersion: "foundry.qa-generator.smoke-proof.v1",
      status,
      runtime: mockQAGeneratorRuntime,
      request: {
        materialName: "Foundry QA Smoke Material",
        materialKind: "text",
        chunkId: row.chunkId,
        qaPairCount: 1,
      },
      rows: [row],
      summary:
        status === "passed"
          ? "QA generator produced a draft row."
          : "QA generator produced a mock fallback row because Transformers is unavailable.",
      createdAt: new Date().toISOString(),
    };
  },
  runQAGeneratorQualityProof: async () => {
    const cachedArchiveEntry = findMockCachedArchiveEntry(mockQAGeneratorRuntime.modelId);
    const modelBackedReady =
      mockQAGeneratorRuntime.mode === "transformers" &&
      mockQAGeneratorRuntime.ready &&
      Boolean(cachedArchiveEntry);
    const deterministic = {
      id: `qa-proof-det-${Date.now()}`,
      question: "What should a model learn about Marshall from the proof material?",
      answer: "Marshall is a fire pup who helps during fire and medical emergencies.",
      generatorModel: "deterministic-context-generator",
      confidence: 0.68,
      generationMetadata: {
        contractVersion: "foundry.qa-generation.v1",
        mode: "deterministic",
        strategy: "context-sentence",
      },
      reviewStatus: "draft" as const,
      reviewedAt: null,
    };
    const modelBacked = {
      id: `qa-proof-model-${Date.now()}`,
      question: "Which emergency roles does Marshall handle in Adventure Bay?",
      answer:
        "Marshall helps the Paw Patrol as a fire pup and supports medical emergencies when the team needs rescue help.",
      generatorModel: mockQAGeneratorRuntime.modelId,
      confidence: 0.78,
      generationMetadata: {
        contractVersion: "foundry.qa-generation.v1",
        mode: "transformers",
        strategy: "mock-cached-model-context-synthesis",
        archivePath: cachedArchiveEntry?.localPath || null,
      },
      reviewStatus: "draft" as const,
      reviewedAt: null,
    };
    return {
      contractVersion: "foundry.qa-generator.quality-proof.v1",
      runtime: mockQAGeneratorRuntime,
      proofMode: {
        source: "mock",
        mode: mockQAGeneratorRuntime.mode,
        modelId: mockQAGeneratorRuntime.modelId,
        localFilesOnly: true,
        simulated: true,
        preflightStatus: modelBackedReady ? "ready" : "blocked",
        modelCached: Boolean(cachedArchiveEntry),
        modelPath: cachedArchiveEntry?.localPath || null,
      },
      request: {
        materialName: "Foundry QA Proof Material",
        materialKind: "text",
        chunkId: "chk-proof-mock",
        qaPairCount: 1,
      },
      sourceText:
        "Marshall is a Dalmatian fire pup from Adventure Bay who helps during emergencies.",
      results: [
        {
          label: "Deterministic smoke",
          status: "passed",
          detail: "Generated a QA row with a 68% proof score.",
          rows: [deterministic],
          quality: {
            score: 0.68,
            confidence: 0.68,
            sourceOverlap: 0.75,
            answerLength: 12,
            questionFormed: true,
            fallback: false,
          },
        },
        {
          label: "Cached local model",
          status: modelBackedReady ? "passed" : "warning",
          detail: modelBackedReady
            ? `Mock Archive cache produced a model-backed QA proof from ${mockQAGeneratorRuntime.modelId}.`
            : "Cache a tiny generator model in Archive before running the model-backed proof.",
          proofSource: "mock-simulated",
          localFilesOnly: true,
          preflightStatus: modelBackedReady ? "ready" : "blocked",
          rows: modelBackedReady ? [modelBacked] : [],
          quality: {
            score: modelBackedReady ? 0.78 : 0,
            confidence: modelBackedReady ? 0.78 : 0,
            sourceOverlap: modelBackedReady ? 0.82 : 0,
            answerLength: modelBackedReady ? 16 : 0,
            questionFormed: modelBackedReady,
            fallback: !modelBackedReady,
          },
        },
      ],
      recommendation: modelBackedReady
        ? "Model-backed QA proof is ready in mock mode; switch to API mode for the real Transformers run."
        : "Cache a tiny generator model first, then rerun the proof to compare model-aware QA against deterministic drafts.",
      createdAt: new Date().toISOString(),
    };
  },
  startAssemblyLine: async (_workshopId, request) => {
    const selectedMaterials = mockMaterialSources.filter((material) =>
      request.materialSourceIds.includes(material.id)
    );
    const chunkCount = selectedMaterials.reduce(
      (total, material) => total + Math.max(1, material.chunkCount || 24),
      0
    );
    const qaPairCount = selectedMaterials.length * request.qaPairsPerSource;
    const run: AssemblyLineRun = {
      id: `asm-${Date.now()}`,
      workshopId: _workshopId,
      materialSourceIds: request.materialSourceIds,
      status: "completed",
      progress: 100,
      chunkSizeTokens: request.chunkSizeTokens,
      chunkOverlapTokens: request.chunkOverlapTokens,
      qaPairsPerSource: request.qaPairsPerSource,
      chunkCount,
      qaPairCount,
    };
    mockMaterialSources.forEach((material) => {
      if (request.materialSourceIds.includes(material.id)) {
        material.status = "qa-ready";
        material.chunkCount =
          material.chunkCount || Math.max(1, Math.round(chunkCount / Math.max(1, selectedMaterials.length)));
        material.qaPairCount = material.qaPairCount || request.qaPairsPerSource;
      }
    });
    selectedMaterials.forEach((material, materialIndex) => {
      const chunk: MaterialChunk = {
        id: `chk-${run.id}-${materialIndex}`,
        workshopId: _workshopId,
        materialId: material.id,
        assemblyLineRunId: run.id,
        chunkIndex: 0,
        text: `Mock chunk generated from ${material.name}. This preview shows how source text will be prepared before QA generation.`,
        tokenCount: Math.min(request.chunkSizeTokens, 24),
      };
      const qaPair: QAPair = {
        id: `qa-${run.id}-${materialIndex}`,
        workshopId: _workshopId,
        materialId: material.id,
        chunkId: chunk.id,
        assemblyLineRunId: run.id,
        question: `What does ${material.name} cover?`,
        answer: chunk.text,
        generatorModel: "deterministic-context-generator",
        confidence: 0.68,
        generationMetadata: {
          contractVersion: "foundry.qa-generation.v1",
          mode: "mock",
          strategy: "context-sentence",
        },
        qualityGate: {
          status: "blocked",
          reasons: ["row was produced by the deterministic smoke generator"],
          confidenceThreshold: 0.6,
          metrics: {
            score: 0.68,
            confidence: 0.68,
            sourceOverlap: 0.75,
            answerLength: chunk.text.split(/\s+/).length,
            questionFormed: true,
            fallback: false,
          },
        },
        reviewStatus: "draft",
        reviewedAt: null,
      };
      mockMaterialChunks.unshift(chunk);
      mockQAPairs.unshift(qaPair);
    });
    mockAssemblyLineRuns.unshift(run);
    return run;
  },
  listMaterialChunks: async (_workshopId, runId) =>
    mockMaterialChunks.filter(
      (chunk) => chunk.workshopId === _workshopId && (!runId || chunk.assemblyLineRunId === runId)
    ),
  listQAPairs: async (_workshopId, runId) =>
    mockQAPairs.filter(
      (qaPair) => qaPair.workshopId === _workshopId && (!runId || qaPair.assemblyLineRunId === runId)
    ),
  updateQAPairReview: async (_workshopId, qaPairId, request) => {
    const qaPair = mockQAPairs.find(
      (item) => item.workshopId === _workshopId && item.id === qaPairId
    );
    if (!qaPair) {
      throw new Error("QA pair was not found for this Workshop.");
    }
    qaPair.question = request.question;
    qaPair.answer = request.answer;
    qaPair.reviewStatus = request.reviewStatus;
    qaPair.reviewedAt = request.reviewStatus === "draft" ? null : new Date().toISOString();
    return qaPair;
  },
  previewQAPairsExport: async (_workshopId, request) => {
    const qaPairs = mockQAPairs.filter(
      (qaPair) =>
        qaPair.workshopId === _workshopId &&
        qaPair.assemblyLineRunId === request.assemblyLineRunId &&
        (request.includeDrafts ||
          qaPair.reviewStatus === "accepted" ||
          qaPair.reviewStatus === "edited")
    );
    if (qaPairs.length === 0) {
      throw new Error("This Assembly Line run has no accepted QA pairs to preview.");
    }
    const blockedRows = qaPairs.filter((qaPair) => qaPair.qualityGate?.status === "blocked");
    const sampleRows = qaPairs.slice(0, 5).map((qaPair, index) => ({
      id: qaPair.id,
      instruction: qaPair.question,
      input: "",
      output: qaPair.answer,
      question: qaPair.question,
      answer: qaPair.answer,
      source: {
        workshopId: qaPair.workshopId,
        assemblyLineRunId: qaPair.assemblyLineRunId,
        materialId: qaPair.materialId,
        chunkId: qaPair.chunkId,
      },
      metadata: {
        format: "foundry.qa.v1",
        rowIndex: index,
        generatorModel: qaPair.generatorModel,
        confidence: qaPair.confidence,
        generation: qaPair.generationMetadata || {},
        reviewStatus: qaPair.reviewStatus,
        reviewedAt: qaPair.reviewedAt,
        draftOverride: Boolean(request.includeDrafts),
        lowQualityOverride: Boolean(request.includeLowQuality),
        qualityGate: qaPair.qualityGate,
      },
    }));
    const warnings: string[] = [];
    const errors: string[] = [];
    if (blockedRows.length > 0 && !request.includeLowQuality) {
      errors.push(`${blockedRows.length} row(s) are blocked by the QA quality gate.`);
    } else if (blockedRows.length > 0) {
      warnings.push(`${blockedRows.length} quality-blocked row(s) are included by override.`);
    }
    const status = errors.length ? "blocked" : warnings.length ? "caution" : "ready";
    return {
      contractVersion: "foundry.qa-jsonl.preview.v1",
      assemblyLineRunId: request.assemblyLineRunId,
      format: "jsonl",
      rowCount: qaPairs.length,
      sampleRows,
      sampleLimit: 5,
      jsonlPreview: sampleRows.map((row) => JSON.stringify(row)),
      validation: {
        status,
        forgeReady: errors.length === 0,
        checks: [
          {
            id: "schema-fields",
            label: "Required JSONL fields",
            status: "pass",
            detail: "instruction, output, source, and metadata are present.",
          },
          {
            id: "quality-gate",
            label: "QA quality gate",
            status: errors.length ? "fail" : warnings.length ? "warn" : "pass",
            detail:
              blockedRows.length > 0
                ? "Quality-blocked rows are present; override is required before export."
                : "All included rows passed the QA quality gate.",
          },
        ],
        warnings,
        errors,
        rowCount: qaPairs.length,
        duplicateInstructionCount: 0,
      },
      qualityGate: {
        status: blockedRows.length > 0 && request.includeLowQuality ? "override" : status,
        checkedRows: qaPairs.length,
        blockedRows: blockedRows.length,
        confidenceThreshold: 0.6,
        override: Boolean(request.includeLowQuality),
      },
      options: {
        includeDrafts: Boolean(request.includeDrafts),
        includeLowQuality: Boolean(request.includeLowQuality),
      },
    };
  },
  exportQAPairs: async (_workshopId, request) => {
    const qaPairs = mockQAPairs.filter(
      (qaPair) =>
        qaPair.workshopId === _workshopId &&
        qaPair.assemblyLineRunId === request.assemblyLineRunId &&
        (request.includeDrafts ||
          qaPair.reviewStatus === "accepted" ||
          qaPair.reviewStatus === "edited")
    );
    if (qaPairs.length === 0) {
      throw new Error("This Assembly Line run has no accepted QA pairs to export.");
    }
    const blockedRows = qaPairs.filter((qaPair) => qaPair.qualityGate?.status === "blocked");
    if (blockedRows.length > 0 && !request.includeLowQuality) {
      throw new Error(
        `QA quality gate blocked export for ${blockedRows.length} row(s). Review rows or enable the low-quality override.`
      );
    }
    const sourceUri = `runtime/materials/exports/${_workshopId}/${request.assemblyLineRunId}.jsonl`;
    const qualityGate = {
      status: blockedRows.length > 0 ? "override" : "passed",
      checkedRows: qaPairs.length,
      blockedRows: blockedRows.length,
      confidenceThreshold: 0.6,
      override: Boolean(request.includeLowQuality),
    };
    const trainingReadiness = {
      contractVersion: "foundry.qa-training-readiness.v1" as const,
      status: blockedRows.length > 0 ? "caution" : "ready",
      forgeReady: true,
      defaultTrainingSafe: blockedRows.length === 0 && !request.includeLowQuality,
      rowCount: qaPairs.length,
      reviewedRows: qaPairs.filter(
        (qaPair) => qaPair.reviewStatus === "accepted" || qaPair.reviewStatus === "edited"
      ).length,
      sourceReferencedRows: qaPairs.length,
      qualityPassedRows: qaPairs.length - blockedRows.length,
      qualityBlockedRows: blockedRows.length,
      deterministicRows: 0,
      fallbackRows: 0,
      generatorModels: Array.from(
        new Set(qaPairs.map((qaPair) => qaPair.generatorModel || "mock-generator"))
      ),
      generatorModes: ["mock"],
      promptVersions: ["mock"],
      checks: [
        {
          id: "qa-quality",
          label: "QA quality",
          status: blockedRows.length > 0 ? "warn" : "pass",
          detail:
            blockedRows.length > 0
              ? "Quality-blocked rows are included by override; review before real training."
              : "Every row passed the QA quality gate.",
        },
      ],
      recommendation:
        blockedRows.length > 0
          ? "Quality override is enabled; proceed only for tiny proofs or after human review."
          : "Ready for default Forge training with reviewed, grounded, model-backed QA rows.",
    };
    const material: MaterialSource = {
      id:
        mockMaterialSources.find(
          (source) => source.kind === "jsonl" && source.sourceUri === sourceUri
        )?.id || `mat-export-${Date.now()}`,
      name: request.name || "Training QA Dataset",
      kind: "jsonl",
      status: "qa-ready",
      sourceUri,
      metadata: {
        export: {
          contractVersion: "foundry.material.qa-export.v1",
          assemblyLineRunId: request.assemblyLineRunId,
          format: "jsonl",
          rowCount: qaPairs.length,
          qualityGate,
          trainingReadiness,
          options: {
            includeDrafts: Boolean(request.includeDrafts),
            includeLowQuality: Boolean(request.includeLowQuality),
          },
        },
      },
      chunkCount: qaPairs.length,
      qaPairCount: qaPairs.length,
    };
    const existingMaterialIndex = mockMaterialSources.findIndex(
      (source) => source.kind === "jsonl" && source.sourceUri === sourceUri
    );
    if (existingMaterialIndex >= 0) {
      mockMaterialSources.splice(existingMaterialIndex, 1, material);
    } else {
      mockMaterialSources.unshift(material);
    }
    return {
      material,
      exportUri: material.sourceUri,
      format: "jsonl",
      qaPairCount: qaPairs.length,
      assemblyLineRunId: request.assemblyLineRunId,
      qualityGate,
      trainingReadiness,
    };
  },
  listForgeRuns: async (_workshopId) =>
    mockForgeRuns.filter((forgeRun) => forgeRun.workshopId === _workshopId),
  startForge: async (_workshopId, request) => {
    const material = mockMaterialSources.find(
      (source) => source.id === request.materialSetId && source.kind === "jsonl"
    );
    if (!material) {
      throw new Error("Select an exported JSONL Material before starting the Forge.");
    }
    const forgeRun: ForgeRun = {
      id: `frg-${Date.now()}`,
      workshopId: _workshopId,
      materialSetId: request.materialSetId,
      baseModel: request.baseModel,
      purpose: request.purpose,
      label: `${request.method} ${request.purpose === "evaluation" ? "Evaluation" : "Training"}`,
      method: request.method,
      status: "queued",
      progress: 0,
      learningRate: request.learningRate,
      loadIn4Bit: request.loadIn4Bit,
      epoch: {
        current: 0,
        total: request.epochs,
      },
      trainingContract: {
        contractVersion: "foundry.forge.training.v1",
        forgeRunId: `pending-${Date.now()}`,
        workshopId: _workshopId,
        purpose: request.purpose,
        materialId: request.materialSetId,
        datasetUri: material.sourceUri,
        baseModel: request.baseModel,
        method: request.method,
        epochs: request.epochs,
        learningRate: request.learningRate,
        loadIn4Bit: request.loadIn4Bit,
        outputDir:
          request.purpose === "evaluation"
            ? "runtime/evaluations/pending/mock"
            : "runtime/artifacts/pending/mock",
        runtime: mockForgeRuntime,
      },
    };
    forgeRun.trainingContract!.forgeRunId = forgeRun.id;
    forgeRun.trainingContract!.outputDir =
      request.purpose === "evaluation"
        ? `runtime/evaluations/pending/${forgeRun.id}`
        : `runtime/artifacts/pending/${forgeRun.id}`;
    mockForgeWorkerStates[forgeRun.id] = {
      events: [
        {
          id: `evt-${Date.now()}`,
          forgeRunId: forgeRun.id,
          type: "queued",
          message: "Forge contract accepted and written to mock runtime storage.",
          timestamp: new Date().toISOString(),
          progress: 0,
        },
        {
          id: `evt-${Date.now()}-validated`,
          forgeRunId: forgeRun.id,
          type: "dataset_validated",
          message: `Dataset validated with ${material.qaPairCount} ${request.purpose} rows.`,
          timestamp: new Date().toISOString(),
          progress: 6,
          data: { rowCount: material.qaPairCount },
        },
      ],
      metrics: {
        forgeRunId: forgeRun.id,
        status: "queued",
        progress: 0,
        datasetRows: material.qaPairCount,
        lastEvent: "dataset_validated",
      },
    };
    forgeRun.workerState = mockForgeWorkerStates[forgeRun.id];
    mockForgeRuns.unshift(forgeRun);
    return forgeRun;
  },
  advanceForgeSimulation: async (forgeRunId) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    if (!forgeRun) {
      throw new Error("Forge job was not found.");
    }
    if (forgeRun.status === "completed" || forgeRun.status === "failed") {
      return forgeRun;
    }

    const epochTotal = forgeRun.epoch?.total ?? 1;
    const nextProgress =
      forgeRun.status === "queued"
        ? Math.max(12, forgeRun.progress)
        : Math.min(100, forgeRun.progress + Math.max(10, Math.round(100 / Math.max(3, epochTotal * 2))));
    forgeRun.status = nextProgress >= 100 ? "completed" : "running";
    forgeRun.progress = nextProgress;
    forgeRun.epoch = {
      current: nextProgress >= 100 ? epochTotal : Math.floor((nextProgress / 100) * epochTotal),
      total: epochTotal,
    };
    const workerState = mockForgeWorkerStates[forgeRun.id] || {
      events: [],
      metrics: {
        forgeRunId: forgeRun.id,
        status: forgeRun.status,
        progress: forgeRun.progress,
        datasetRows: 0,
        lastEvent: null,
      },
    };
    if (forgeRun.status === "completed" && forgeRun.purpose === "evaluation") {
      const material = mockMaterialSources.find((source) => source.id === forgeRun.materialSetId);
      workerState.metrics.evaluationReport = buildMockEvaluationReport(
        forgeRun,
        material,
        workerState.metrics.datasetRows || material?.qaPairCount || 1
      );
      workerState.events.push({
        id: `evt-${Date.now()}-${workerState.events.length}`,
        forgeRunId: forgeRun.id,
        type: "evaluation_completed",
        message: "Forge evaluation completed. Review metrics before promoting an Artifact.",
        timestamp: new Date().toISOString(),
        progress: 100,
        epoch: forgeRun.epoch,
        data: {
          passRate: workerState.metrics.evaluationReport.passRate,
          materialId: forgeRun.materialSetId,
        },
      });
    }
    if (forgeRun.status === "completed" && forgeRun.purpose !== "evaluation") {
      workerState.events.push({
        id: `evt-${Date.now()}-${workerState.events.length}`,
        forgeRunId: forgeRun.id,
        type: "artifact_planned",
        message: "Simulator planned the Artifact output directory.",
        timestamp: new Date().toISOString(),
        progress: 98,
        epoch: forgeRun.epoch,
        data: { outputDir: forgeRun.trainingContract?.outputDir },
      });
    }
    workerState.events.push({
      id: `evt-${Date.now()}-${workerState.events.length}`,
      forgeRunId: forgeRun.id,
      type: forgeRun.status === "completed" ? "completed" : "step_completed",
      message:
        forgeRun.status === "completed" && forgeRun.purpose === "evaluation"
          ? "Forge evaluation simulation completed."
          : forgeRun.status === "completed"
          ? "Forge simulation completed and Artifact metadata is ready."
          : `Simulator advanced Forge progress to ${forgeRun.progress}%.`,
      timestamp: new Date().toISOString(),
      progress: forgeRun.progress,
      epoch: forgeRun.epoch,
    });
    workerState.metrics = {
      ...workerState.metrics,
      status: forgeRun.status,
      progress: forgeRun.progress,
      epoch: forgeRun.epoch,
      lastEvent: workerState.events[workerState.events.length - 1].type,
    };
    if (forgeRun.status === "completed" && forgeRun.purpose === "evaluation") {
      const material = mockMaterialSources.find((source) => source.id === forgeRun.materialSetId);
      workerState.metrics.evaluationReport = buildMockEvaluationReport(
        forgeRun,
        material,
        workerState.metrics.datasetRows || material?.qaPairCount || 1
      );
    }
    mockForgeWorkerStates[forgeRun.id] = workerState;
    forgeRun.workerState = workerState;
    if (forgeRun.status === "completed" && forgeRun.purpose !== "evaluation" && !forgeRun.artifactId) {
      forgeRun.artifactId = `art-${forgeRun.id.replace(/^frg-/, "")}`;
      const adapterPath = `runtime/artifacts/${forgeRun.artifactId}/adapter`;
      const artifact: Artifact = {
        id: forgeRun.artifactId,
        workshopId: forgeRun.workshopId,
        forgeRunId: forgeRun.id,
        name: `${forgeRun.method} Artifact`,
        version: `v0.${mockArtifacts.length + 1}.0`,
        baseModel: forgeRun.baseModel || "unknown",
        adapterPath,
        status: "ready",
        trainingMethod: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        trialScore: 0,
        readiness: mockArtifactReadiness("metadata-only", adapterPath, forgeRun.baseModel || "unknown"),
      };
      mockArtifacts.unshift(artifact);
      mockDashboardSummary.currentArtifact = artifact;
      mockDashboardSummary.workshop.activeArtifactId = artifact.id;
      mockDashboardSummary.workshop.status = "ready";
    }
    return forgeRun;
  },
  getForgeContract: async (forgeRunId) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    if (!forgeRun?.trainingContract) {
      throw new Error("Forge contract has not been written yet.");
    }
    return forgeRun.trainingContract;
  },
  getForgeWorkerState: async (forgeRunId) =>
    mockForgeWorkerStates[forgeRunId] || {
      events: [],
      metrics: {
        forgeRunId,
        status: "unknown",
        progress: 0,
        datasetRows: 0,
        lastEvent: null,
      },
    },
  reconcileForgeWorkerState: async (forgeRunId) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    if (!forgeRun) {
      throw new Error("Forge job was not found.");
    }
    if (!forgeRun.trainingContract) {
      const material = mockMaterialSources.find((source) => source.id === forgeRun.materialSetId);
      if (!material) {
        throw new Error("Forge has no training Material to reconcile.");
      }
      forgeRun.trainingContract = {
        contractVersion: "foundry.forge.training.v1",
        forgeRunId: forgeRun.id,
        workshopId: forgeRun.workshopId,
        purpose: forgeRun.purpose || "training",
        materialId: material.id,
        datasetUri: material.sourceUri,
        baseModel: forgeRun.baseModel || "unknown",
        method: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        epochs: forgeRun.epoch?.total || 1,
        learningRate: forgeRun.learningRate || "0.0002",
        loadIn4Bit: Boolean(forgeRun.loadIn4Bit),
        outputDir:
          forgeRun.purpose === "evaluation"
            ? `runtime/evaluations/pending/${forgeRun.id}`
            : `runtime/artifacts/pending/${forgeRun.id}`,
        runtime: mockForgeRuntime,
      };
    }
    const workerState = mockForgeWorkerStates[forgeRun.id] || {
      events: [
        {
          id: `evt-${Date.now()}`,
          forgeRunId: forgeRun.id,
          type: "queued",
          message: "Forge contract reconciled into mock runtime storage.",
          timestamp: new Date().toISOString(),
          progress: 0,
        },
      ],
      metrics: {
        forgeRunId: forgeRun.id,
        status: forgeRun.status,
        progress: forgeRun.progress,
        datasetRows: 0,
        lastEvent: "queued",
        epoch: forgeRun.epoch,
      },
    };
    mockForgeWorkerStates[forgeRun.id] = workerState;
    forgeRun.workerState = workerState;
    if (forgeRun.status === "completed" && forgeRun.purpose === "evaluation") {
      const material = mockMaterialSources.find((source) => source.id === forgeRun.materialSetId);
      workerState.metrics.evaluationReport = buildMockEvaluationReport(
        forgeRun,
        material,
        workerState.metrics.datasetRows || material?.qaPairCount || 1
      );
    }
    if (forgeRun.status === "completed" && forgeRun.purpose !== "evaluation" && !forgeRun.artifactId) {
      forgeRun.artifactId = `art-${forgeRun.id.replace(/^frg-/, "")}`;
      const adapterPath = `runtime/artifacts/${forgeRun.artifactId}/adapter`;
      const artifact: Artifact = {
        id: forgeRun.artifactId,
        workshopId: forgeRun.workshopId,
        forgeRunId: forgeRun.id,
        name: `${forgeRun.method} Artifact`,
        version: `v0.${mockArtifacts.length + 1}.0`,
        baseModel: forgeRun.baseModel || "unknown",
        adapterPath,
        status: "ready",
        trainingMethod: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        trialScore: 0,
        readiness: mockArtifactReadiness("metadata-only", adapterPath, forgeRun.baseModel || "unknown"),
      };
      mockArtifacts.unshift(artifact);
      mockDashboardSummary.currentArtifact = artifact;
      mockDashboardSummary.workshop.activeArtifactId = artifact.id;
      mockDashboardSummary.workshop.status = "ready";
    }
    return {
      contract: forgeRun.trainingContract,
      forgeRun,
      events: workerState.events,
      metrics: workerState.metrics,
      validation: { valid: true, message: "Mock worker state reconciled." },
    };
  },
  preflightLocalForgeWorker: async (forgeRunId) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    if (!forgeRun) {
      throw new Error("Forge job was not found.");
    }
    if (!forgeRun.trainingContract) {
      await mockFoundryRepository.reconcileForgeWorkerState(forgeRunId);
    }
    if (!forgeRun.trainingContract) {
      throw new Error("Forge contract has not been written yet.");
    }
    const material = mockMaterialSources.find((source) => source.id === forgeRun.materialSetId);
    const archiveEntry = mockModelArchiveEntries.find(
      (entry) => entry.repoId === forgeRun.trainingContract?.baseModel && entry.status !== "remote"
    );
    const estimatedLoadBytes = Math.max(
      512 * 1024 * 1024,
      Math.round((archiveEntry?.sizeOnDiskBytes || 0) * 2.2)
    );
    const availableBytes = 16 * 1024 * 1024 * 1024;
    const checks: ForgeLocalTrainerPreflightResult["checks"] = [
      {
        id: "runtime-mode",
        label: "Local runtime",
        status: mockForgeRuntime.mode === "local" ? "pass" : "fail",
        detail:
          mockForgeRuntime.mode === "local"
            ? mockForgeRuntime.detail
            : "Configure Forge runtime to local before running the trainer.",
      },
      {
        id: "dependencies",
        label: "Trainer dependencies",
        status: mockForgeRuntime.ready ? "pass" : "fail",
        detail: mockForgeRuntime.detail,
      },
      {
        id: "forge-purpose",
        label: "Training Forge",
        status: forgeRun.purpose === "training" ? "pass" : "fail",
        detail: "Local trainer runs training Forges; evaluation Forges produce Trial Reports.",
      },
      {
        id: "training-method",
        label: "LoRA settings",
        status: forgeRun.method === "LoRA" && !forgeRun.loadIn4Bit ? "pass" : "fail",
        detail: "MVP local trainer supports LoRA with 4-bit loading disabled.",
      },
      {
        id: "dataset",
        label: "JSONL Material",
        status: material && material.qaPairCount > 0 ? "pass" : "fail",
        detail: material
          ? `Dataset validated with ${material.qaPairCount} training rows.`
          : "Training Material was not found.",
      },
      {
        id: "dataset-size",
        label: "Tiny proof size",
        status: material && material.qaPairCount <= 8 ? "pass" : "warn",
        detail: `${material?.qaPairCount || 0} usable rows. The local proof run will train on the first 8 rows.`,
      },
      {
        id: "model-cache",
        label: "Cached base model",
        status: archiveEntry ? "pass" : "fail",
        detail: archiveEntry
          ? "Base model is cached in the Archive."
          : "Base model is not cached. Download it into the Archive first.",
      },
      {
        id: "memory-fit",
        label: "Memory estimate",
        status: estimatedLoadBytes <= availableBytes * 0.75 ? "pass" : "warn",
        detail: "Estimated local training memory fits the conservative mock budget.",
      },
    ];
    const warnings = checks.filter((check) => check.status === "warn").map((check) => check.detail);
    const ok = checks.every((check) => check.status !== "fail");
    const status = ok && warnings.length === 0 ? "ready" : ok ? "caution" : "blocked";
    return {
      ok,
      status,
      title: ok ? "Local trainer ready" : "Local trainer blocked",
      summary: ok
        ? "This Forge can run the tiny local LoRA trainer."
        : "Resolve failed checks before running the local trainer.",
      nextAction: ok ? "Run Local Trainer" : "Fix the blocked checks, then preflight again.",
      contract: forgeRun.trainingContract,
      validation: {
        valid: Boolean(material && material.qaPairCount > 0),
        rowCount: material?.qaPairCount || 0,
        message: material ? "Dataset is training-contract ready." : "Training Material was not found.",
      },
      runtime: mockForgeRuntime,
      model: {
        baseModel: forgeRun.trainingContract.baseModel,
        path: archiveEntry?.localPath || null,
        cached: Boolean(archiveEntry),
        remoteAllowed: false,
        sizeOnDiskBytes: archiveEntry?.sizeOnDiskBytes || 0,
        message: archiveEntry
          ? "Base model is cached in the Archive."
          : "Base model is not cached. Download it into the Archive first.",
      },
      memory: {
        fitStatus: estimatedLoadBytes <= availableBytes * 0.75 ? "fits" : "tight",
        checkStatus: estimatedLoadBytes <= availableBytes * 0.75 ? "pass" : "warn",
        estimatedLoadBytes,
        availableBytes,
        message: "Estimated local training memory fits the conservative mock budget.",
      },
      checks,
      warnings,
      limits: {
        maxRows: 8,
        maxLength: 256,
      },
      createdAt: new Date().toISOString(),
    };
  },
  runLocalForgeWorker: async (forgeRunId) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    if (!forgeRun) {
      throw new Error("Forge job was not found.");
    }
    if (forgeRun.purpose !== "training") {
      throw new Error("Local trainer only supports training Forges.");
    }
    if (!forgeRun.trainingContract) {
      await mockFoundryRepository.reconcileForgeWorkerState(forgeRunId);
    }
    if (!forgeRun.trainingContract) {
      throw new Error("Forge contract has not been written yet.");
    }

    const workerState = mockForgeWorkerStates[forgeRun.id] || {
      events: [],
      metrics: {
        forgeRunId: forgeRun.id,
        status: forgeRun.status,
        progress: forgeRun.progress,
        datasetRows: 0,
        lastEvent: null,
      },
    };
    forgeRun.status = "completed";
    forgeRun.progress = 100;
    forgeRun.epoch = {
      current: forgeRun.epoch?.total || 1,
      total: forgeRun.epoch?.total || 1,
    };
    workerState.events.push(
      {
        id: `evt-${Date.now()}-local-start`,
        forgeRunId: forgeRun.id,
        type: "local_training_started",
        message: "Mock local trainer started from the durable Forge contract.",
        timestamp: new Date().toISOString(),
        progress: 10,
      },
      {
        id: `evt-${Date.now()}-local-adapter`,
        forgeRunId: forgeRun.id,
        type: "adapter_saved",
        message: "Mock local LoRA adapter was saved to the contract output directory.",
        timestamp: new Date().toISOString(),
        progress: 96,
      },
      {
        id: `evt-${Date.now()}-local-complete`,
        forgeRunId: forgeRun.id,
        type: "local_training_completed",
        message: "Mock local LoRA training completed and Artifact metadata can be created.",
        timestamp: new Date().toISOString(),
        progress: 100,
        epoch: forgeRun.epoch,
      }
    );
    workerState.metrics = {
      ...workerState.metrics,
      status: "completed",
      progress: 100,
      epoch: forgeRun.epoch,
      lastEvent: "local_training_completed",
    };
    mockForgeWorkerStates[forgeRun.id] = workerState;
    forgeRun.workerState = workerState;
    if (!forgeRun.artifactId) {
      forgeRun.artifactId = `art-${forgeRun.id.replace(/^frg-/, "")}`;
      const adapterPath = forgeRun.trainingContract.outputDir;
      const artifact: Artifact = {
        id: forgeRun.artifactId,
        workshopId: forgeRun.workshopId,
        forgeRunId: forgeRun.id,
        name: `${forgeRun.method} Artifact`,
        version: `v0.${mockArtifacts.length + 1}.0`,
        baseModel: forgeRun.baseModel || "unknown",
        adapterPath,
        status: "ready",
        trainingMethod: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        trialScore: 0,
        readiness: mockArtifactReadiness("lora-adapter", adapterPath, forgeRun.baseModel || "unknown"),
      };
      mockArtifacts.unshift(artifact);
      mockDashboardSummary.currentArtifact = artifact;
      mockDashboardSummary.workshop.activeArtifactId = artifact.id;
      mockDashboardSummary.workshop.status = "ready";
    }

    return {
      contract: forgeRun.trainingContract,
      forgeRun,
      events: workerState.events,
      metrics: workerState.metrics,
      validation: { valid: true, message: "Mock local trainer completed." },
    };
  },
  runForgeSmokeProof: async (request) => {
    await mockFoundryRepository.configureForgeRuntime({
      mode: "local",
      worker: "local-process",
    });
    const smokeMaterial: MaterialSource = {
      id: `mat-smoke-${Date.now()}`,
      name: "Local Forge Smoke JSONL",
      kind: "jsonl",
      status: "qa-ready",
      sourceUri: "runtime/materials/exports/smoke/local-forge-smoke.jsonl",
      chunkCount: 1,
      qaPairCount: 1,
    };
    mockMaterialSources.unshift(smokeMaterial);
    const forgeRun = await mockFoundryRepository.startForge(mockDashboardSummary.workshop.id, {
      materialSetId: smokeMaterial.id,
      baseModel: "sshleifer/tiny-gpt2",
      method: "LoRA",
      purpose: "training",
      epochs: 1,
      learningRate: "0.0002",
      loadIn4Bit: false,
    });
    const preflight = await mockFoundryRepository.preflightLocalForgeWorker(forgeRun.id);
    let latestForgeRun = forgeRun;
    let workerState = forgeRun.workerState || mockForgeWorkerStates[forgeRun.id];
    let artifact: Artifact | null = null;
    if (request.runTraining && preflight.ok) {
      const trained = await mockFoundryRepository.runLocalForgeWorker(forgeRun.id);
      latestForgeRun = trained.forgeRun || forgeRun;
      workerState = {
        events: trained.events,
        metrics: trained.metrics,
      };
      artifact =
        mockArtifacts.find((entry) => entry.id === latestForgeRun.artifactId) || null;
    }
    return {
      workshop: mockDashboardSummary.workshop,
      material: smokeMaterial,
      forgeRun: latestForgeRun,
      contract: preflight.contract,
      workerState,
      preflight,
      ranTraining: Boolean(request.runTraining && preflight.ok),
      artifact,
      blocked: preflight.ok
        ? []
        : preflight.checks
            .filter((check) => check.status === "fail")
            .map((check) => ({
              id: check.id,
              label: check.label,
              detail: check.detail,
            })),
    };
  },
  getForgeRuntime: async () => mockForgeRuntime,
  configureForgeRuntime: async (request) => {
    mockForgeRuntime = {
      mode: request.mode,
      status: "ready",
      detail:
        request.mode === "simulated"
          ? "Mock Forge runtime uses deterministic progress simulation."
          : "Mock local trainer adapter can complete a no-download demo run.",
      worker: request.worker || (request.mode === "simulated" ? "in-process-simulator" : "local-process"),
      ready: true,
      supportsMethods: request.mode === "simulated" ? ["LoRA", "QLoRA"] : ["LoRA"],
    };
    return mockForgeRuntime;
  },
  listArtifacts: async (_workshopId) =>
    mockArtifacts.filter((artifact) => artifact.workshopId === _workshopId),
  listTrials: async (_workshopId) =>
    mockTrials.filter((trial) => trial.workshopId === _workshopId),
  createTrial: async (_workshopId, request) => {
    const artifact = mockArtifacts.find((item) => item.id === request.artifactId);
    const generationSettings = {
      contextWindow: Number(request.generationSettings.contextWindow || mockConstruct.contextWindow),
      maxNewTokens: Number(request.generationSettings.maxNewTokens || mockConstruct.maxNewTokens),
      temperature: Number(request.generationSettings.temperature || mockConstruct.temperature),
      includeLibraryContext: Boolean(request.generationSettings.includeLibraryContext),
      ...request.generationSettings,
    };
    if (!artifact) {
      throw new Error("Artifact was not found for this Workshop.");
    }
    return upsertMockTrialForMessage(_workshopId, {
      artifact,
      constructId: request.constructId,
      messageId: request.messageId,
      prompt: request.prompt,
      response: request.response,
      verdict: request.verdict,
      runtimeMode: request.runtimeMode,
      tokenCount: request.tokenCount,
      generationSettings,
    });
  },
  exportTrials: async (_workshopId, request) => {
    const selectedTrials = mockTrials.filter((trial) => {
      const isSelected = request.trialIds.includes(trial.id);
      const matchesVerdict = request.verdicts?.length
        ? trial.verdict !== "needs-review" && request.verdicts.includes(trial.verdict)
        : true;
      return trial.workshopId === _workshopId && isSelected && matchesVerdict;
    });
    if (selectedTrials.length === 0) {
      throw new Error("No Trials matched this export selection.");
    }
    if (selectedTrials.some((trial) => trial.verdict === "needs-review")) {
      throw new Error("Review auto-captured Trials before exporting them to JSONL.");
    }
    const material: MaterialSource = {
      id: `mat-trials-${Date.now()}`,
      name: request.name || "Trial Review Dataset",
      kind: "jsonl",
      status: "qa-ready",
      sourceUri: `runtime/materials/exports/${_workshopId}/trial-review-${Date.now()}.jsonl`,
      chunkCount: selectedTrials.length,
      qaPairCount: selectedTrials.length,
    };
    mockMaterialSources.unshift(material);
    return {
      material,
      exportUri: material.sourceUri,
      format: "jsonl",
      trialCount: selectedTrials.length,
      verdicts: Array.from(new Set(selectedTrials.map((trial) => trial.verdict))).sort(),
    };
  },
  exportEvaluationWeakSamples: async (forgeRunId, request) => {
    const forgeRun = mockForgeRuns.find((run) => run.id === forgeRunId);
    const report = forgeRun?.workerState?.metrics.evaluationReport;
    if (!forgeRun || !report) {
      throw new Error("Forge evaluation report is not ready yet.");
    }
    const weakSamples =
      request.samples?.length
        ? request.samples
        : report.samples.filter((sample) => sample.verdict !== "pass");
    if (weakSamples.length === 0) {
      throw new Error("This Trial Report has no weak samples to export.");
    }
    const material: MaterialSource = {
      id: `mat-weak-${Date.now()}`,
      name: request.name || "Weak Trial Samples",
      kind: "jsonl",
      status: "qa-ready",
      sourceUri: `runtime/materials/exports/${forgeRun.workshopId}/weak-samples-${Date.now()}.jsonl`,
      chunkCount: weakSamples.length,
      qaPairCount: weakSamples.length,
    };
    mockMaterialSources.unshift(material);
    return {
      material,
      exportUri: material.sourceUri,
      format: "jsonl",
      sampleCount: weakSamples.length,
      verdicts: Array.from(new Set(weakSamples.map((sample) => sample.verdict))).sort(),
      forgeRunId,
    };
  },
  loadArtifactIntoConstruct: async (_workshopId, request) => {
    const artifact = mockArtifacts.find(
      (item) => item.id === request.artifactId && item.workshopId === _workshopId
    );
    if (!artifact) {
      throw new Error("Artifact was not found for this Workshop.");
    }
    mockConstruct = {
      ...mockConstruct,
      artifactId: artifact.id,
      name: `${artifact.name} Construct`,
      status: "warming",
    };
    mockDashboardSummary.construct = mockConstruct;
    mockDashboardSummary.currentArtifact = artifact;
    mockDashboardSummary.workshop.activeArtifactId = artifact.id;
    mockDashboardSummary.workshop.activeConstructId = mockConstruct.id;
    return mockConstruct;
  },
  listConstructs: async (_workshopId) =>
    mockConstruct.workshopId === _workshopId ? [mockConstruct] : [],
  chatWithConstruct: async (constructId, request) => {
    if (constructId !== mockConstruct.id) {
      throw new Error("Construct was not found.");
    }
    const artifact = mockDashboardSummary.currentArtifact;
    const messageId = `msg-${Date.now()}`;
    const responseText = `Simulated response from ${mockConstruct.name} using ${artifact.name} ${artifact.version}. You asked: "${request.message}". Generation settings are max_new_tokens=${request.maxNewTokens ?? mockConstruct.maxNewTokens}, temperature=${request.temperature ?? mockConstruct.temperature}, context_window=${mockConstruct.contextWindow}.`;
    const generation = {
      contextWindow: mockConstruct.contextWindow,
      maxNewTokens: request.maxNewTokens ?? mockConstruct.maxNewTokens,
      temperature: request.temperature ?? mockConstruct.temperature,
      includeLibraryContext: request.includeLibraryContext,
    };
    const trial = upsertMockTrialForMessage(artifact.workshopId, {
      artifact,
      constructId,
      messageId,
      prompt: request.message,
      response: responseText,
      verdict: "needs-review",
      runtimeMode: mockConstructRuntime.mode,
      tokenCount: responseText.split(/\s+/).length,
      generationSettings: {
        ...generation,
        runtime: mockConstructRuntime,
      },
    });
    return {
      conversationId: request.conversationId,
      construct: {
        ...mockConstruct,
        status: "streaming",
      },
      artifact,
      message: {
        id: messageId,
        sender: "assistant",
        text: responseText,
        tokenCount: responseText.split(/\s+/).length,
      },
      trial,
      generation,
    };
  },
  streamConstructChat: async (constructId, request, onEvent) => {
    const response = await mockFoundryRepository.chatWithConstruct(constructId, request);
    const tokens = response.message.text.split(" ");
    tokens.forEach((token, index) => {
      onEvent({
        type: "token",
        token: token + (index < tokens.length - 1 ? " " : ""),
        index,
      });
    });
    onEvent({
      type: "done",
      messageId: response.message.id,
      totalTokens: response.message.tokenCount || tokens.length,
      construct: response.construct,
      artifact: response.artifact,
      generation: response.generation,
      trial: response.trial,
      runtime: {
        mode: mockConstructRuntime.mode,
        status: mockConstructRuntime.status,
        detail: mockConstructRuntime.detail,
        modelId: mockConstructRuntime.modelId,
        device: mockConstructRuntime.device,
        loaded: mockConstructRuntime.loaded,
        diagnostics: mockConstructRuntime.diagnostics,
      },
    });
  },
  getConstructRuntime: async () => mockConstructRuntime,
  listConstructRuntimeEvents: async () => mockConstructRuntimeEvents,
  recordConstructRuntimeEvent: async (request) => recordMockConstructRuntimeEvent(request),
  exportConstructRuntimeEvents: async () => ({
    contractVersion: "foundry.construct.runtime-history.v1",
    exportedAt: new Date().toISOString(),
    format: "json",
    eventCount: mockConstructRuntimeEvents.length,
    runtime: mockConstructRuntime,
    events: mockConstructRuntimeEvents,
  }),
  exportConstructDiagnosticsBundle: async (query) =>
    constructDiagnosticsBundleExport(
      await mockFoundryRepository.exportConstructRuntimeEvents(),
      constructRuntimeValidationExport(mockConstructRuntimeValidations, query),
      null,
      mockConstructRuntime
    ),
  clearConstructRuntimeEvents: async () => {
    const deletedCount = mockConstructRuntimeEvents.length;
    mockConstructRuntimeEvents = [];
    return {
      deletedCount,
      clearedAt: new Date().toISOString(),
    };
  },
  listConstructRuntimeValidations: async (query) =>
    constructRuntimeValidationPage(mockConstructRuntimeValidations, query),
  exportConstructRuntimeValidations: async (query) =>
    constructRuntimeValidationExport(mockConstructRuntimeValidations, query),
  createConstructRuntimeValidation: async (request) => {
    const validation: ConstructRuntimeValidation = {
      ...request,
      id: `rtv-${Date.now()}-${mockConstructRuntimeValidations.length}`,
      createdAt: new Date().toISOString(),
    };
    mockConstructRuntimeValidations = [validation, ...mockConstructRuntimeValidations].slice(0, 25);
    return validation;
  },
  configureConstructRuntime: async (request) => {
    mockRuntimeLoadEvent = {
      status: "configured",
      modelId: request.modelId || "active Artifact base model",
      device: request.mode === "simulated" ? "none" : request.device,
      durationSeconds: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      failureReason: null,
    };
    const nextRuntime = {
      mode: request.mode,
      status: request.mode === "simulated" ? "fallback" : "configured",
      detail:
        request.mode === "simulated"
          ? "Mock repository uses deterministic simulated token streaming."
          : "Mock Transformers runtime is configured.",
      modelId: request.modelId || "active Artifact base model",
      device: request.mode === "simulated" ? "none" : request.device,
      loaded: request.mode === "simulated",
    };
    mockConstructRuntime = {
      ...nextRuntime,
      diagnostics: mockRuntimeDiagnostics(nextRuntime),
    };
    recordMockConstructRuntimeEvent({
      type: "configure",
      status: "passed",
      title: "Runtime contract configured",
      detail:
        request.mode === "simulated"
          ? "Mock simulated runtime is ready for deterministic streaming."
          : `Mock transformers runtime is configured for ${request.modelId || "active Artifact base model"}.`,
      modelId: request.modelId,
      runtimeStatus: mockConstructRuntime.status,
      source: "mock",
    });
    return mockConstructRuntime;
  },
  loadConstructRuntime: async (request) => {
    const startedAt = new Date();
    const displayModelId = request.adapterPath
      ? `${request.modelId || mockConstructRuntime.modelId} + adapter:${request.artifactId || "active"}`
      : request.modelId || mockConstructRuntime.modelId;
    const nextRuntime = {
      ...mockConstructRuntime,
      modelId: displayModelId,
      status: "loaded",
      loaded: true,
      device: mockConstructRuntime.device === "auto" ? "mps" : mockConstructRuntime.device,
    };
    mockRuntimeLoadEvent = {
      status: "loaded",
      modelId: nextRuntime.modelId,
      device: nextRuntime.device,
      durationSeconds: 0.18,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + 180).toISOString(),
      failureReason: null,
    };
    mockConstructRuntime = {
      ...nextRuntime,
      diagnostics: {
        ...mockRuntimeDiagnostics(nextRuntime),
        loadedModel: {
          modelId: displayModelId,
          baseModelId: request.modelId || mockConstructRuntime.modelId,
          adapterPath: request.adapterPath,
          artifactId: request.artifactId,
          adapterLoaded: Boolean(request.adapterPath),
          loaded: true,
          device: nextRuntime.device,
          cacheSize: 1,
        },
      },
    };
    recordMockConstructRuntimeEvent({
      type: "load",
      status: "passed",
      title: request.adapterPath ? "Mock runtime loaded model and adapter" : "Mock runtime loaded model",
      detail: request.adapterPath
        ? `${request.modelId || mockConstructRuntime.modelId} loaded with adapter ${request.adapterPath}.`
        : `${nextRuntime.modelId} is loaded on ${nextRuntime.device}.`,
      modelId: nextRuntime.modelId,
      runtimeStatus: mockConstructRuntime.status,
      source: "mock",
      metadata: {
        baseModel: request.modelId,
        adapterPath: request.adapterPath,
        artifactId: request.artifactId,
      },
    });
    return mockConstructRuntime;
  },
  preflightConstructRuntime: async (request) => ({
    ok: true,
    modelId: request.modelId,
    device: request.device === "auto" ? "mps" : request.device,
    localFilesOnly: request.modelId.startsWith("runtime/") || request.modelId.startsWith("/"),
    modelType: "gpt2",
    architectures: ["GPT2LMHeadModel"],
    contextWindow: 1024,
    parameterCountEstimate: 102714,
    estimatedLoadBytes: 513570,
    availableBytes: mockPlatformProfile.availableMemoryBytes,
    fitStatus: "fits",
    checks: [
      {
        id: "config",
        label: "Model config",
        status: "pass",
        detail: "gpt2 config is readable.",
      },
      {
        id: "tokenizer",
        label: "Tokenizer",
        status: "pass",
        detail: "Tokenizer loaded with vocab size 50257.",
      },
      {
        id: "memory",
        label: "Memory fit",
        status: "pass",
        detail: "Estimated load fits with comfortable headroom.",
      },
    ],
    warnings: [],
    diagnostics: mockRuntimeDiagnostics(mockConstructRuntime),
  }),
  probeConstructRuntime: async (request) => ({
    ok: true,
    modelId: request.modelId || SMOKE_QA_GENERATOR_MODEL_ID,
    prompt: request.prompt,
    output: `${request.prompt} a tiny simulated local-model smoke test.`,
    device: request.device === "auto" ? "cpu" : request.device,
    requestedDevice: request.device,
    loadSeconds: 0.01,
    totalSeconds: 0.02,
    maxNewTokens: request.maxNewTokens,
    diagnostics: {
      torchVersion: "mock",
      cudaAvailable: false,
      mpsBuilt: false,
      mpsAvailable: false,
      memory: {
        totalGb: 36,
        availableGb: 24,
        percentUsed: 33,
      },
    },
  }),
  unloadConstructRuntime: async () => {
    const cacheSizeBefore = mockConstructRuntime.loaded ? 1 : 0;
    mockRuntimeLoadEvent = {
      status: "unloaded",
      modelId: mockConstructRuntime.modelId,
      device: mockConstructRuntime.device,
      durationSeconds: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      failureReason: null,
    };
    const nextRuntime = {
      ...mockConstructRuntime,
      status: mockConstructRuntime.mode === "simulated" ? "fallback" : "configured",
      loaded: mockConstructRuntime.mode === "simulated",
    };
    mockConstructRuntime = {
      ...nextRuntime,
      diagnostics: {
        ...mockRuntimeDiagnostics(nextRuntime),
        memoryCleanup: {
          status: "passed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cacheSizeBefore,
          cacheSizeAfter: 0,
          methods: ["python-gc", "mock-runtime-cache"],
        },
      },
    };
    recordMockConstructRuntimeEvent({
      type: "unload",
      status: "passed",
      title: "Mock runtime unloaded",
      detail: "The mock Construct runtime returned to its configured state.",
      modelId: nextRuntime.modelId,
      runtimeStatus: mockConstructRuntime.status,
      source: "mock",
    });
    return mockConstructRuntime;
  },
  releaseConstructRuntimeMemory: async () => {
    const cacheSizeBefore = mockConstructRuntime.loaded ? 1 : 0;
    mockRuntimeLoadEvent = {
      status: "released",
      modelId: mockConstructRuntime.modelId,
      device: mockConstructRuntime.device,
      durationSeconds: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      failureReason: null,
    };
    const nextRuntime = {
      ...mockConstructRuntime,
      status: mockConstructRuntime.mode === "simulated" ? "fallback" : "configured",
      loaded: mockConstructRuntime.mode === "simulated",
    };
    mockConstructRuntime = {
      ...nextRuntime,
      diagnostics: {
        ...mockRuntimeDiagnostics(nextRuntime),
        memoryCleanup: {
          status: "passed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cacheSizeBefore,
          cacheSizeAfter: 0,
          methods: ["python-gc", "mock-runtime-cache"],
        },
      },
    };
    recordMockConstructRuntimeEvent({
      type: "unload",
      status: "passed",
      title: "Mock runtime memory released",
      detail: "The mock Construct runtime cleared cached model references.",
      modelId: nextRuntime.modelId,
      runtimeStatus: mockConstructRuntime.status,
      source: "mock",
    });
    return mockConstructRuntime;
  },
  listModelArchiveEntries: async () => mockModelArchiveEntries,
  testHuggingFaceAuth: async (request) => {
    const username = (request.username || "").trim();
    const tokenPresent = Boolean((request.token || "").trim());
    if (!tokenPresent) {
      return {
        ok: false,
        provider: "huggingface",
        username: username || null,
        resolvedUsername: null,
        tokenPresent: false,
        usernameMatches: false,
        accessLevel: "anonymous",
        message:
          "No Hugging Face token is saved. Public model search can still work, but gated/private models require a username and token.",
      };
    }

    return {
      ok: true,
      provider: "huggingface",
      username: username || "mock-engineer",
      resolvedUsername: username || "mock-engineer",
      tokenPresent,
      usernameMatches: true,
      accessLevel: "mock-authenticated",
      message: `Mock Hugging Face credentials verified for ${username || "mock-engineer"}.`,
    };
  },
  searchArchiveModels: async (request) => {
    const query = (request.query || "").toLowerCase();
    return {
      models: mockArchiveModels
        .filter((model) => (query ? model.repoId.toLowerCase().includes(query) : true))
        .filter((model) => request.includeGated || !model.gated)
        .slice(0, request.limit || 20),
      platform: mockPlatformProfile,
    };
  },
  inspectArchiveModel: async (request) => {
    const archiveEntry = mockModelArchiveEntries.find(
      (entry) => entry.repoId === request.repoId && entry.revision === (request.revision || "")
    );
    const model =
      mockArchiveModels.find((candidate) => candidate.repoId === request.repoId) ||
      mockArchiveModels[0];
    return {
      model: {
        ...model,
        repoId: request.repoId,
        revision: request.revision || "",
        cached: Boolean(archiveEntry),
        archiveEntry: archiveEntry || null,
      },
      platform: mockPlatformProfile,
    };
  },
  preflightArchiveModel: async (request) => {
    const inspection = await mockFoundryRepository.inspectArchiveModel(request);
    const visibility = inspection.model.private
      ? "private"
      : inspection.model.gated
        ? "gated"
        : "public";
    const canDownload =
      inspection.model.fitEstimate.status !== "too-large" &&
      !(visibility !== "public" && !request.token);
    return {
      ok: true,
      canDownload,
      visibility,
      model: inspection.model,
      platform: inspection.platform,
      fitEstimate: inspection.model.fitEstimate,
      estimatedDownloadBytes:
        inspection.model.sizeBytes || inspection.model.fitEstimate.estimatedBytes,
      auth: {
        username: request.username || null,
        tokenPresent: Boolean(request.token),
      },
      message: canDownload
        ? `${inspection.model.repoId} is visible, metadata loaded, and ready to queue for Archive download.`
        : `${inspection.model.repoId} needs Hugging Face access or a smaller runtime fit before download.`,
    };
  },
  registerArchiveModel: async (request) => {
    const inspection = await mockFoundryRepository.inspectArchiveModel(request);
    const existingEntry = mockModelArchiveEntries.find(
      (entry) => entry.repoId === request.repoId && entry.revision === (request.revision || "")
    );
    const archiveEntry: ModelArchiveEntry =
      existingEntry || {
        id: `mdl-${Date.now()}`,
        repoId: request.repoId,
        revision: request.revision || "",
        localPath: "",
        source: "huggingface",
        status: "remote",
        sizeOnDiskBytes: inspection.model.sizeBytes,
        parameterCount: inspection.model.parameterCount,
        libraryName: inspection.model.libraryName,
        pipelineTag: inspection.model.pipelineTag,
        gated: inspection.model.gated,
        private: inspection.model.private,
        lastUsedAt: null,
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (!existingEntry) {
      mockModelArchiveEntries.unshift(archiveEntry);
    }
    persistMockArchiveEntries();
    return {
      ...inspection,
      model: {
        ...inspection.model,
        archiveEntry,
        cached: archiveEntry.status !== "remote",
      },
      archiveEntry,
    };
  },
  downloadArchiveModel: async (request) => {
    const inspection = await mockFoundryRepository.inspectArchiveModel(request);
    const existingEntry = mockModelArchiveEntries.find(
      (entry) => entry.repoId === request.repoId && entry.revision === (request.revision || "")
    );
    const now = new Date().toISOString();
    const archiveEntry: ModelArchiveEntry = existingEntry
      ? {
          ...existingEntry,
          localPath: `runtime/models/huggingface/${request.repoId.replace(/[^A-Za-z0-9_.-]+/g, "-")}`,
          status: "cached",
          sizeOnDiskBytes: inspection.model.sizeBytes || existingEntry.sizeOnDiskBytes,
          lastCheckedAt: now,
          updatedAt: now,
        }
      : {
          id: `mdl-${Date.now()}`,
          repoId: request.repoId,
          revision: request.revision || "",
          localPath: `runtime/models/huggingface/${request.repoId.replace(/[^A-Za-z0-9_.-]+/g, "-")}`,
          source: "huggingface",
          status: "cached",
          sizeOnDiskBytes: inspection.model.sizeBytes,
          parameterCount: inspection.model.parameterCount,
          libraryName: inspection.model.libraryName,
          pipelineTag: inspection.model.pipelineTag,
          gated: inspection.model.gated,
          private: inspection.model.private,
          lastUsedAt: null,
          lastCheckedAt: now,
          createdAt: now,
          updatedAt: now,
        };
    if (existingEntry) {
      const index = mockModelArchiveEntries.findIndex((entry) => entry.id === existingEntry.id);
      mockModelArchiveEntries.splice(index, 1, archiveEntry);
    } else {
      mockModelArchiveEntries.unshift(archiveEntry);
    }
    persistMockArchiveEntries();
    return {
      ...inspection,
      model: {
        ...inspection.model,
        archiveEntry,
        cached: true,
      },
      archiveEntry,
    };
  },
  evictArchiveModel: async (request) => {
    const existingEntry = mockModelArchiveEntries.find(
      (entry) => entry.repoId === request.repoId && entry.revision === (request.revision || "")
    );
    if (!existingEntry) {
      throw new Error("Model Archive entry was not found.");
    }
    const now = new Date().toISOString();
    const archiveEntry: ModelArchiveEntry = {
      ...existingEntry,
      localPath: "",
      status: "remote",
      sizeOnDiskBytes: 0,
      lastCheckedAt: now,
      updatedAt: now,
    };
    const index = mockModelArchiveEntries.findIndex((entry) => entry.id === existingEntry.id);
    mockModelArchiveEntries.splice(index, 1, archiveEntry);
    persistMockArchiveEntries();
    return { archiveEntry };
  },
  clearMockArchiveState: async () => {
    mockModelArchiveEntries.splice(0, mockModelArchiveEntries.length);
    Object.keys(mockModelDownloadJobs).forEach((jobId) => {
      delete mockModelDownloadJobs[jobId];
    });
    removeMockStorage(MOCK_ARCHIVE_ENTRIES_STORAGE_KEY);
    removeMockStorage(MOCK_DOWNLOAD_JOBS_STORAGE_KEY);
    return {
      archiveEntries: [],
      downloadJobs: [],
    };
  },
  startModelDownloadJob: async (request) => {
    const job: ModelDownloadJob = {
      id: `mdl-download-${Date.now()}`,
      repoId: request.repoId,
      revision: request.revision || "",
      status: "queued",
      phase: "queued",
      progress: 8,
      detail: `${request.repoId} is queued for mock Archive download.`,
      archiveEntry: null,
      error: null,
    };
    mockModelDownloadJobs[job.id] = job;
    persistMockDownloadJobs();
    return { ...job };
  },
  getModelDownloadJob: async (jobId) => {
    const job = mockModelDownloadJobs[jobId];
    if (!job) {
      throw new Error("Model download job was not found.");
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      return { ...job };
    }
    const nextProgress = Math.min(100, job.progress + 34);
    job.progress = nextProgress;
    job.status = nextProgress >= 100 ? "completed" : "running";
    job.phase =
      nextProgress >= 100
        ? "completed"
        : nextProgress >= 75
          ? "cataloging"
          : nextProgress >= 35
            ? "downloading"
            : "inspecting";
    job.detail =
      job.phase === "completed"
        ? `${job.repoId} is cached in the mock Archive.`
        : `Mock ${job.phase} phase for ${job.repoId}.`;
    if (job.status === "completed") {
      const result = await mockFoundryRepository.downloadArchiveModel({
        repoId: job.repoId,
        revision: job.revision,
      });
      job.archiveEntry = result.archiveEntry;
    }
    persistMockDownloadJobs();
    return { ...job };
  },
  listModelDownloadJobs: async () =>
    Object.values(mockModelDownloadJobs).sort((left, right) => right.id.localeCompare(left.id)),
  cancelModelDownloadJob: async (jobId) => {
    const job = mockModelDownloadJobs[jobId];
    if (!job) {
      throw new Error("Model download job was not found.");
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      return { ...job };
    }
    job.status = "canceled";
    job.phase = "canceled";
    job.progress = 100;
    job.detail = "Mock download canceled.";
    job.cancelRequested = true;
    persistMockDownloadJobs();
    return { ...job };
  },
};

export const apiFoundryRepository: FoundryRepository = {
  checkReadinessGate: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<FoundryReadinessGateDto>>(
        foundryApiRoutes.readiness,
        request
      )
    ),
  getFoundryStatus: async () => {
    try {
      return unwrap(
        await apiClient.get<ApiEnvelope<FoundryRuntimeStatus>>(foundryApiRoutes.status)
      );
    } catch (error) {
      return buildApiUnavailableStatus(
        error instanceof Error ? error.message : "FastAPI did not respond."
      );
    }
  },
  createWorkshop: async (request) =>
    unwrap(await apiClient.post<ApiEnvelope<Workshop>>(foundryApiRoutes.workshops, request)),
  deleteWorkshop: async (workshopId, request) =>
    unwrap(
      await apiClient.delete<ApiEnvelope<DeleteWorkshopResult>>(
        foundryApiRoutes.workshop(workshopId),
        { data: request }
      )
    ),
  getDashboard: async () =>
    unwrap(await apiClient.get<ApiEnvelope<DashboardSummary>>(foundryApiRoutes.dashboard)),
  getDashboardEvidence: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<DashboardLoopEvidence>>(
        foundryApiRoutes.dashboardEvidence(workshopId)
      )
    ),
  getNavigationItems: async () =>
    unwrap(await apiClient.get<ApiEnvelope<FoundryNavigationItem[]>>(foundryApiRoutes.navigation)),
  getSectionSummaries: async () =>
    unwrap(await apiClient.get<ApiEnvelope<SectionSummaryMap>>(foundryApiRoutes.sectionSummaries)),
  getUiCatalog: async () =>
    unwrap(await apiClient.get<ApiEnvelope<UiCatalogItem[]>>(foundryApiRoutes.uiCatalog)),
  listAcademyActions: async () =>
    unwrap(await apiClient.get<ApiEnvelope<AcademyActionDto[]>>(foundryApiRoutes.academyActions)),
  listAcademyConcepts: async () =>
    unwrap(
      await apiClient.get<ApiEnvelope<AcademyConceptDto[]>>(foundryApiRoutes.academyConcepts)
    ),
  listWorkshops: async () =>
    unwrap(await apiClient.get<ApiEnvelope<Workshop[]>>(foundryApiRoutes.workshops)),
  listMaterials: async (workshopId) =>
    unwrap(await apiClient.get<ApiEnvelope<MaterialSource[]>>(foundryApiRoutes.materials(workshopId))),
  loadBootstrap: async () =>
    unwrap(await apiClient.get<ApiEnvelope<FoundryBootstrap>>(foundryApiRoutes.bootstrap)),
  registerMaterial: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<MaterialSource>>(
        foundryApiRoutes.materials(workshopId),
        request
      )
    ),
  previewWebsiteMaterial: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<WebsiteMaterialPreview>>(
        foundryApiRoutes.previewWebsiteMaterial(workshopId),
        request
      )
    ),
  importMaterialFile: async (workshopId, request) => {
    const params = new URLSearchParams({
      name: request.name,
      kind: request.kind,
      filename: request.file.name,
    });
    return unwrap(
      await apiClient.post<ApiEnvelope<MaterialSource>>(
        `${foundryApiRoutes.importMaterialFile(workshopId)}?${params.toString()}`,
        await request.file.arrayBuffer(),
        {
          headers: {
            "Content-Type": "application/octet-stream",
          },
        }
      )
    );
  },
  listAssemblyLineRuns: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<AssemblyLineRunDto[]>>(
        foundryApiRoutes.assemblyLines(workshopId)
      )
    ),
  getQAGeneratorRuntime: async () =>
    unwrap(
      await apiClient.get<ApiEnvelope<QAGeneratorRuntimeDto>>(
        foundryApiRoutes.qaGeneratorRuntime
      )
    ),
  configureQAGeneratorRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<QAGeneratorRuntimeDto>>(
        foundryApiRoutes.configureQAGeneratorRuntime,
        request
      )
    ),
  preflightQAGenerator: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<QAGeneratorPreflightDto>>(
        foundryApiRoutes.preflightQAGenerator,
        request
      )
    ),
  runQAGeneratorSmokeProof: async () =>
    unwrap(
      await apiClient.post<ApiEnvelope<QAGeneratorSmokeProofDto>>(
        foundryApiRoutes.runQAGeneratorSmokeProof
      )
    ),
  runQAGeneratorQualityProof: async () =>
    unwrap(
      await apiClient.post<ApiEnvelope<QAGeneratorQualityProofDto>>(
        foundryApiRoutes.runQAGeneratorQualityProof
      )
    ),
  startAssemblyLine: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<AssemblyLineRunDto>>(
        foundryApiRoutes.assemblyLines(workshopId),
        request
      )
    ),
  listMaterialChunks: async (workshopId, runId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<MaterialChunkDto[]>>(foundryApiRoutes.chunks(workshopId), {
        params: runId ? { runId } : undefined,
      })
    ),
  listQAPairs: async (workshopId, runId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<QAPairDto[]>>(foundryApiRoutes.qaPairs(workshopId), {
        params: runId ? { runId } : undefined,
      })
    ),
  updateQAPairReview: async (workshopId, qaPairId, request) =>
    unwrap(
      await apiClient.patch<ApiEnvelope<QAPairDto>>(
        foundryApiRoutes.qaPair(workshopId, qaPairId),
        request
      )
    ),
  exportQAPairs: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ExportQAPairsDto>>(
        foundryApiRoutes.exportQAPairs(workshopId),
        request
      )
    ),
  previewQAPairsExport: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ExportQAPairsPreviewDto>>(
        foundryApiRoutes.previewQAPairsExport(workshopId),
        request
      )
    ),
  listForgeRuns: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<ForgeRunDto[]>>(foundryApiRoutes.forgeRuns(workshopId))
    ),
  startForge: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeRunDto>>(
        foundryApiRoutes.forgeRuns(workshopId),
        request
      )
    ),
  advanceForgeSimulation: async (forgeRunId) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeRunDto>>(
        foundryApiRoutes.simulateForgeRun(forgeRunId)
      )
    ),
  getForgeContract: async (forgeRunId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<ForgeTrainingContract>>(
        foundryApiRoutes.forgeContract(forgeRunId)
      )
    ),
  getForgeWorkerState: async (forgeRunId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<ForgeWorkerState>>(
        foundryApiRoutes.forgeEvents(forgeRunId)
      )
    ),
  reconcileForgeWorkerState: async (forgeRunId) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeWorkerReconcileDto>>(
        foundryApiRoutes.reconcileForgeWorker(forgeRunId)
      )
    ),
  preflightLocalForgeWorker: async (forgeRunId) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeLocalTrainerPreflightDto>>(
        foundryApiRoutes.preflightLocalForgeWorker(forgeRunId)
      )
    ),
  runLocalForgeWorker: async (forgeRunId) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeWorkerReconcileDto>>(
        foundryApiRoutes.runLocalForgeWorker(forgeRunId)
      )
    ),
  runForgeSmokeProof: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeSmokeProofDto>>(
        foundryApiRoutes.runForgeSmokeProof,
        request
      )
    ),
  getForgeRuntime: async () =>
    unwrap(await apiClient.get<ApiEnvelope<ForgeRuntime>>(foundryApiRoutes.forgeRuntime)),
  configureForgeRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ForgeRuntime>>(
        foundryApiRoutes.configureForgeRuntime,
        request
      )
    ),
  listArtifacts: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<ArtifactDto[]>>(foundryApiRoutes.artifacts(workshopId))
    ),
  listTrials: async (workshopId) =>
    unwrap(await apiClient.get<ApiEnvelope<TrialDto[]>>(foundryApiRoutes.trials(workshopId))),
  createTrial: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<TrialDto>>(foundryApiRoutes.trials(workshopId), request)
    ),
  exportTrials: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ExportTrialsDto>>(
        foundryApiRoutes.exportTrials(workshopId),
        request
      )
    ),
  exportEvaluationWeakSamples: async (forgeRunId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ExportEvaluationSamplesDto>>(
        foundryApiRoutes.exportEvaluationWeakSamples(forgeRunId),
        request
      )
    ),
  loadArtifactIntoConstruct: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructDto>>(
        foundryApiRoutes.loadArtifactIntoConstruct(workshopId),
        request
      )
    ),
  listConstructs: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<ConstructDto[]>>(foundryApiRoutes.constructs(workshopId))
    ),
  chatWithConstruct: async (constructId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructChatResponseDto>>(
        foundryApiRoutes.constructChat(constructId),
        request
      )
    ),
  streamConstructChat: async (constructId, request, onEvent) => {
    const baseUrl = apiClient.defaults.baseURL || "";
    const response = await fetch(`${baseUrl}${foundryApiRoutes.constructStream(constructId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Construct stream failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      events.forEach((eventBlock) => {
        const dataLine = eventBlock
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) {
          return;
        }
        onEvent(JSON.parse(dataLine.slice(6)) as ConstructChatStreamEvent);
      });
    }
  },
  getConstructRuntime: async () =>
    unwrap(await apiClient.get<ApiEnvelope<ConstructRuntime>>(foundryApiRoutes.constructRuntime)),
  listConstructRuntimeEvents: async () => {
    try {
      return unwrap(
        await apiClient.get<ApiEnvelope<ConstructRuntimeEvent[]>>(
          foundryApiRoutes.constructRuntimeEvents
        )
      );
    } catch {
      return [];
    }
  },
  recordConstructRuntimeEvent: async (request) => {
    try {
      return unwrap(
        await apiClient.post<ApiEnvelope<ConstructRuntimeEvent>>(
          foundryApiRoutes.constructRuntimeEvents,
          request
        )
      );
    } catch {
      return {
        ...request,
        id: `runtime-event-local-${Date.now()}`,
        timestamp: request.timestamp || new Date().toISOString(),
        source: "frontend",
      };
    }
  },
  exportConstructRuntimeEvents: async () => {
    try {
      return unwrap(
        await apiClient.get<ApiEnvelope<ConstructRuntimeHistoryExport>>(
          foundryApiRoutes.exportConstructRuntimeEvents
        )
      );
    } catch {
      return {
        contractVersion: "foundry.construct.runtime-history.v1",
        exportedAt: new Date().toISOString(),
        format: "json",
        eventCount: 0,
        runtime: unwrap(
          await apiClient.get<ApiEnvelope<ConstructRuntime>>(foundryApiRoutes.constructRuntime)
        ),
        events: [],
      };
    }
  },
  exportConstructDiagnosticsBundle: async (query = {}) => {
    try {
      return unwrap(
        await apiClient.get<ApiEnvelope<ExportConstructDiagnosticsBundleDto>>(
          foundryApiRoutes.exportConstructRuntimeDiagnostics,
          {
            params: {
              modelId: query.modelId || undefined,
              device: query.device || undefined,
              status: query.status || undefined,
            },
          }
        )
      );
    } catch {
      const [runtimeHistory, validationHistory, runtimeStatus, serviceStatus] = await Promise.all([
        apiFoundryRepository.exportConstructRuntimeEvents(),
        apiFoundryRepository.exportConstructRuntimeValidations(query),
        apiFoundryRepository.getConstructRuntime(),
        apiFoundryRepository.getFoundryStatus().catch(() => null),
      ]);
      return constructDiagnosticsBundleExport(
        runtimeHistory,
        validationHistory,
        serviceStatus,
        runtimeStatus
      );
    }
  },
  clearConstructRuntimeEvents: async () => {
    try {
      return unwrap(
        await apiClient.post<ApiEnvelope<ClearConstructRuntimeEventsDto>>(
          foundryApiRoutes.clearConstructRuntimeEvents,
          {}
        )
      );
    } catch {
      return {
        deletedCount: 0,
        clearedAt: new Date().toISOString(),
      };
    }
  },
  listConstructRuntimeValidations: async (query = {}) => {
    try {
      const response = unwrap(
        await apiClient.get<
          ApiEnvelope<ConstructRuntimeValidationPageDto | ConstructRuntimeValidationDto[]>
        >(foundryApiRoutes.constructRuntimeValidations, {
          params: {
            modelId: query.modelId || undefined,
            device: query.device || undefined,
            status: query.status || undefined,
            page: query.page,
            pageSize: query.pageSize,
          },
        })
      );
      return Array.isArray(response)
        ? constructRuntimeValidationPage(response, query)
        : response;
    } catch {
      return constructRuntimeValidationPage([], query);
    }
  },
  exportConstructRuntimeValidations: async (query = {}) => {
    try {
      return unwrap(
        await apiClient.get<ApiEnvelope<ExportConstructRuntimeValidationsDto>>(
          foundryApiRoutes.exportConstructRuntimeValidations,
          {
            params: {
              modelId: query.modelId || undefined,
              device: query.device || undefined,
              status: query.status || undefined,
            },
          }
        )
      );
    } catch {
      return constructRuntimeValidationExport([], query);
    }
  },
  createConstructRuntimeValidation: async (request) => {
    try {
      return unwrap(
        await apiClient.post<ApiEnvelope<ConstructRuntimeValidationDto>>(
          foundryApiRoutes.constructRuntimeValidations,
          request
        )
      );
    } catch {
      return {
        ...request,
        id: `rtv-local-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
    }
  },
  configureConstructRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntime>>(
        foundryApiRoutes.configureConstructRuntime,
        request
      )
    ),
  loadConstructRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntime>>(
        foundryApiRoutes.loadConstructRuntime,
        request
      )
    ),
  preflightConstructRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntimePreflightDto>>(
        foundryApiRoutes.preflightConstructRuntime,
        request
      )
    ),
  probeConstructRuntime: async (request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntimeProbeDto>>(
        foundryApiRoutes.probeConstructRuntime,
        request
      )
    ),
  unloadConstructRuntime: async () =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntime>>(
        foundryApiRoutes.unloadConstructRuntime
      )
    ),
  releaseConstructRuntimeMemory: async () =>
    unwrap(
      await apiClient.post<ApiEnvelope<ConstructRuntime>>(
        foundryApiRoutes.releaseConstructRuntimeMemory
      )
    ),
  listModelArchiveEntries: async () =>
    archiveRequest(
      apiClient.get<ApiEnvelope<ModelArchiveEntry[]>>(foundryApiRoutes.modelArchive),
      "Could not load Model Archive entries."
    ),
  testHuggingFaceAuth: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<HuggingFaceAuthCheckDto>>(
        foundryApiRoutes.testHuggingFaceAuth,
        request
      ),
      "Could not test Hugging Face credentials."
    ),
  searchArchiveModels: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelSearchDto>>(
        foundryApiRoutes.searchArchiveModels,
        request
      ),
      "Could not search Hugging Face models."
    ),
  preflightArchiveModel: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelPreflightDto>>(
        foundryApiRoutes.preflightArchiveModel,
        request
      ),
      "Could not preflight Hugging Face model."
    ),
  inspectArchiveModel: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelInspectDto>>(
        foundryApiRoutes.inspectArchiveModel,
        request
      ),
      "Could not inspect Hugging Face model."
    ),
  registerArchiveModel: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelRegisterDto>>(
        foundryApiRoutes.registerArchiveModel,
        request
      ),
      "Could not register Hugging Face model."
    ),
  downloadArchiveModel: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelDownloadDto>>(
        foundryApiRoutes.downloadArchiveModel,
        request
      ),
      "Could not download Hugging Face model."
    ),
  evictArchiveModel: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ArchiveModelEvictDto>>(
        foundryApiRoutes.evictArchiveModel,
        request
      ),
      "Could not evict Archive model."
    ),
  clearMockArchiveState: async () => ({
    archiveEntries: await apiFoundryRepository.listModelArchiveEntries(),
    downloadJobs: await apiFoundryRepository.listModelDownloadJobs(),
  }),
  startModelDownloadJob: async (request) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ModelDownloadJobDto>>(
        foundryApiRoutes.startModelDownloadJob,
        request
      ),
      "Could not start model download job."
    ),
  listModelDownloadJobs: async () =>
    archiveRequest(
      apiClient.get<ApiEnvelope<ModelDownloadJobDto[]>>(
        foundryApiRoutes.modelDownloadJobs
      ),
      "Could not load model download jobs."
    ),
  getModelDownloadJob: async (jobId) =>
    archiveRequest(
      apiClient.get<ApiEnvelope<ModelDownloadJobDto>>(
        foundryApiRoutes.modelDownloadJob(jobId)
      ),
      "Could not load model download job."
    ),
  cancelModelDownloadJob: async (jobId) =>
    archiveRequest(
      apiClient.post<ApiEnvelope<ModelDownloadJobDto>>(
        foundryApiRoutes.cancelModelDownloadJob(jobId)
      ),
      "Could not cancel model download job."
    ),
};

const constructApiOverrides: Pick<
  FoundryRepository,
  | "getFoundryStatus"
  | "chatWithConstruct"
  | "streamConstructChat"
  | "getConstructRuntime"
  | "listConstructRuntimeEvents"
  | "recordConstructRuntimeEvent"
  | "exportConstructRuntimeEvents"
  | "exportConstructDiagnosticsBundle"
  | "clearConstructRuntimeEvents"
  | "listConstructRuntimeValidations"
  | "exportConstructRuntimeValidations"
  | "createConstructRuntimeValidation"
  | "getQAGeneratorRuntime"
  | "configureQAGeneratorRuntime"
  | "preflightQAGenerator"
  | "runQAGeneratorSmokeProof"
  | "runQAGeneratorQualityProof"
  | "configureConstructRuntime"
  | "loadConstructRuntime"
  | "preflightConstructRuntime"
  | "probeConstructRuntime"
  | "unloadConstructRuntime"
  | "releaseConstructRuntimeMemory"
  | "listModelArchiveEntries"
  | "testHuggingFaceAuth"
  | "searchArchiveModels"
  | "preflightArchiveModel"
  | "inspectArchiveModel"
  | "registerArchiveModel"
  | "downloadArchiveModel"
  | "evictArchiveModel"
  | "clearMockArchiveState"
  | "startModelDownloadJob"
  | "listModelDownloadJobs"
  | "getModelDownloadJob"
  | "cancelModelDownloadJob"
> = {
  getFoundryStatus: apiFoundryRepository.getFoundryStatus,
  chatWithConstruct: apiFoundryRepository.chatWithConstruct,
  streamConstructChat: apiFoundryRepository.streamConstructChat,
  getConstructRuntime: apiFoundryRepository.getConstructRuntime,
  listConstructRuntimeEvents: apiFoundryRepository.listConstructRuntimeEvents,
  recordConstructRuntimeEvent: apiFoundryRepository.recordConstructRuntimeEvent,
  exportConstructRuntimeEvents: apiFoundryRepository.exportConstructRuntimeEvents,
  exportConstructDiagnosticsBundle: apiFoundryRepository.exportConstructDiagnosticsBundle,
  clearConstructRuntimeEvents: apiFoundryRepository.clearConstructRuntimeEvents,
  listConstructRuntimeValidations: apiFoundryRepository.listConstructRuntimeValidations,
  exportConstructRuntimeValidations: apiFoundryRepository.exportConstructRuntimeValidations,
  createConstructRuntimeValidation: apiFoundryRepository.createConstructRuntimeValidation,
  getQAGeneratorRuntime: apiFoundryRepository.getQAGeneratorRuntime,
  configureQAGeneratorRuntime: apiFoundryRepository.configureQAGeneratorRuntime,
  preflightQAGenerator: apiFoundryRepository.preflightQAGenerator,
  runQAGeneratorSmokeProof: apiFoundryRepository.runQAGeneratorSmokeProof,
  runQAGeneratorQualityProof: apiFoundryRepository.runQAGeneratorQualityProof,
  configureConstructRuntime: apiFoundryRepository.configureConstructRuntime,
  loadConstructRuntime: apiFoundryRepository.loadConstructRuntime,
  preflightConstructRuntime: apiFoundryRepository.preflightConstructRuntime,
  probeConstructRuntime: apiFoundryRepository.probeConstructRuntime,
  unloadConstructRuntime: apiFoundryRepository.unloadConstructRuntime,
  releaseConstructRuntimeMemory: apiFoundryRepository.releaseConstructRuntimeMemory,
  listModelArchiveEntries: apiFoundryRepository.listModelArchiveEntries,
  testHuggingFaceAuth: apiFoundryRepository.testHuggingFaceAuth,
  searchArchiveModels: apiFoundryRepository.searchArchiveModels,
  preflightArchiveModel: apiFoundryRepository.preflightArchiveModel,
  inspectArchiveModel: apiFoundryRepository.inspectArchiveModel,
  registerArchiveModel: apiFoundryRepository.registerArchiveModel,
  downloadArchiveModel: apiFoundryRepository.downloadArchiveModel,
  evictArchiveModel: apiFoundryRepository.evictArchiveModel,
  clearMockArchiveState: apiFoundryRepository.clearMockArchiveState,
  startModelDownloadJob: apiFoundryRepository.startModelDownloadJob,
  listModelDownloadJobs: apiFoundryRepository.listModelDownloadJobs,
  getModelDownloadJob: apiFoundryRepository.getModelDownloadJob,
  cancelModelDownloadJob: apiFoundryRepository.cancelModelDownloadJob,
};

export const constructApiFoundryRepository: FoundryRepository = {
  ...mockFoundryRepository,
  ...constructApiOverrides,
};

export const getFoundryRepository = (): FoundryRepository => {
  const dataSource = import.meta.env.VITE_FOUNDRY_DATA_SOURCE;
  if (dataSource === "api") {
    return apiFoundryRepository;
  }
  if (dataSource === "construct-api") {
    return constructApiFoundryRepository;
  }
  return mockFoundryRepository;
};

export const loadFoundryBootstrap = async (
  repository: FoundryRepository = getFoundryRepository()
): Promise<FoundryBootstrap> => {
  if (repository === apiFoundryRepository) {
    return repository.loadBootstrap();
  }

  const [dashboard, academyActions, navigationItems, sectionSummaries, uiCatalog] =
    await Promise.all([
      repository.getDashboard(),
      repository.listAcademyActions(),
      repository.getNavigationItems(),
      repository.getSectionSummaries(),
      repository.getUiCatalog(),
    ]);

  return {
    dashboard,
    academyActions,
    navigationItems,
    sectionSummaries,
    uiCatalog,
  };
};
