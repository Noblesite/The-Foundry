import { AcademyAction, AcademyConcept } from "./foundry";

export const ACADEMY_CONCEPT_IDS = {
  attention: "attention",
  chunking: "chunking",
  evaluation: "evaluation",
  foundryLoop: "foundry-loop",
  memoryManagement: "memory-management",
  qaGeneration: "qa-generation",
  qaQualityGate: "qa-quality-gate",
  trainingAdapters: "training-adapters",
  artifactReadiness: "artifact-readiness",
  runtimeEvidence: "runtime-evidence",
  sourceIngestion: "source-ingestion",
  trialComparison: "trial-comparison",
  weakSampleReview: "weak-sample-review",
} as const;

export const ACADEMY_ACTION_IDS = {
  dashboardResumeLesson: "dashboard.resume-lesson",
  dashboardLearningLoop: "dashboard.learning-loop",
  constructRuntimeLoading: "construct.runtime-loading",
  constructAdapterEvidence: "construct.adapter-evidence",
  constructMemoryCleanup: "construct.memory-cleanup",
  materialsOpenAssemblyLine: "materials.open-assembly-line",
  materialsSourceIngestion: "materials.source-ingestion",
  materialsChunking: "materials.chunking",
  materialsQAGeneration: "materials.qa-generation",
  materialsQAQualityGate: "materials.qa-quality-gate",
  forgeOpenTraining: "forge.open-training",
  forgeTrainingMethod: "forge.training-method",
  forgeAdapterBoundary: "forge.adapter-boundary",
  forgeProofMode: "forge.proof-mode",
  artifactsOpenPromotion: "artifacts.open-promotion",
  artifactsReadiness: "artifacts.readiness",
  artifactsPromotionGate: "artifacts.promotion-gate",
  trialsOpenEvaluation: "trials.open-evaluation",
  trialsRuntimeSources: "trials.runtime-sources",
  trialsComparePrompts: "trials.compare-prompts",
  trialsReviewWeakSamples: "trials.review-weak-samples",
} as const;

