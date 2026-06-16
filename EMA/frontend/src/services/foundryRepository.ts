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
  ConstructDto,
  ConstructChatRequest,
  ConstructChatResponseDto,
  ConstructRuntimePreflightDto,
  ConstructRuntimeProbeDto,
  CreateTrialRequest,
  CreateWorkshopRequest,
  ExportEvaluationSamplesDto,
  ExportEvaluationSamplesRequest,
  ExportConstructRuntimeEventsDto,
  ExportQAPairsDto,
  ExportQAPairsRequest,
  ExportTrialsDto,
  ExportTrialsRequest,
  ForgeRunDto,
  ForgeWorkerReconcileDto,
  foundryApiRoutes,
  HuggingFaceAuthCheckDto,
  IngestMaterialRequest,
  InspectArchiveModelRequest,
  LoadArtifactIntoConstructRequest,
  LoadConstructRuntimeRequest,
  ModelDownloadJobDto,
  MaterialChunkDto,
  QAPairDto,
  PreflightConstructRuntimeRequest,
  ProbeConstructRuntimeRequest,
  SearchArchiveModelsRequest,
  StartAssemblyLineRequest,
  StartForgeRequest,
  TestHuggingFaceAuthRequest,
  TrialDto,
} from "../contracts/foundryApi";
import {
  AcademyAction,
  Artifact,
  AcademyConcept,
  AssemblyLineRun,
  Construct,
  ConstructChatResponse,
  ConstructChatStreamEvent,
  ConstructRuntimeEvent,
  ConstructRuntime,
  ConstructRuntimeHistoryExport,
  ConstructRuntimePreflightResult,
  ConstructRuntimeProbeResult,
  CreateConstructRuntimeEventRequest,
  DashboardSummary,
  FoundryNavigationItem,
  ForgeEvaluationReport,
  ForgeTrainingContract,
  ForgeWorkerReconcileResult,
  ForgeWorkerState,
  ForgeRuntime,
  ForgeRun,
  FoundryRuntimeStatus,
  MaterialChunk,
  MaterialSource,
  ModelArchiveEntry,
  ModelDownloadJob,
  ModelPlatformProfile,
  ModelSearchResult,
  NavigationSection,
  QAPair,
  SectionSummary,
  Trial,
  Workshop,
} from "../domain/foundry";
import apiClient from "../managers/axiosConfig";
import { defaultAcademyActions, defaultAcademyConcepts } from "../domain/academyRegistry";
import {
  foundryNavigationItems,
  foundrySectionSummaries,
  mockDashboardSummary,
} from "../mocks/foundryMockData";

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

