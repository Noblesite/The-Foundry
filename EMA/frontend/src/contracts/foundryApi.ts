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
  ForgeTrainingContract,
  ForgePurpose,
  ForgeWorkerReconcileResult,
  ForgeWorkerState,
  ForgeRunStatus,
  MaterialSource,
  MaterialKind,
  MaterialStatus,
  TrainingMethod,
  Trial,
  TrialVerdict,
  NavigationSection,
  WorkshopStatus,
} from "../domain/foundry";

export const FOUNDRY_API_VERSION = "/api/v1";

export const foundryApiRoutes = {
  bootstrap: `${FOUNDRY_API_VERSION}/foundry/bootstrap`,
  dashboard: `${FOUNDRY_API_VERSION}/foundry/dashboard`,
  navigation: `${FOUNDRY_API_VERSION}/foundry/navigation`,
  sectionSummaries: `${FOUNDRY_API_VERSION}/foundry/sections`,
  uiCatalog: `${FOUNDRY_API_VERSION}/foundry/ui-catalog`,
  workshops: `${FOUNDRY_API_VERSION}/workshops`,
  workshop: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}`,
  materials: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/materials`,
  assemblyLines: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/assembly-lines`,
  chunks: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/chunks`,
  qaPairs: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/qa-pairs`,
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
  simulateForgeRun: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/simulate`,
  exportEvaluationWeakSamples: (forgeRunId: string) =>
    `${FOUNDRY_API_VERSION}/forges/${forgeRunId}/evaluation/weak-samples/export`,
  forgeRuntime: `${FOUNDRY_API_VERSION}/forges/runtime`,
  configureForgeRuntime: `${FOUNDRY_API_VERSION}/forges/runtime/configure`,
  artifacts: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/artifacts`,
  artifact: (artifactId: string) => `${FOUNDRY_API_VERSION}/artifacts/${artifactId}`,
  constructs: (workshopId: string) => `${FOUNDRY_API_VERSION}/workshops/${workshopId}/constructs`,
  loadArtifactIntoConstruct: (workshopId: string) =>
    `${FOUNDRY_API_VERSION}/workshops/${workshopId}/constructs/load-artifact`,
  constructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime`,
  configureConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/configure`,
  loadConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/load`,
  probeConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/probe`,
  unloadConstructRuntime: `${FOUNDRY_API_VERSION}/constructs/runtime/unload`,
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
}

export interface ExportQAPairsDto {
  material: MaterialSource;
  exportUri: string;
  format: "jsonl";
  qaPairCount: number;
  assemblyLineRunId: string;
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

export interface StartAssemblyLineRequest {
  materialSourceIds: string[];
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  qaPairsPerSource: number;
}

export interface ExportQAPairsRequest {
  assemblyLineRunId: string;
  name?: string;
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

export interface ProbeConstructRuntimeRequest {
  modelId: string;
  prompt: string;
  maxNewTokens: number;
  device: "auto" | "cpu" | "cuda" | "mps";
}

export interface ConstructChatRequest {
  conversationId: string;
  message: string;
  systemPrompt?: string;
  includeLibraryContext: boolean;
  maxNewTokens?: number;
  temperature?: number;
}

export type ConstructChatResponseDto = ConstructChatResponse;
export type ConstructRuntimeProbeDto = ConstructRuntimeProbeResult;

export type ConstructChatTokenEventDto = ConstructChatTokenEvent;
export type ConstructChatDoneEventDto = ConstructChatDoneEvent;
export type ConstructChatErrorEventDto = ConstructChatErrorEvent;
export type ConstructChatStreamEventDto = ConstructChatStreamEvent;