export const defaultAcademyConcepts: AcademyConcept[] = [
  {
    id: "acd-attention-layers",
    title: "Understanding Attention Layers",
    concept: ACADEMY_CONCEPT_IDS.attention,
    shortExplanation:
      "Attention helps a model weigh which tokens matter most when it predicts the next token.",
    relatedStations: ["academy", "forge", "construct"],
  },
  {
    id: "acd-evaluation",
    title: "Evaluation",
    concept: ACADEMY_CONCEPT_IDS.evaluation,
    shortExplanation:
      "Evaluation compares model replies against reviewed examples before you promote an Artifact.",
    relatedStations: ["trials", "forge", "artifacts"],
  },
  {
    id: "acd-foundry-loop",
    title: "The Foundry Loop",
    concept: ACADEMY_CONCEPT_IDS.foundryLoop,
    shortExplanation:
      "The Foundry loop shows how raw source material becomes reviewed QA, training data, a Forge run, an Artifact, a Construct, and finally Trial evidence.",
    relatedStations: ["workshop", "materials", "forge", "artifacts", "construct", "trials"],
  },
  {
    id: "acd-source-ingestion",
    title: "Source Ingestion",
    concept: ACADEMY_CONCEPT_IDS.sourceIngestion,
    shortExplanation:
      "Source ingestion copies files or snapshots webpages into controlled storage so later chunks and QA rows can cite stable evidence.",
    relatedStations: ["materials", "library", "forge"],
  },
  {
    id: "acd-chunking",
    title: "Chunking",
    concept: ACADEMY_CONCEPT_IDS.chunking,
    shortExplanation:
      "Chunking splits source text into overlapping windows small enough for the QA generator to read while preserving source references.",
    relatedStations: ["materials", "forge", "academy"],
  },
  {
    id: "acd-qa-generation",
    title: "QA Generation",
    concept: ACADEMY_CONCEPT_IDS.qaGeneration,
    shortExplanation:
      "QA generation turns source chunks into question and answer examples that can become training Material after human review.",
    relatedStations: ["materials", "forge", "trials"],
  },
  {
    id: "acd-qa-quality-gate",
    title: "QA Quality Gate",
    concept: ACADEMY_CONCEPT_IDS.qaQualityGate,
    shortExplanation:
      "The QA quality gate checks grounding, confidence, triviality, and source coverage before rows become Forge-ready JSONL.",
    relatedStations: ["materials", "forge", "trials"],
  },
  {
    id: "acd-training-adapters",
    title: "Training Adapters",
    concept: ACADEMY_CONCEPT_IDS.trainingAdapters,
    shortExplanation:
      "LoRA and QLoRA train compact adapter weights instead of rewriting every base-model parameter.",
    relatedStations: ["forge", "artifacts", "construct"],
  },
  {
    id: "acd-artifact-readiness",
    title: "Artifact Readiness",
    concept: ACADEMY_CONCEPT_IDS.artifactReadiness,
    shortExplanation:
      "Artifact readiness checks whether the saved output has loadable files, trainer evidence, and base-model compatibility.",
    relatedStations: ["artifacts", "forge", "construct"],
  },
  {
    id: "acd-weak-sample-review",
    title: "Weak Sample Review",
    concept: ACADEMY_CONCEPT_IDS.weakSampleReview,
    shortExplanation:
      "Weak sample review turns failed and needs-work replies into corrected Material for the next Forge.",
    relatedStations: ["trials", "materials", "forge"],
  },
  {
    id: "acd-runtime-evidence",
    title: "Runtime Evidence",
    concept: ACADEMY_CONCEPT_IDS.runtimeEvidence,
    shortExplanation:
      "Runtime evidence records whether a reply came from simulation, a base model, or an adapter-backed Artifact.",
    relatedStations: ["construct", "trials", "artifacts"],
  },
  {
    id: "acd-memory-management",
    title: "Runtime Memory Management",
    concept: ACADEMY_CONCEPT_IDS.memoryManagement,
    shortExplanation:
      "Memory cleanup releases model references and asks the local runtime to clear CPU, CUDA, or Apple Silicon accelerator caches.",
    relatedStations: ["construct", "settings", "archive"],
  },
  {
    id: "acd-trial-comparison",
    title: "Prompt Comparison",
    concept: ACADEMY_CONCEPT_IDS.trialComparison,
    shortExplanation:
      "Prompt comparison repeats the same test across Artifacts and runtime modes so users can see whether behavior actually improved.",
    relatedStations: ["trials", "construct", "forge"],
  },
];

