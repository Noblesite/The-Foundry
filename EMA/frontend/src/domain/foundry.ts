export type NavigationSection =
  | "workshop"
  | "materials"
  | "forge"
  | "artifacts"
  | "construct"
  | "library"
  | "trials"
  | "academy"
  | "settings";

export type TrainingMethod = "LoRA" | "QLoRA";
export type ForgePurpose = "training" | "evaluation";
export type WorkshopStatus = "planning" | "assembling" | "forging" | "evaluating" | "ready";
export type MaterialKind =
  | "csv"
  | "pdf"
  | "website"
  | "transcript"
  | "video-transcript"
  | "text"
  | "jsonl";
export type MaterialStatus = "staged" | "chunked" | "qa-ready" | "needs-review";
export type AssemblyLineStatus = "queued" | "running" | "completed" | "failed";
export type ForgeRunStatus = "queued" | "running" | "paused" | "completed" | "failed";
export type ArtifactStatus = "draft" | "trial" | "ready" | "archived";
export type ConstructStatus = "offline" | "warming" | "streaming" | "paused";
export type ConstructRuntimeMode = "simulated" | "transformers";
export type ConstructRuntimeDevice = "auto" | "cpu" | "cuda" | "mps";
export type ConstructRuntimeEventType =
  | "handoff"
  | "preflight"
  | "configure"
  | "load"
  | "unload"
  | "probe"
  | "smoke";
export type ConstructRuntimeEventStatus =
  | "running"
  | "passed"
  | "warning"
  | "failed"
  | "info";
export type ForgeRuntimeMode = "simulated" | "local";
export type ModelArchiveStatus = "remote" | "cached" | "ready" | "failed";
export type ModelFitStatus = "fits" | "tight" | "too-large" | "unknown";
export type TrialStatus = "not-started" | "running" | "passed" | "failed";
export type TrialVerdict = "pass" | "needs-work" | "fail";
export type LearningDifficulty = "starter" | "builder" | "advanced";

export interface WorkspaceSettings {
  huggingFaceUsername: string;
  huggingFaceToken: string;
  defaultBaseModel: string;
  modelName: string;
  subjectMatter: string;
  characterVoice: string;
  sourceDirectory: string;
  outputDirectory: string;
  contextWindow: number;
  maxNewTokens: number;
  temperature: number;
  topP: number;
  qaPairsPerSource: number;
  trainingMethod: TrainingMethod;
  epochs: number;
  learningRate: string;
  loadIn4Bit: boolean;
  enableStreaming: boolean;
  constructRuntimeMode: ConstructRuntimeMode;
  constructModelId: string;
  constructDevice: ConstructRuntimeDevice;
}

export const resolveDefaultBaseModel = (
  settings: Pick<WorkspaceSettings, "defaultBaseModel" | "modelName">
) => settings.defaultBaseModel || settings.modelName;

export interface FoundryNavigationItem {
  id: NavigationSection;
  label: string;
  icon: string;
}

export interface SectionSummary {
  eyebrow: string;
  title: string;
  body: string;
  stats: Array<{ label: string; value: string }>;
  concept: {
    title: string;
    body: string;
  };
}

export interface Workshop {
  id: string;
  name: string;
  subject: string;
  voiceTarget: string;
  status: WorkshopStatus;
  progress: number;
  materialRefinement: number;
  activeArtifactId: string;
  activeConstructId: string;
}

export interface MaterialSource {
  id: string;
  name: string;
  kind: MaterialKind;
  status: MaterialStatus;
  sourceUri: string;
  chunkCount: number;
  qaPairCount: number;
}

export interface MaterialSet {
  id: string;
  workshopId: string;
  name: string;
  sourceCount: number;
  chunkCount: number;
  qaPairCount: number;
  sources: MaterialSource[];
}

export interface AssemblyLineRun {
  id: string;
  workshopId: string;
  materialSourceIds: string[];
  status: AssemblyLineStatus;
  progress: number;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  qaPairsPerSource: number;
  chunkCount: number;
  qaPairCount: number;
}

