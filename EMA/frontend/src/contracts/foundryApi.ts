import {
  ArtifactStatus,
  AssemblyLineStatus,
  ConstructStatus,
  ConstructChatResponse,
  ConstructRuntimeProbeResult,
  ConstructChatTokenEvent,
  ConstructChatDoneEvent,
  ConstructChatErrorEvent,
  ConstructChatStreamEvent,
  ConstructDiagnosticsBundleExport,
  ConstructRuntimeHistoryExport,
  ConstructRuntimeValidationExport,
  ConstructRuntimeValidationPage,
  ConstructRuntimeValidation,
  ConstructRuntimePreflightResult,
  ForgeTrainingContract,
  ForgeLocalTrainerPreflightResult,
  ForgeSmokeProofResult,
  QAGeneratorRuntime,
  QAGeneratorQualityProof,
  QAGeneratorSmokeProof,
  ForgePurpose,
  ForgeWorkerReconcileResult,
  ForgeWorkerState,
  ForgeRunStatus,
  MaterialSource,
  MaterialKind,
  MaterialStatus,
  QAReviewStatus,
  ModelArchiveEntry,
  ModelDownloadJob,
  ModelPlatformProfile,
  ModelSearchResult,
  TrainingMethod,
  Trial,
  TrialVerdict,
  NavigationSection,
  WorkshopStatus,
} from "../domain/foundry";

export const FOUNDRY_API_VERSION = "/api/v1";