export interface FoundryRepository {
  getFoundryStatus: () => Promise<FoundryRuntimeStatus>;
  createWorkshop: (request: CreateWorkshopRequest) => Promise<Workshop>;
  getDashboard: () => Promise<DashboardSummary>;
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
  listAssemblyLineRuns: (workshopId: string) => Promise<AssemblyLineRun[]>;
  startAssemblyLine: (
    workshopId: string,
    request: StartAssemblyLineRequest
  ) => Promise<AssemblyLineRun>;
  listMaterialChunks: (workshopId: string, runId?: string) => Promise<MaterialChunk[]>;
  listQAPairs: (workshopId: string, runId?: string) => Promise<QAPair[]>;
  exportQAPairs: (
    workshopId: string,
    request: ExportQAPairsRequest
  ) => Promise<ExportQAPairsDto>;
  listForgeRuns: (workshopId: string) => Promise<ForgeRun[]>;
  startForge: (workshopId: string, request: StartForgeRequest) => Promise<ForgeRun>;
  advanceForgeSimulation: (forgeRunId: string) => Promise<ForgeRun>;
  getForgeContract: (forgeRunId: string) => Promise<ForgeTrainingContract>;
  getForgeWorkerState: (forgeRunId: string) => Promise<ForgeWorkerState>;
  reconcileForgeWorkerState: (forgeRunId: string) => Promise<ForgeWorkerReconcileResult>;
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
  clearConstructRuntimeEvents: () => Promise<ClearConstructRuntimeEventsDto>;
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
const mockArchiveModels: ModelSearchResult[] = [
  {
    repoId: "sshleifer/tiny-gpt2",
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

export const mockFoundryRepository: FoundryRepository = {
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
  getDashboard: async () => mockDashboardSummary,
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
  listAssemblyLineRuns: async () => mockAssemblyLineRuns,
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
  exportQAPairs: async (_workshopId, request) => {
    const qaPairs = mockQAPairs.filter(
      (qaPair) =>
        qaPair.workshopId === _workshopId &&
        qaPair.assemblyLineRunId === request.assemblyLineRunId
    );
    if (qaPairs.length === 0) {
      throw new Error("This Assembly Line run has no QA pairs to export.");
    }
    const material: MaterialSource = {
      id: `mat-export-${Date.now()}`,
      name: request.name || "Training QA Dataset",
      kind: "jsonl",
      status: "qa-ready",
      sourceUri: `runtime/materials/exports/${_workshopId}/${request.assemblyLineRunId}.jsonl`,
      chunkCount: qaPairs.length,
      qaPairCount: qaPairs.length,
    };
    mockMaterialSources.unshift(material);
    return {
      material,
      exportUri: material.sourceUri,
      format: "jsonl",
      qaPairCount: qaPairs.length,
      assemblyLineRunId: request.assemblyLineRunId,
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
      const artifact: Artifact = {
        id: forgeRun.artifactId,
        workshopId: forgeRun.workshopId,
        forgeRunId: forgeRun.id,
        name: `${forgeRun.method} Artifact`,
        version: `v0.${mockArtifacts.length + 1}.0`,
        baseModel: forgeRun.baseModel || "unknown",
        adapterPath: `runtime/artifacts/${forgeRun.artifactId}/adapter`,
        status: "ready",
        trainingMethod: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        trialScore: 0,
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
      const artifact: Artifact = {
        id: forgeRun.artifactId,
        workshopId: forgeRun.workshopId,
        forgeRunId: forgeRun.id,
        name: `${forgeRun.method} Artifact`,
        version: `v0.${mockArtifacts.length + 1}.0`,
        baseModel: forgeRun.baseModel || "unknown",
        adapterPath: `runtime/artifacts/${forgeRun.artifactId}/adapter`,
        status: "ready",
        trainingMethod: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
        trialScore: 0,
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
  getForgeRuntime: async () => mockForgeRuntime,
  configureForgeRuntime: async (request) => {
    mockForgeRuntime = {
      mode: request.mode,
      status: request.mode === "simulated" ? "ready" : "blocked",
      detail:
        request.mode === "simulated"
          ? "Mock Forge runtime uses deterministic progress simulation."
          : "Mock local trainer adapter is configured but not executable.",
      worker: request.worker || (request.mode === "simulated" ? "in-process-simulator" : "local-process"),
      ready: request.mode === "simulated",
      supportsMethods: ["LoRA", "QLoRA"],
    };
    return mockForgeRuntime;
  },
  listArtifacts: async (_workshopId) =>
    mockArtifacts.filter((artifact) => artifact.workshopId === _workshopId),
  listTrials: async (_workshopId) =>
    mockTrials.filter((trial) => trial.workshopId === _workshopId),
  createTrial: async (_workshopId, request) => {
    const trial: Trial = {
      id: `trl-${Date.now()}`,
      workshopId: _workshopId,
      artifactId: request.artifactId,
      constructId: request.constructId,
      messageId: request.messageId,
      prompt: request.prompt,
      response: request.response,
      verdict: request.verdict,
      runtimeMode: request.runtimeMode,
      tokenCount: request.tokenCount,
      generationSettings: {
        contextWindow: Number(request.generationSettings.contextWindow || mockConstruct.contextWindow),
        maxNewTokens: Number(request.generationSettings.maxNewTokens || mockConstruct.maxNewTokens),
        temperature: Number(request.generationSettings.temperature || mockConstruct.temperature),
        includeLibraryContext: Boolean(request.generationSettings.includeLibraryContext),
        ...request.generationSettings,
      },
      createdAt: new Date().toISOString(),
    };
    mockTrials.unshift(trial);
    const artifact = mockArtifacts.find((item) => item.id === request.artifactId);
    if (artifact) {
      const artifactTrials = mockTrials.filter((item) => item.artifactId === artifact.id);
      const passCount = artifactTrials.filter((item) => item.verdict === "pass").length;
      artifact.trialScore = Math.round((passCount / Math.max(1, artifactTrials.length)) * 100);
      mockDashboardSummary.currentArtifact = artifact;
    }
    return trial;
  },
  exportTrials: async (_workshopId, request) => {
    const selectedTrials = mockTrials.filter((trial) => {
      const isSelected = request.trialIds.includes(trial.id);
      const matchesVerdict = request.verdicts?.length
        ? request.verdicts.includes(trial.verdict)
        : true;
      return trial.workshopId === _workshopId && isSelected && matchesVerdict;
    });
    if (selectedTrials.length === 0) {
      throw new Error("No Trials matched this export selection.");
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
    return {
      conversationId: request.conversationId,
      construct: {
        ...mockConstruct,
        status: "streaming",
      },
      artifact,
      message: {
        id: `msg-${Date.now()}`,
        sender: "assistant",
        text: `Simulated response from ${mockConstruct.name} using ${artifact.name} ${artifact.version}. You asked: "${request.message}". Generation settings are max_new_tokens=${request.maxNewTokens ?? mockConstruct.maxNewTokens}, temperature=${request.temperature ?? mockConstruct.temperature}, context_window=${mockConstruct.contextWindow}.`,
        tokenCount: 32,
      },
      generation: {
        contextWindow: mockConstruct.contextWindow,
        maxNewTokens: request.maxNewTokens ?? mockConstruct.maxNewTokens,
        temperature: request.temperature ?? mockConstruct.temperature,
        includeLibraryContext: request.includeLibraryContext,
      },
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
  clearConstructRuntimeEvents: async () => {
    const deletedCount = mockConstructRuntimeEvents.length;
    mockConstructRuntimeEvents = [];
    return {
      deletedCount,
      clearedAt: new Date().toISOString(),
    };
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
    const nextRuntime = {
      ...mockConstructRuntime,
      modelId: request.modelId || mockConstructRuntime.modelId,
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
      diagnostics: mockRuntimeDiagnostics(nextRuntime),
    };
    recordMockConstructRuntimeEvent({
      type: "load",
      status: "passed",
      title: "Mock runtime loaded model",
      detail: `${nextRuntime.modelId} is loaded on ${nextRuntime.device}.`,
      modelId: nextRuntime.modelId,
      runtimeStatus: mockConstructRuntime.status,
      source: "mock",
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
    modelId: request.modelId || "sshleifer/tiny-gpt2",
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
  getDashboard: async () =>
    unwrap(await apiClient.get<ApiEnvelope<DashboardSummary>>(foundryApiRoutes.dashboard)),
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
  listAssemblyLineRuns: async (workshopId) =>
    unwrap(
      await apiClient.get<ApiEnvelope<AssemblyLineRunDto[]>>(
        foundryApiRoutes.assemblyLines(workshopId)
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
  exportQAPairs: async (workshopId, request) =>
    unwrap(
      await apiClient.post<ApiEnvelope<ExportQAPairsDto>>(
        foundryApiRoutes.exportQAPairs(workshopId),
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
  | "clearConstructRuntimeEvents"
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
  clearConstructRuntimeEvents: apiFoundryRepository.clearConstructRuntimeEvents,
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