export interface MaterialChunk {
  id: string;
  workshopId: string;
  materialId: string;
  assemblyLineRunId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

export interface QAPair {
  id: string;
  workshopId: string;
  materialId: string;
  chunkId: string;
  assemblyLineRunId: string;
  question: string;
  answer: string;
}

export interface ForgeRun {
  id: string;
  workshopId: string;
  materialSetId?: string;
  artifactId?: string;
  baseModel?: string;
  purpose: ForgePurpose;
  label: string;
  method: TrainingMethod | "QA Generation" | "Embedding Build";
  status: ForgeRunStatus;
  progress: number;
  learningRate?: string;
  loadIn4Bit?: boolean;
  epoch?: {
    current: number;
    total: number;
  };
  trainingContract?: ForgeTrainingContract;
  workerState?: ForgeWorkerState;
}

export interface ForgeRuntime {
  mode: ForgeRuntimeMode;
  status: string;
  detail: string;
  worker: string;
  ready: boolean;
  supportsMethods: TrainingMethod[];
}

export interface ForgeTrainingContract {
  contractVersion: "foundry.forge.training.v1";
  forgeRunId: string;
  workshopId: string;
  materialId: string;
  datasetUri: string;
  baseModel: string;
  method: TrainingMethod;
  purpose: ForgePurpose;
  epochs: number;
  learningRate: string;
  loadIn4Bit: boolean;
  outputDir: string;
  runtime: ForgeRuntime;
}

export interface ForgeEvent {
  id: string;
  forgeRunId: string;
  type:
    | "queued"
    | "dataset_validated"
    | "dataset_validation_failed"
    | "contract_missing"
    | "evaluation_started"
    | "evaluation_completed"
    | "epoch_started"
    | "step_completed"
    | "artifact_planned"
    | "completed";
  message: string;
  timestamp: string;
  progress?: number;
  epoch?: {
    current: number;
    total: number;
  };
  data?: Record<string, unknown>;
}

export interface ForgeMetrics {
  forgeRunId: string;
  status: string;
  progress: number;
  datasetRows: number;
  lastEvent: string | null;
  epoch?: {
    current: number;
    total: number;
  };
  evaluationReport?: ForgeEvaluationReport;
}

export interface ForgeWorkerState {
  events: ForgeEvent[];
  metrics: ForgeMetrics;
}

export interface ForgeEvaluationReport {
  reportVersion: "foundry.forge.evaluation.v1";
  forgeRunId: string;
  materialId: string;
  datasetUri: string;
  rowCount: number;
  passCount: number;
  needsWorkCount: number;
  failCount: number;
  passRate: number;
  rubric: Array<{
    label: string;
    score: number;
    explanation: string;
  }>;
  samples: Array<{
    instruction: string;
    expected: string;
    observed: string;
    verdict: TrialVerdict;
    note: string;
  }>;
  recommendations: string[];
  createdAt: string;
}

export interface ForgeWorkerReconcileResult extends ForgeWorkerState {
  contract: ForgeTrainingContract;
  forgeRun?: ForgeRun;
  validation?: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  workshopId: string;
  forgeRunId?: string;
  name: string;
  version: string;
  baseModel: string;
  adapterPath?: string;
  status: ArtifactStatus;
  trainingMethod: TrainingMethod;
  trialScore: number;
}

export interface LibraryIndex {
  id: string;
  workshopId: string;
  name: string;
  embeddingModel: string;
  indexedChunks: number;
  recallScore: number;
}

export interface Construct {
  id: string;
  workshopId: string;
  name: string;
  artifactId: string;
  status: ConstructStatus;
  streamingEnabled: boolean;
  contextWindow: number;
  maxNewTokens: number;
  temperature: number;
}

export interface ConstructMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  tokenCount?: number;
}

export interface ConstructChatResponse {
  conversationId: string;
  construct: Construct;
  artifact: Artifact;
  message: ConstructMessage;
  generation: {
    contextWindow: number;
    maxNewTokens: number;
    temperature: number;
    includeLibraryContext: boolean;
  };
}