export const foundryApiRoutes = {
  status: `${FOUNDRY_API_VERSION}/foundry/status`,
  bootstrap: `${FOUNDRY_API_VERSION}/foundry/bootstrap`,
  dashboard: `${FOUNDRY_API_VERSION}/foundry/dashboard`,
  navigation: `${FOUNDRY_API_VERSION}/foundry/navigation`,
  sectionSummaries: `${FOUNDRY_API_VERSION}/foundry/sections`,
  uiCatalog: `${FOUNDRY_API_VERSION}/foundry/ui-catalog`,
  workshops: `${FOUNDRY_API_VERSION}/workshops`,
  workshop: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}`,
  materials: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/materials`,
  importMaterialFile: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/materials/import-file`,
  assemblyLines: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/assembly-lines`,
  chunks: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/chunks`,
  qaPairs: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/qa-pairs`,
  qaPair: (workshopId: string, qaPairId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/qa-pairs/${qaPairId}`,
  exportQAPairs: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/qa-pairs/export`,
  exportTrials: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/trials/export`,
  forgeRuns: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/forges`,
  forgeRun: (forgeRunId: string) => `${FOUNDRY_API_VERSION}/forges/${forgeRunId}`,
  forgeContract: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/contract`,
  forgeEvents: (forgeRunId: string) => `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/events`,
  reconcileForgeWorker: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/worker/reconcile`,
  preflightLocalForgeWorker: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/worker/preflight-local`,
  runLocalForgeWorker: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/worker/run-local`,
  simulateForgeRun: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/simulate`,
  exportEvaluationWeakSamples: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/evaluation/weak-samples/export`,
  forgeRuntime: `${FOUNDRY_API_VERSION}/forges/runtime`,
  configureForgeRuntime: `${FOUNDRY_API_VERSION}/forges/runtime/configure`,
  runForgeSmokeProof: `${FOUNDRY_API_VERSION}/forges/smoke-proof`,
  qaGeneratorRuntime: `${FOUNDRY_API_VERSION}/assembly-line/qa-generator/runtime`,
  configureQAGeneratorRuntime: `${FOUNDRY_API_VERSION}/assembly-line/qa-generator/runtime/configure`,
  runQAGeneratorSmokeProof: `${FOUNDRY_API_VERSION}/assembly-line/qa-generator/smoke-proof`,
  runQAGeneratorQualityProof: `${FOUNDRY_API_VERSION}/assembly-line/qa-generator/quality-proof`,
  artifacts: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/artifacts`,
  artifact: (artifactId: string) => `${FOUNDRY_API_VERSION}/artifacts/${artifactId}`,
  constructs: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/constructs`,
  loadArtifactIntoConstruct: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/constructs/load-artifact`,
  constructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime`,
  configureConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/configure`,
  loadConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/load`,
  preflightConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/preflight`,
  probeConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/probe`,
  unloadConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/unload`,
  releaseConstructRuntimeMemory: `${FOUNDRY_API_VERSION}/constructs/runtime/release-memory`,
  constructRuntimeEvents: `${FOUNDRY_API_VERSION}/constructs/runtime/events`,
  exportConstructRuntimeEvents: `${FOUNDRY_API_VERSION}/constructs/runtime/events/export`,
  clearConstructRuntimeEvents: `${FOUNDRY_API_VERSION}/constructs/runtime/events/clear`,
  constructRuntimeValidations: `${FOUNDRY_API_VERSION}/constructs/runtime/validations`,
  exportConstructRuntimeValidations: `${FOUNDRY_API_VERSION}/constructs/runtime/validations/export`,
  exportConstructRuntimeDiagnostics: `${FOUNDRY_API_VERSION}/constructs/runtime/diagnostics/export`,
  modelArchive: `${FOUNDRY_API_VERSION}/archive/models`,
  testHuggingFaceAuth: `${FOUNDRY_API_VERSION}/archive/huggingface/auth/test`,
  searchArchiveModels: `${FOUNDRY_API_VERSION}/archive/models/search`,
  preflightArchiveModel: `${FOUNDRY_API_VERSION}/archive/models/preflight`,
  inspectArchiveModel: `${FOUNDRY_API_VERSION}/archive/models/inspect`,
  registerArchiveModel: `${FOUNDRY_API_VERSION}/archive/models/register`,
  downloadArchiveModel: `${FOUNDRY_API_VERSION}/archive/models/download`,
  evictArchiveModel: `${FOUNDRY_API_VERSION}/archive/models/evict`,
  startModelDownloadJob: `${FOUNDRY_API_VERSION}/archive/models/download-jobs`,
  modelDownloadJobs: `${FOUNDRY_API_VERSION}/archive/models/download-jobs`,
  modelDownloadJob: (jobId: string) =>
    `${FOUNDRY_API_VERSION}/archive/models/download-jobs/${jobId}`,
  cancelModelDownloadJob: (jobId: string) =>
    `${FOUNDRY_API_VERSION}/archive/models/download-jobs/${jobId}/cancel`,
  construct: (constructId: string) => `${FOUNDRY_API_VERSION}/constructs/${constructId}`,
  constructChat: (constructId: string) =>
    `${FOUNDRY_API_VERSION}/constructs/${constructId}/chat`,
  constructStream: (constructId: string) =>
    `${FOUNDRY_API_VERSION}/constructs/${constructId}/chat/stream`,
  library: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/library`,
  trials: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/trials`,
  academyConcepts: `${FOUNDRY_API_VERSION}/academy/concepts`,
  academyActions: `${FOUNDRY_API_VERSION}/academy/actions`,
} as const;

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

export interface ClearConstructRuntimeEventsDto {
  deletedCount: number;
  clearedAt: string;
}

export type ExportConstructRuntimeEventsDto = ConstructRuntimeHistoryExport;
export type ConstructRuntimeValidationDto = ConstructRuntimeValidation;
export type ConstructRuntimeValidationPageDto = ConstructRuntimeValidationPage;
export type ExportConstructRuntimeValidationsDto = ConstructRuntimeValidationExport;
export type ExportConstructDiagnosticsBundleDto = ConstructDiagnosticsBundleExport;

export interface WorkshopDto {
  id: string;
  name: string;
  subject: string;
  voiceTarget: string;
  status: WorkshopStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialSourceDto {
  id: string;
  workshopId: string;
  name: string;
  kind: MaterialKind;
  status: MaterialStatus;
  sourceUri: string;
  chunkCount: number;
  qaPairCount: number;
  createdAt: string;
}

export interface AssemblyLineRunDto {
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

export interface MaterialChunkDto {
  id: string;
  workshopId: string;
  materialId: string;
  assemblyLineRunId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

export interface QAPairDto {
  id: string;
  workshopId: string;
  materialId: string;
  chunkId: string;
  assemblyLineRunId: string;
  question: string;
  answer: string;
  generatorModel?: string;
  confidence?: number;
  generationMetadata?: Record<string, unknown>;
  qualityGate?: {
    status: "passed" | "blocked" | string;
    reasons: string[];
    confidenceThreshold: number;
  };
  reviewStatus: QAReviewStatus;
  reviewedAt?: string | null;
}

export interface ExportQAPairsDto {
  material: MaterialSource;
  exportUri: string;
  format: "jsonl";
  qaPairCount: number;
  assemblyLineRunId: string;
  qualityGate?: {
    status: "passed" | "override" | string;
    checkedRows: number;
    blockedRows: number;
    confidenceThreshold: number;
    override: boolean;
  };
}

export interface ExportTrialsDto {
  material: MaterialSource;
  exportUri: string;
  format: "jsonl";
  trialCount: number;
  verdicts: TrialVerdict[];
}

export interface ExportEvaluationSamplesDto {
  material: MaterialSource;
  exportUri: string;
  format: "jsonl";
  sampleCount: number;
  verdicts: TrialVerdict[];
  forgeRunId: string;
}

export interface ForgeRunDto {
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
  epochCurrent?: number;
  epochTotal?: number;
  createdAt: string;
  updatedAt: string;
  trainingContract?: ForgeTrainingContract;
  workerState?: ForgeWorkerState;
}

export type ForgeWorkerReconcileDto = ForgeWorkerReconcileResult;
export type ForgeLocalTrainerPreflightDto = ForgeLocalTrainerPreflightResult;
export type ForgeSmokeProofDto = ForgeSmokeProofResult;
export type QAGeneratorRuntimeDto = QAGeneratorRuntime;
export type QAGeneratorSmokeProofDto = QAGeneratorSmokeProof;
export type QAGeneratorQualityProofDto = QAGeneratorQualityProof;

export interface ForgeSmokeProofRequest {
  runTraining: boolean;
}

export interface ArtifactDto {
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
  createdAt: string;
}

export interface ConstructDto {
  id: string;
  workshopId: string;
  artifactId: string;
  name: string;
  status: ConstructStatus;
  streamingEnabled: boolean;
  contextWindow: number;
  maxNewTokens: number;
  temperature: number;
}

export type TrialDto = Trial;

export interface AcademyConceptDto {
  id: string;
  title: string;
  concept: string;
  shortExplanation: string;
  relatedStations: string[];
}

export interface AcademyActionDto {
  id: string;
  station: NavigationSection;
  action: string;
  label: string;
  conceptId: string;
  tooltipTitle: string;
  tooltipBody: string;
}

export interface CreateWorkshopRequest {
  name: string;
  subject: string;
  voiceTarget?: string;
  baseModel?: string;
}

export interface IngestMaterialRequest {
  name: string;
  kind: MaterialKind;
  sourceUri: string;
  metadata?: Record<string, string>;
}

export interface ImportMaterialFileRequest {
  name: string;
  kind: Exclude<MaterialKind, "website">;
  file: File;
}

export interface StartAssemblyLineRequest {
  materialSourceIds: string[];
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  qaPairsPerSource: number;
}

export interface ConfigureQAGeneratorRuntimeRequest {
  mode: "deterministic" | "transformers";
  modelId: string;
  maxNewTokens: number;
  temperature: number;
}

export interface ExportQAPairsRequest {
  assemblyLineRunId: string;
  name?: string;
  includeDrafts?: boolean;
  includeLowQuality?: boolean;
}

export interface UpdateQAPairReviewRequest {
  question: string;
  answer: string;
  reviewStatus: QAReviewStatus;
}

export interface StartForgeRequest {
  materialSetId: string;
  baseModel: string;
  method: TrainingMethod;
  purpose: ForgePurpose;
  epochs: number;
  learningRate: string;
  loadIn4Bit: boolean;
}

export interface ConfigureForgeRuntimeRequest {
  mode: "simulated" | "local";
  worker?: string;
}

export interface CreateConstructRequest {
  artifactId: string;
  name: string;
  streamingEnabled: boolean;
  contextWindow: number;
  maxNewTokens: number;
  temperature: number;
}

export interface LoadArtifactIntoConstructRequest {
  artifactId: string;
}

export interface CreateTrialRequest {
  artifactId: string;
  constructId: string;
  messageId: string;
  prompt: string;
  response: string;
  verdict: TrialVerdict;
  runtimeMode: string;
  tokenCount: number;
  generationSettings: Record<string, unknown>;
}

export interface ExportTrialsRequest {
  trialIds: string[];
  verdicts?: TrialVerdict[];
  name?: string;
}

export interface ExportEvaluationSamplesRequest {
  name?: string;
  samples?: Array<{
    instruction: string;
    expected: string;
    observed: string;
    verdict: Exclude<TrialVerdict, "pass">;
    note: string;
  }>;
}

export interface ConfigureConstructRuntimeRequest {
  mode: "simulated" | "transformers";
  modelId?: string;
  device: "auto" | "cpu" | "cuda" | "mps";
}

export interface LoadConstructRuntimeRequest {
  modelId?: string;
}

export interface PreflightConstructRuntimeRequest {
  modelId: string;
  device: "auto" | "cpu" | "cuda" | "mps";
}

export interface ProbeConstructRuntimeRequest {
  modelId: string;
  prompt: string;
  maxNewTokens: number;
  device: "auto" | "cpu" | "cuda" | "mps";
}

export interface SearchArchiveModelsRequest {
  query?: string;
  pipelineTag?: string;
  sort?: "downloads" | "likes" | "lastModified";
  limit?: number;
  includeGated?: boolean;
  username?: string;
  token?: string;
}

export interface InspectArchiveModelRequest {
  repoId: string;
  revision?: string;
  username?: string;
  token?: string;
}

export interface TestHuggingFaceAuthRequest {
  username?: string;
  token?: string;
}

export interface HuggingFaceAuthCheckDto {
  ok: boolean;
  provider: "huggingface" | string;
  username?: string | null;
  resolvedUsername?: string | null;
  tokenPresent: boolean;
  usernameMatches: boolean;
  accessLevel: string;
  message: string;
}

export interface ArchiveModelSearchDto {
  models: ModelSearchResult[];
  platform: ModelPlatformProfile;
}

export interface ArchiveModelPreflightDto {
  ok: boolean;
  canDownload: boolean;
  visibility: "public" | "gated" | "private" | "unknown";
  model: ModelSearchResult;
  platform: ModelPlatformProfile;
  fitEstimate: ModelSearchResult["fitEstimate"];
  estimatedDownloadBytes: number;
  auth: {
    username?: string | null;
    tokenPresent: boolean;
  };
  message: string;
}

export interface ArchiveModelInspectDto {
  model: ModelSearchResult;
  platform: ModelPlatformProfile;
}

export interface ArchiveModelRegisterDto extends ArchiveModelInspectDto {
  archiveEntry: ModelArchiveEntry;
}

export type ArchiveModelDownloadDto = ArchiveModelRegisterDto;
export interface ArchiveModelEvictDto {
  archiveEntry: ModelArchiveEntry;
}
export type ModelDownloadJobDto = ModelDownloadJob;

export interface ConstructChatRequest {
  conversationId: string;
  message: string;
  systemPrompt?: string;
  includeLibraryContext: boolean;
  maxNewTokens?: number;
  temperature?: number;
}

export type ConstructChatResponseDto = ConstructChatResponse;
export type ConstructRuntimePreflightDto = ConstructRuntimePreflightResult;
export type ConstructRuntimeProbeDto = ConstructRuntimeProbeResult;

export type ConstructChatTokenEventDto = ConstructChatTokenEvent;
export type ConstructChatDoneEventDto = ConstructChatDoneEvent;
export type ConstructChatErrorEventDto = ConstructChatErrorEvent;
export type ConstructChatStreamEventDto = ConstructChatStreamEvent;