export const defaultAcademyActions: AcademyAction[] = [
  {
    id: ACADEMY_ACTION_IDS.dashboardResumeLesson,
    station: "workshop",
    action: "resume-lesson",
    label: "Resume Lesson",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why attention now?",
    tooltipBody:
      "Attention is the first layer-level concept to understand because it explains how prompts steer the next generated token.",
  },
  {
    id: ACADEMY_ACTION_IDS.dashboardLearningLoop,
    station: "workshop",
    action: "explain-foundry-loop",
    label: "Learn the loop",
    conceptId: ACADEMY_CONCEPT_IDS.foundryLoop,
    tooltipTitle: "Where am I in the loop?",
    tooltipBody:
      "The loop map tracks the journey from source Material through Assembly Line, QA Review, JSONL, Forge, Artifact, Construct, and Trial evidence.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsOpenAssemblyLine,
    station: "materials",
    action: "open-assembly-line",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why Materials matter",
    tooltipBody:
      "Materials become chunks and examples. Cleaner inputs make every later training and evaluation step easier to trust.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsSourceIngestion,
    station: "materials",
    action: "explain-source-ingestion",
    label: "Learn ingestion",
    conceptId: ACADEMY_CONCEPT_IDS.sourceIngestion,
    tooltipTitle: "Why snapshot source material?",
    tooltipBody:
      "The Foundry stores a controlled copy or website snapshot so every chunk, QA row, and exported JSONL line can point back to stable source evidence.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsChunking,
    station: "materials",
    action: "explain-chunking",
    label: "Learn chunking",
    conceptId: ACADEMY_CONCEPT_IDS.chunking,
    tooltipTitle: "What is chunking?",
    tooltipBody:
      "Chunking breaks long source material into overlapping token windows. Overlap helps preserve context at boundaries, but too much overlap can create duplicate QA rows.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsQAGeneration,
    station: "materials",
    action: "explain-qa-generation",
    label: "Learn QA generation",
    conceptId: ACADEMY_CONCEPT_IDS.qaGeneration,
    tooltipTitle: "What is QA generation?",
    tooltipBody:
      "QA generation reads source chunks and drafts training examples. Deterministic mode is for smoke tests; model-backed mode is the path for higher-quality, context-aware examples.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsQAQualityGate,
    station: "materials",
    action: "explain-qa-quality-gate",
    label: "Learn quality gates",
    conceptId: ACADEMY_CONCEPT_IDS.qaQualityGate,
    tooltipTitle: "Why can QA rows be blocked?",
    tooltipBody:
      "The quality gate blocks rows with weak grounding, low confidence, trivial questions, unsupported QA types, or deterministic fallback output before they reach Forge.",
  },
  {
    id: ACADEMY_ACTION_IDS.constructRuntimeLoading,
    station: "construct",
    action: "explain-runtime-loading",
    label: "Learn runtime loading",
    conceptId: ACADEMY_CONCEPT_IDS.runtimeEvidence,
    tooltipTitle: "What is runtime loading?",
    tooltipBody:
      "Runtime loading places a cached base model, and sometimes an adapter, into local memory so Construct can stream real tokens instead of simulated output.",
  },
  {
    id: ACADEMY_ACTION_IDS.constructAdapterEvidence,
    station: "construct",
    action: "explain-adapter-evidence",
    label: "Learn adapters",
    conceptId: ACADEMY_CONCEPT_IDS.runtimeEvidence,
    tooltipTitle: "What does adapter loaded mean?",
    tooltipBody:
      "An adapter-backed Construct uses the base model plus the LoRA Artifact produced by Forge. This is the live path you want before judging whether training changed behavior.",
  },
  {
    id: ACADEMY_ACTION_IDS.constructMemoryCleanup,
    station: "construct",
    action: "explain-memory-cleanup",
    label: "Learn memory cleanup",
    conceptId: ACADEMY_CONCEPT_IDS.memoryManagement,
    tooltipTitle: "Why release memory?",
    tooltipBody:
      "Releasing memory clears cached model references and asks Python, CUDA, or Apple Silicon Metal/MPS caches to free space before another model load.",
  },
  {
    id: ACADEMY_ACTION_IDS.forgeOpenTraining,
    station: "forge",
    action: "open-training-concepts",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why training metrics need context",
    tooltipBody:
      "Forge metrics are useful only when paired with examples, validation, and layer-level understanding.",
  },
  {
    id: ACADEMY_ACTION_IDS.forgeTrainingMethod,
    station: "forge",
    action: "explain-training-method",
    label: "Learn methods",
    conceptId: ACADEMY_CONCEPT_IDS.trainingAdapters,
    tooltipTitle: "LoRA or QLoRA?",
    tooltipBody:
      "LoRA trains adapter matrices in normal precision. QLoRA keeps the base model quantized while training adapters, which lowers memory pressure for local fine-tuning.",
  },
  {
    id: ACADEMY_ACTION_IDS.forgeAdapterBoundary,
    station: "forge",
    action: "explain-adapter-boundary",
    label: "Learn adapter boundary",
    conceptId: ACADEMY_CONCEPT_IDS.trainingAdapters,
    tooltipTitle: "Why an adapter boundary?",
    tooltipBody:
      "The Forge contract records the base model, Material, and adapter output path. That boundary lets the simulator, tiny proof, and real trainer use the same handoff.",
  },
  {
    id: ACADEMY_ACTION_IDS.forgeProofMode,
    station: "forge",
    action: "explain-proof-mode",
    label: "Learn proof mode",
    conceptId: ACADEMY_CONCEPT_IDS.trainingAdapters,
    tooltipTitle: "What is tiny Forge proof?",
    tooltipBody:
      "Tiny proof uses a cached small model and tiny JSONL Material to verify the local training path without requiring a long or expensive run.",
  },
  {
    id: ACADEMY_ACTION_IDS.artifactsOpenPromotion,
    station: "artifacts",
    action: "open-promotion-concepts",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.evaluation,
    tooltipTitle: "Why promotion needs Trials",
    tooltipBody:
      "Artifacts should move into Constructs only after evaluation gives you evidence that behavior improved.",
  },
  {
    id: ACADEMY_ACTION_IDS.artifactsReadiness,
    station: "artifacts",
    action: "explain-artifact-readiness",
    label: "Learn readiness",
    conceptId: ACADEMY_CONCEPT_IDS.artifactReadiness,
    tooltipTitle: "What is Artifact readiness?",
    tooltipBody:
      "Readiness checks whether an Artifact is metadata-only, a LoRA adapter, a full checkpoint, or blocked because expected output files are missing.",
  },
  {
    id: ACADEMY_ACTION_IDS.artifactsPromotionGate,
    station: "artifacts",
    action: "explain-promotion-gate",
    label: "Learn promotion",
    conceptId: ACADEMY_CONCEPT_IDS.artifactReadiness,
    tooltipTitle: "Why gate Construct loading?",
    tooltipBody:
      "Promotion gates prevent broken or incompatible Artifact outputs from being treated like a real Construct runtime. Load only after readiness and Trials give enough evidence.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsOpenEvaluation,
    station: "trials",
    action: "open-evaluation",
    label: "Open Academy: Evaluation",
    conceptId: ACADEMY_CONCEPT_IDS.evaluation,
    tooltipTitle: "What is Evaluation?",
    tooltipBody:
      "Evaluation checks model replies against reviewed prompts, expected answers, and rubric scores before promotion.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsReviewWeakSamples,
    station: "trials",
    action: "review-weak-samples",
    label: "Learn",
    conceptId: ACADEMY_CONCEPT_IDS.weakSampleReview,
    tooltipTitle: "What is Weak Sample Review?",
    tooltipBody:
      "Weak sample review turns failed or needs-work replies into corrected rows that can train the next Artifact.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsRuntimeSources,
    station: "trials",
    action: "explain-runtime-sources",
    label: "Learn runtime sources",
    conceptId: ACADEMY_CONCEPT_IDS.runtimeEvidence,
    tooltipTitle: "What is a runtime source?",
    tooltipBody:
      "A runtime source tells you whether a Trial reply was simulated, produced by the base model, or produced with a loaded adapter. Adapter-backed Trials are the strongest evidence that a Forge changed behavior.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsComparePrompts,
    station: "trials",
    action: "explain-prompt-comparison",
    label: "Learn comparison",
    conceptId: ACADEMY_CONCEPT_IDS.trialComparison,
    tooltipTitle: "Why repeat the same prompt?",
    tooltipBody:
      "Repeating one prompt across Artifacts keeps the test stable. Differences in verdict, token count, and runtime source show whether the trained Artifact improved or only changed its style.",
  },
];

export const findAcademyAction = (
  actions: AcademyAction[],
  actionId: string
): AcademyAction | undefined => actions.find((action) => action.id === actionId);