export interface ConstructRuntime {
  mode: ConstructRuntimeMode;
  status: string;
  detail: string;
  modelId: string;
  device: string;
  loaded: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface FoundryServiceStatus {
  reachable: boolean;
  status: string;
  detail: string;
  checkedAt: string;
}

export interface FoundryConstructServiceStatus extends FoundryServiceStatus {
  mode: ConstructRuntimeMode | null;
  modelLoaded: boolean;
  modelId: string | null;
  device: string | null;
}

export interface FoundryForgeServiceStatus extends FoundryServiceStatus {
  mode: ForgeRuntimeMode | null;
  ready: boolean;
}

export interface FoundryRuntimeStatus {
  contractVersion: "foundry.status.v1";
  api: FoundryServiceStatus;
  construct: FoundryConstructServiceStatus;
  forge: FoundryForgeServiceStatus;
  catalog: FoundryServiceStatus;
}

export interface ConstructRuntimeEvent {
  id: string;
  type: ConstructRuntimeEventType;
  status: ConstructRuntimeEventStatus;
  title: string;
  detail: string;
  timestamp: string;
  constructId?: string;
  artifactId?: string;
  modelId?: string;
  runtimeStatus?: string;
  source: "frontend" | "mock" | "backend";
  metadata?: Record<string, unknown>;
}

export interface ConstructRuntimeHistoryExport {
  contractVersion: "foundry.construct.runtime-history.v1";
  exportedAt: string;
  format: "json";
  eventCount: number;
  runtime: ConstructRuntime;
  events: ConstructRuntimeEvent[];
}

export interface ConstructRuntimeValidation {
  id: string;
  constructId?: string | null;
  artifactId?: string | null;
  modelId: string;
  device: string;
  status: "passed" | "failed";
  totalTokens: number;
  durationSeconds: number;
  cleanupStatus: string;
  memoryAvailableGb?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type CreateConstructRuntimeValidationRequest = Omit<
  ConstructRuntimeValidation,
  "id" | "createdAt"
>;

export type CreateConstructRuntimeEventRequest = Omit<
  ConstructRuntimeEvent,
  "id" | "timestamp" | "source"
> & {
  timestamp?: string;
  source?: ConstructRuntimeEvent["source"];
};

export interface ConstructRuntimeProbeResult {
  ok: boolean;
  modelId: string;
  prompt: string;
  output: string;
  device: string;
  requestedDevice: string;
  loadSeconds: number | null;
  totalSeconds: number;
  maxNewTokens: number;
  error?: string;
  diagnostics: Record<string, unknown>;
}

export interface ConstructRuntimePreflightCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface ConstructRuntimePreflightResult {
  ok: boolean;
  modelId: string;
  device: string;
  localFilesOnly: boolean;
  modelType?: string | null;
  architectures: string[];
  contextWindow?: number | null;
  parameterCountEstimate?: number | null;
  estimatedLoadBytes: number;
  availableBytes: number;
  fitStatus: ModelFitStatus;
  checks: ConstructRuntimePreflightCheck[];
  warnings: string[];
  diagnostics: Record<string, unknown>;
}

export interface ConstructModelHandoff {
  modelId: string;
  label?: string;
  source: "archive" | "settings" | "artifact";
  requestedAt: number;
  preflightOnOpen: boolean;
}

export interface ModelPlatformProfile {
  os: string;
  machine: string;
  python: string;
  accelerator: "cpu" | "cuda" | "mps" | string;
  systemMemoryBytes: number;
  availableMemoryBytes: number;
  acceleratorMemoryBytes: number;
  unifiedMemory: boolean;
  torch: Record<string, unknown>;
  auth?: {
    provider: "huggingface" | string;
    username?: string | null;
    tokenPresent: boolean;
  };
}

export interface ModelFitEstimate {
  status: ModelFitStatus;
  recommendedRuntime: string;
  estimatedBytes: number;
  availableBytes: number;
  assumedQuantization?: string;
  reason: string;
}

export interface ModelArchiveEntry {
  id: string;
  repoId: string;
  revision: string;
  localPath: string;
  source: "huggingface" | string;
  status: ModelArchiveStatus;
  sizeOnDiskBytes: number;
  parameterCount?: number | null;
  libraryName?: string | null;
  pipelineTag?: string | null;
  gated: boolean;
  private: boolean;
  lastUsedAt?: string | null;
  lastCheckedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelDownloadJob {
  id: string;
  repoId: string;
  revision: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  phase: "queued" | "inspecting" | "downloading" | "cataloging" | "completed" | "failed" | "canceled";
  progress: number;
  detail: string;
  archiveEntry?: ModelArchiveEntry | null;
  error?: string | null;
  cancelRequested?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModelSearchResult {
  repoId: string;
  author?: string | null;
  sha?: string | null;
  lastModified?: string | null;
  downloads: number;
  likes: number;
  libraryName?: string | null;
  pipelineTag?: string | null;
  tags: string[];
  gated: boolean;
  private: boolean;
  parameterCount?: number | null;
  sizeBytes: number;
  revision?: string;
  cached?: boolean;
  archiveEntry?: ModelArchiveEntry | null;
  fitEstimate: ModelFitEstimate;
}

export interface Trial {
  id: string;
  workshopId: string;
  artifactId: string;
  constructId: string;
  messageId: string;
  prompt: string;
  response: string;
  verdict: TrialVerdict;
  runtimeMode: string;
  tokenCount: number;
  generationSettings: ConstructChatResponse["generation"] & Record<string, unknown>;
  createdAt: string;
}

export interface ConstructChatTokenEvent {
  type: "token";
  token: string;
  index: number;
}

export interface ConstructChatDoneEvent {
  type: "done";
  messageId: string;
  totalTokens: number;
  construct: Construct;
  artifact: Artifact;
  generation: ConstructChatResponse["generation"];
  runtime?: {
    mode: string;
    status: string;
    detail: string;
    modelId?: string;
    device?: string;
    loaded?: boolean;
    diagnostics?: Record<string, unknown>;
  };
}

export interface ConstructChatErrorEvent {
  type: "error";
  message: string;
}

export type ConstructChatStreamEvent =
  | ConstructChatTokenEvent
  | ConstructChatDoneEvent
  | ConstructChatErrorEvent;

export interface AcademyLesson {
  id: string;
  title: string;
  concept: string;
  difficulty: LearningDifficulty;
  progress: number;
}

export interface AcademyConcept {
  id: string;
  title: string;
  concept: string;
  shortExplanation: string;
  relatedStations: string[];
}

export interface AcademyAction {
  id: string;
  station: NavigationSection;
  action: string;
  label: string;
  conceptId: string;
  tooltipTitle: string;
  tooltipBody: string;
}

export interface RuntimeMetric {
  id: string;
  label: string;
  value: number;
  ideal?: number;
  state?: "idle" | "ready" | "active" | "warning";
  description?: string;
}

export interface DashboardSummary {
  workshop: Workshop;
  currentArtifact: Artifact;
  construct: Construct;
  forgeQueue: ForgeRun[];
  academyLesson: AcademyLesson;
  runtimeMetrics: RuntimeMetric[];
}
