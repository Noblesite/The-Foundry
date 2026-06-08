export type NavigationSection =
  | "workshop"
  | "materials"
  | "forge"
  | "artifacts"
  | "construct"
  | "library"
  | "academy"
  | "settings";

export type TrainingMethod = "LoRA" | "QLoRA";
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
export type TrialStatus = "not-started" | "running" | "passed" | "failed";
export type LearningDifficulty = "starter" | "builder" | "advanced";

export interface WorkspaceSettings {
  huggingFaceToken: string;
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

export interface RuntimeMetric {
  id: string;
  label: string;
  value: number;
}

export interface DashboardSummary {
  workshop: Workshop;
  currentArtifact: Artifact;
  construct: Construct;
  forgeQueue: ForgeRun[];
  academyLesson: AcademyLesson;
  runtimeMetrics: RuntimeMetric[];
}
