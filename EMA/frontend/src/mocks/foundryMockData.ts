import {
  AcademyLesson,
  Artifact,
  Construct,
  DashboardSummary,
  ForgeRun,
  FoundryNavigationItem,
  LibraryIndex,
  MaterialSet,
  NavigationSection,
  RuntimeMetric,
  SectionSummary,
  Workshop,
  WorkspaceSettings,
} from "../domain/foundry";

export const defaultWorkspaceSettings: WorkspaceSettings = {
  huggingFaceToken: "",
  modelName: "mistralai/Mistral-7B-Instruct-v0.2",
  subjectMatter: "Paw Patrol",
  characterVoice: "Marshall",
  sourceDirectory: "runtime/materials/sources",
  outputDirectory: "runtime/materials/qa_pairs",
  contextWindow: 8192,
  maxNewTokens: 512,
  temperature: 0.7,
  topP: 0.9,
  qaPairsPerSource: 24,
  trainingMethod: "QLoRA",
  epochs: 3,
  learningRate: "2e-4",
  loadIn4Bit: true,
  enableStreaming: true,
  constructRuntimeMode: "simulated",
  constructModelId: "mistralai/Mistral-7B-Instruct-v0.2",
  constructDevice: "auto",
};

export const foundryNavigationItems: FoundryNavigationItem[] = [
  { id: "workshop", label: "Workshop", icon: "fa-screwdriver-wrench" },
  { id: "materials", label: "Materials", icon: "fa-box-archive" },
  { id: "forge", label: "Forge", icon: "fa-fire-flame-curved" },
  { id: "artifacts", label: "Artifacts", icon: "fa-cubes" },
  { id: "construct", label: "Construct", icon: "fa-play" },
  { id: "library", label: "Library", icon: "fa-book-open" },
  { id: "academy", label: "Academy", icon: "fa-graduation-cap" },
  { id: "settings", label: "Settings", icon: "fa-gear" },
];

export const mockWorkshop: Workshop = {
  id: "wrk-marshall-001",
  name: "Paw Patrol Workshop",
  subject: "Paw Patrol",
  voiceTarget: "Marshall",
  status: "forging",
  progress: 72,
  materialRefinement: 51,
  activeArtifactId: "art-marshall-123",
  activeConstructId: "con-marshall-local",
};

export const mockMaterialSet: MaterialSet = {
  id: "mat-paw-patrol-core",
  workshopId: mockWorkshop.id,
  name: "Marshall Source Materials",
  sourceCount: 18,
  chunkCount: 1248,
  qaPairCount: 642,
  sources: [
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
  ],
};

export const mockForgeRuns: ForgeRun[] = [
  {
    id: "frg-lora-001",
    workshopId: mockWorkshop.id,
    label: "LoRA Training",
    method: "LoRA",
    status: "running",
    progress: 45,
    epoch: { current: 2, total: 3 },
  },
  {
    id: "frg-qa-001",
    workshopId: mockWorkshop.id,
    label: "QA Generation",
    method: "QA Generation",
    status: "running",
    progress: 87,
  },
];

export const mockArtifact: Artifact = {
  id: mockWorkshop.activeArtifactId,
  workshopId: mockWorkshop.id,
  name: "Marshall Model",
  version: "v1.2.3",
  baseModel: defaultWorkspaceSettings.modelName,
  status: "ready",
  trainingMethod: defaultWorkspaceSettings.trainingMethod,
  trialScore: 82,
};

export const mockConstruct: Construct = {
  id: mockWorkshop.activeConstructId,
  workshopId: mockWorkshop.id,
  name: "Marshall Local Construct",
  artifactId: mockArtifact.id,
  status: "streaming",
  streamingEnabled: true,
  contextWindow: defaultWorkspaceSettings.contextWindow,
  maxNewTokens: defaultWorkspaceSettings.maxNewTokens,
  temperature: defaultWorkspaceSettings.temperature,
};

export const mockLibraryIndex: LibraryIndex = {
  id: "lib-marshall-memory",
  workshopId: mockWorkshop.id,
  name: "Marshall Library",
  embeddingModel: "MiniLM",
  indexedChunks: mockMaterialSet.chunkCount,
  recallScore: 82,
};

export const mockAcademyLesson: AcademyLesson = {
  id: "acd-attention-layers",
  title: "Understanding Attention Layers",
  concept: "attention",
  difficulty: "builder",
  progress: 64,
};

export const mockRuntimeMetrics: RuntimeMetric[] = [
  { id: "gpu", label: "GPU Usage", value: 75 },
  { id: "gpu-memory", label: "GPU Memory Usage", value: 60 },
  { id: "cpu", label: "CPU Usage", value: 40 },
  { id: "memory", label: "Memory Usage", value: 85 },
  { id: "storage", label: "Storage Usage", value: 30 },
  { id: "context", label: "Context Window Usage", value: 50 },
];

export const mockDashboardSummary: DashboardSummary = {
  workshop: mockWorkshop,
  currentArtifact: mockArtifact,
  construct: mockConstruct,
  forgeQueue: mockForgeRuns,
  academyLesson: mockAcademyLesson,
  runtimeMetrics: mockRuntimeMetrics,
};

export const foundrySectionSummaries: Record<
  Exclude<NavigationSection, "workshop" | "settings" | "construct">,
  SectionSummary
> = {
  materials: {
    eyebrow: "Raw inputs",
    title: "Materials",
    body: "Upload transcripts, PDFs, CSV files, websites, and other source material before the Assembly Line turns them into model-ready examples.",
    stats: [
      { label: "Sources staged", value: String(mockMaterialSet.sourceCount) },
      { label: "Chunks prepared", value: mockMaterialSet.chunkCount.toLocaleString() },
      { label: "QA pairs", value: mockMaterialSet.qaPairCount.toLocaleString() },
    ],
    concept: {
      title: "Why Materials matter",
      body: "Materials define what the model can learn. Better sources create better examples, cleaner retrieval, and safer fine tuning.",
    },
  },
  forge: {
    eyebrow: "Training floor",
    title: "Forge",
    body: "Configure LoRA and QLoRA runs, watch training progress, and learn what each training metric is telling you.",
    stats: [
      { label: "Active Forges", value: String(mockForgeRuns.length) },
      { label: "Adapter method", value: defaultWorkspaceSettings.trainingMethod },
      { label: "Epoch", value: "2 / 3" },
    ],
    concept: {
      title: "What is LoRA?",
      body: "LoRA trains small update matrices instead of changing every model weight, making fine-tuning faster and more memory efficient.",
    },
  },
  artifacts: {
    eyebrow: "Models out",
    title: "Artifacts",
    body: "Compare trained adapters, checkpoints, quantized builds, and model cards before promoting one into a Construct.",
    stats: [
      { label: "Latest", value: `${mockArtifact.name} ${mockArtifact.version}` },
      { label: "Trials passed", value: "8 / 10" },
      { label: "Ready", value: "1 Artifact" },
    ],
    concept: {
      title: "What is an Artifact?",
      body: "An Artifact is a saved model state, adapter, or checkpoint that can be evaluated, compared, archived, and loaded into a Construct.",
    },
  },
  library: {
    eyebrow: "Retrieval shelf",
    title: "Library",
    body: "Inspect indexed knowledge, embeddings, citations, and retrieval quality for Library-augmented Constructs.",
    stats: [
      { label: "Indexed chunks", value: mockLibraryIndex.indexedChunks.toLocaleString() },
      { label: "Embedding model", value: mockLibraryIndex.embeddingModel },
      { label: "Recall trial", value: `${mockLibraryIndex.recallScore}%` },
    ],
    concept: {
      title: "Why retrieval exists",
      body: "The Library lets a Construct look up source-grounded context instead of relying only on weights learned during training.",
    },
  },
  academy: {
    eyebrow: "Learn as you build",
    title: "Academy",
    body: "Short lessons, diagrams, token previews, and metric explainers appear exactly where they help the build make sense.",
    stats: [
      { label: "Active lesson", value: mockAcademyLesson.title },
      { label: "Concepts viewed", value: "14" },
      { label: "Lab mode", value: "Ready" },
    ],
    concept: {
      title: "Learning is part of the build",
      body: "The Academy attaches concepts to real actions, so users learn tokenization, embeddings, attention, and fine tuning while doing the work.",
    },
  },
};
