import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ConfigureQAGeneratorRuntimeRequest,
  ExportQAPairsPreviewDto,
  ImportMaterialFileRequest,
  IngestMaterialRequest,
  StartAssemblyLineRequest,
} from "../contracts/foundryApi";
import {
  ACADEMY_ACTION_IDS,
  findAcademyAction,
} from "../domain/academyRegistry";
import {
  AcademyAction,
  ArchiveModelHandoff,
  AssemblyLineRun,
  FoundryLoopFocus,
  MaterialChunk,
  MaterialKind,
  MaterialSource,
  ModelArchiveEntry,
  ModelSearchResult,
  QAPair,
  QAReviewStatus,
  QAGeneratorPreflightResult,
  QAGeneratorQualityProof,
  QAGeneratorRuntime,
  QAGeneratorSmokeProof,
  SectionSummary,
  WebsiteMaterialPreview,
  WorkspaceSettings,
  Workshop,
} from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, LearningCard } from "./LearningComponents";
import BaseModelSelector from "./BaseModelSelector";
import LoopFocusCallout from "./LoopFocusCallout";

interface MaterialsWorkbenchProps {
  academyActions: AcademyAction[];
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  summary: SectionSummary;
  workshop: Workshop;
  archiveEntries?: ModelArchiveEntry[];
  academyAction?: AcademyAction;
  qaGeneratorArchiveHandoff?: ArchiveModelHandoff | null;
  onSearchBaseModels?: (query: string) => Promise<ModelSearchResult[]>;
  onOpenArchiveModel: (modelId: string, label?: string) => void;
  onOpenAcademy: () => void;
  onOpenAcademyAction: (actionId: string) => void;
  onLoopEvidenceRefresh?: () => void;
  loopFocus?: FoundryLoopFocus | null;
}

const materialKinds: Array<{ label: string; value: MaterialKind }> = [
  { label: "CSV", value: "csv" },
  { label: "PDF", value: "pdf" },
  { label: "Website", value: "website" },
  { label: "Transcript", value: "transcript" },
  { label: "Video transcript", value: "video-transcript" },
  { label: "Text", value: "text" },
  { label: "JSONL dataset", value: "jsonl" },
];

const importableMaterialKinds: ImportMaterialFileRequest["kind"][] = [
  "csv",
  "pdf",
  "transcript",
  "video-transcript",
  "text",
  "jsonl",
];

const DEFAULT_QA_GENERATOR_MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct";
const SMOKE_QA_GENERATOR_MODEL_ID = "sshleifer/tiny-gpt2";

const inferMaterialKindFromFile = (fileName: string): ImportMaterialFileRequest["kind"] => {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }
  if (normalized.endsWith(".pdf")) {
    return "pdf";
  }
  if (normalized.endsWith(".jsonl") || normalized.endsWith(".ndjson")) {
    return "jsonl";
  }
  if (
    normalized.endsWith(".srt") ||
    normalized.endsWith(".vtt") ||
    normalized.endsWith(".transcript")
  ) {
    return "transcript";
  }
  return "text";
};

const materialNameFromFile = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

const qaTypeFromMetadata = (qaPair: QAPair): string | undefined => {
  const metadataType = qaPair.generationMetadata?.qaType;
  if (typeof metadataType === "string" && metadataType.trim()) {
    return metadataType;
  }
  const metricType = qaPair.qualityGate?.metrics?.qaType;
  if (typeof metricType === "string" && metricType.trim()) {
    return metricType;
  }
  return undefined;
};

const promptVersionFromMetadata = (qaPair: QAPair): string | undefined => {
  const prompt = qaPair.generationMetadata?.prompt;
  if (prompt && typeof prompt === "object" && "templateVersion" in prompt) {
    const templateVersion = (prompt as { templateVersion?: unknown }).templateVersion;
    return typeof templateVersion === "string" ? templateVersion : undefined;
  }
  const metricVersion = qaPair.qualityGate?.metrics?.promptTemplateVersion;
  return typeof metricVersion === "string" ? metricVersion : undefined;
};

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

interface SourceReferenceChip {
  sourceTitle?: string;
  sourceUri?: string;
  chunkIndex?: number;
  tokenStart?: number;
  tokenEnd?: number;
  fingerprint?: string;
}

type QAReviewStatusFilter = "all" | QAReviewStatus;
type QAReviewQualityFilter = "all" | "passed" | "blocked";
type MaterialsLoopFocusTarget = "source" | "assembly" | "review" | "jsonl";
type AssemblyIntent = "smoke" | "training";

const materialsLoopFocusTarget = (
  focus?: FoundryLoopFocus | null
): MaterialsLoopFocusTarget | null => {
  if (!focus || focus.section !== "materials") {
    return null;
  }
  if (focus.stepLabel === "Assembly Line") {
    return "assembly";
  }
  if (focus.stepLabel === "QA Review") {
    return "review";
  }
  if (focus.stepLabel === "JSONL Material") {
    return "jsonl";
  }
  return "source";
};

const sourceReferenceFromChunk = (chunk: MaterialChunk): SourceReferenceChip => {
  const metadata = objectValue(chunk.metadata);
  const source = objectValue(metadata?.source);
  const location = objectValue(metadata?.sourceLocation);
  return {
    sourceTitle: stringValue(source?.sourceTitle) || stringValue(source?.materialName),
    sourceUri: stringValue(source?.originalSourceUri) || stringValue(source?.sourceUri),
    chunkIndex: numberValue(location?.chunkIndex) ?? chunk.chunkIndex,
    tokenStart: numberValue(location?.tokenStart),
    tokenEnd: numberValue(location?.tokenEnd),
    fingerprint: stringValue(metadata?.fingerprint),
  };
};

const sourceReferenceFromQAPair = (qaPair: QAPair): SourceReferenceChip => {
  const generationSource = objectValue(qaPair.generationMetadata?.source);
  const chunkMetadata = objectValue(qaPair.sourceReference?.chunkMetadata)
    || objectValue(qaPair.generationMetadata?.sourceMetadata);
  const chunkSource = objectValue(chunkMetadata?.source);
  const location = objectValue(qaPair.sourceReference?.sourceLocation)
    || objectValue(generationSource?.sourceLocation)
    || objectValue(chunkMetadata?.sourceLocation);
  return {
    sourceTitle:
      stringValue(generationSource?.sourceTitle)
      || stringValue(chunkSource?.sourceTitle)
      || stringValue(chunkSource?.materialName),
    sourceUri:
      stringValue(generationSource?.sourceUri)
      || stringValue(chunkSource?.originalSourceUri)
      || stringValue(chunkSource?.sourceUri),
    chunkIndex: numberValue(generationSource?.chunkIndex) ?? numberValue(location?.chunkIndex),
    tokenStart: numberValue(location?.tokenStart),
    tokenEnd: numberValue(location?.tokenEnd),
    fingerprint: stringValue(generationSource?.chunkFingerprint) || stringValue(chunkMetadata?.fingerprint),
  };
};

const formatSourceReference = (reference: SourceReferenceChip): string => {
  const parts = [];
  if (reference.sourceTitle) {
    parts.push(reference.sourceTitle);
  }
  parts.push(typeof reference.chunkIndex === "number" ? `chunk ${reference.chunkIndex + 1}` : "chunk reference pending");
  if (typeof reference.tokenStart === "number" && typeof reference.tokenEnd === "number") {
    parts.push(`tokens ${reference.tokenStart}-${reference.tokenEnd}`);
  }
  return parts.join(" · ");
};

const formatBytes = (bytes: number): string => {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

interface WebsiteScrapeMetadata {
  status?: string;
  sourceUrl?: string;
  storedSourceUri?: string;
  title?: string;
  fetchedAt?: string;
  estimatedTokenCount?: number;
}

const scrapeMetadataFromMaterial = (material: MaterialSource): WebsiteScrapeMetadata | null => {
  const scrape = material.metadata?.scrape;
  if (!scrape || typeof scrape !== "object" || Array.isArray(scrape)) {
    return null;
  }
  return scrape as WebsiteScrapeMetadata;
};

const formatCatalogDate = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString();
};

const isCachedArchiveEntry = (entry: ModelArchiveEntry) =>
  Boolean(entry.localPath) && (entry.status === "cached" || entry.status === "ready");

const findCachedArchiveEntryForModel = (
  modelId: string,
  archiveEntries: ModelArchiveEntry[]
): ModelArchiveEntry | undefined => {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) {
    return undefined;
  }
  return archiveEntries.find(
    (entry) =>
      isCachedArchiveEntry(entry) &&
      (entry.repoId === normalizedModelId ||
        entry.localPath === normalizedModelId ||
        Boolean(entry.localPath && normalizedModelId.endsWith(entry.localPath)) ||
        Boolean(entry.localPath && entry.localPath.endsWith(normalizedModelId)))
  );
};

const MaterialsWorkbench: React.FC<MaterialsWorkbenchProps> = ({
  academyActions,
  repository,
  settings,
  summary,
  workshop,
  archiveEntries = [],
  academyAction,
  qaGeneratorArchiveHandoff,
  onSearchBaseModels,
  onOpenArchiveModel,
  onOpenAcademy,
  onOpenAcademyAction,
  onLoopEvidenceRefresh,
  loopFocus,
}) => {
  const [draft, setDraft] = useState<IngestMaterialRequest>({
    name: "",
    kind: "text",
    sourceUri: "",
  });
  const [materials, setMaterials] = useState<MaterialSource[]>([]);
  const [assemblyRuns, setAssemblyRuns] = useState<AssemblyLineRun[]>([]);
  const [reviewRunId, setReviewRunId] = useState<string | undefined>();
  const [reviewChunks, setReviewChunks] = useState<MaterialChunk[]>([]);
  const [reviewQAPairs, setReviewQAPairs] = useState<QAPair[]>([]);
  const [qaReviewStatusFilter, setQaReviewStatusFilter] =
    useState<QAReviewStatusFilter>("all");
  const [qaReviewQualityFilter, setQaReviewQualityFilter] =
    useState<QAReviewQualityFilter>("all");
  const [qaReviewSearch, setQaReviewSearch] = useState("");
  const [exportName, setExportName] = useState(`${workshop.name} QA Dataset`);
  const [exportState, setExportState] = useState<string | null>(null);
  const [jsonlPreview, setJsonlPreview] = useState<ExportQAPairsPreviewDto | null>(null);
  const [includeDraftsInExport, setIncludeDraftsInExport] = useState(false);
  const [includeLowQualityInExport, setIncludeLowQualityInExport] = useState(false);
  const [assemblyIntent, setAssemblyIntent] = useState<AssemblyIntent>("training");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [assemblyDraft, setAssemblyDraft] = useState<StartAssemblyLineRequest>({
    materialSourceIds: [],
    chunkSizeTokens: 1024,
    chunkOverlapTokens: 128,
    qaPairsPerSource: 24,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingAssembly, setIsStartingAssembly] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewingJsonl, setIsPreviewingJsonl] = useState(false);
  const [savingQAPairId, setSavingQAPairId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [websitePreview, setWebsitePreview] = useState<WebsiteMaterialPreview | null>(null);
  const [isPreviewingWebsite, setIsPreviewingWebsite] = useState(false);
  const [qaGeneratorRuntime, setQAGeneratorRuntime] = useState<QAGeneratorRuntime | null>(null);
  const [qaGeneratorDraft, setQAGeneratorDraft] = useState<ConfigureQAGeneratorRuntimeRequest>({
    mode: "deterministic",
    modelId: DEFAULT_QA_GENERATOR_MODEL_ID,
    maxNewTokens: 320,
    temperature: 0.2,
  });
  const [qaGeneratorSmokeProof, setQAGeneratorSmokeProof] =
    useState<QAGeneratorSmokeProof | null>(null);
  const [qaGeneratorQualityProof, setQAGeneratorQualityProof] =
    useState<QAGeneratorQualityProof | null>(null);
  const [qaGeneratorPreflight, setQAGeneratorPreflight] =
    useState<QAGeneratorPreflightResult | null>(null);
  const [qaGeneratorArchiveMessage, setQAGeneratorArchiveMessage] = useState<string | null>(null);
  const [isConfiguringGenerator, setIsConfiguringGenerator] = useState(false);
  const [isPreflightingGenerator, setIsPreflightingGenerator] = useState(false);
  const [isRunningGeneratorSmoke, setIsRunningGeneratorSmoke] = useState(false);
  const [isRunningGeneratorQualityProof, setIsRunningGeneratorQualityProof] = useState(false);
  const materialFocusTarget = useMemo(
    () => materialsLoopFocusTarget(loopFocus),
    [loopFocus]
  );
  const sourcePanelRef = useRef<HTMLDivElement | null>(null);
  const assemblyPanelRef = useRef<HTMLElement | null>(null);
  const reviewPanelRef = useRef<HTMLElement | null>(null);
  const jsonlControlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!materialFocusTarget || loopFocus?.section !== "materials") {
      return undefined;
    }

    const target =
      materialFocusTarget === "assembly"
        ? assemblyPanelRef.current
        : materialFocusTarget === "review"
          ? reviewPanelRef.current
          : materialFocusTarget === "jsonl"
            ? jsonlControlsRef.current || reviewPanelRef.current
            : sourcePanelRef.current;

    const timeoutId = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [loopFocus?.requestedAt, loopFocus?.section, materialFocusTarget]);

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterials(workshop.id),
      repository.listAssemblyLineRuns(workshop.id),
      repository.getQAGeneratorRuntime(),
    ])
      .then(([sources, runs, runtime]) => {
        if (isCurrent) {
          const returnedArchiveModelId =
            qaGeneratorArchiveHandoff?.purpose === "qa-generator"
              ? qaGeneratorArchiveHandoff.modelId.trim()
              : "";
          setMaterials(sources);
          setAssemblyRuns(runs);
          setQAGeneratorRuntime(runtime);
          setQAGeneratorDraft({
            mode: returnedArchiveModelId ? "transformers" : runtime.mode,
            modelId: returnedArchiveModelId || runtime.modelId,
            maxNewTokens: runtime.maxNewTokens,
            temperature: runtime.temperature,
          });
          setReviewRunId(runs[0]?.id);
          setSelectedMaterialIds(sources.filter((source) => source.status === "staged").map((source) => source.id));
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Materials.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [qaGeneratorArchiveHandoff, repository, workshop.id]);

  useEffect(() => {
    if (!qaGeneratorArchiveHandoff || qaGeneratorArchiveHandoff.purpose !== "qa-generator") {
      return;
    }

    const modelId = qaGeneratorArchiveHandoff.modelId.trim();
    if (!modelId) {
      return;
    }

    setQAGeneratorDraft((current) => ({
      ...current,
      mode: "transformers",
      modelId,
    }));
    setQAGeneratorPreflight(null);
    setQAGeneratorSmokeProof(null);
    setQAGeneratorQualityProof(null);
    setError(null);
    setQAGeneratorArchiveMessage(
      `${modelId} is cached in Archive. Run Configure + preflight to verify the local QA generator path.`
    );
  }, [qaGeneratorArchiveHandoff]);

  useEffect(() => {
    setExportName(`${workshop.name} QA Dataset`);
    setExportState(null);
  }, [workshop.id, workshop.name]);

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterialChunks(workshop.id, reviewRunId),
      repository.listQAPairs(workshop.id, reviewRunId),
    ])
      .then(([chunks, qaPairs]) => {
        if (isCurrent) {
          setReviewChunks(chunks);
          setReviewQAPairs(qaPairs);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Assembly outputs.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, reviewRunId, workshop.id]);

  const materialStats = useMemo(() => {
    const chunks = materials.reduce((total, material) => total + material.chunkCount, 0);
    const qaPairs = materials.reduce((total, material) => total + material.qaPairCount, 0);

    return [
      { label: "Sources staged", value: materials.length.toLocaleString() },
      { label: "Chunks prepared", value: chunks.toLocaleString() },
      { label: "QA pairs", value: qaPairs.toLocaleString() },
    ];
  }, [materials]);

  const qaReviewStats = useMemo(() => {
    const accepted = reviewQAPairs.filter(
      (qaPair) => qaPair.reviewStatus === "accepted" || qaPair.reviewStatus === "edited"
    ).length;
    const rejected = reviewQAPairs.filter((qaPair) => qaPair.reviewStatus === "rejected").length;
    const draft = reviewQAPairs.length - accepted - rejected;
    const blocked = reviewQAPairs.filter(
      (qaPair) => qaPair.qualityGate?.status === "blocked"
    ).length;
    return { accepted, rejected, draft, blocked };
  }, [reviewQAPairs]);
  const materialsNextAction = useMemo(() => {
    if (!materialFocusTarget) {
      return undefined;
    }
    if (materialFocusTarget === "source") {
      return materials.length === 0
        ? "Add a source Material from a local file, markdown/text document, PDF-derived text, or website preview."
        : "Select staged Materials and start the Assembly Line when the source set looks right.";
    }
    if (materialFocusTarget === "assembly") {
      if (selectedMaterialIds.length === 0) {
        return "Select at least one staged Material before starting an Assembly Line run.";
      }
      return assemblyRuns.length === 0
        ? "Start the Assembly Line to create chunks and candidate QA pairs."
        : "Open the latest Assembly Line run and inspect its generated chunks and QA pairs.";
    }
    if (materialFocusTarget === "review") {
      if (reviewQAPairs.length === 0) {
        return "Run the Assembly Line first so there are QA pairs to review.";
      }
      if (qaReviewStats.accepted === 0) {
        return "Approve or edit at least one grounded QA pair before exporting training data.";
      }
      if (qaReviewStats.blocked > 0 && !includeLowQualityInExport) {
        return "Resolve blocked QA rows or enable the quality override before exporting.";
      }
      return "Preview JSONL so the Forge can verify schema and source references.";
    }
    if (qaReviewStats.accepted === 0 && !includeDraftsInExport) {
      return "Accept reviewed QA pairs or include drafts before previewing JSONL.";
    }
    if (!jsonlPreview) {
      return "Preview JSONL to validate row shape, source references, and Forge readiness.";
    }
    return jsonlPreview.validation.forgeReady
      ? "Export the approved QA rows as a JSONL Material for Forge."
      : "Fix the JSONL validation blockers before exporting this Material.";
  }, [
    assemblyRuns.length,
    includeDraftsInExport,
    includeLowQualityInExport,
    jsonlPreview,
    materialFocusTarget,
    materials.length,
    qaReviewStats.accepted,
    qaReviewStats.blocked,
    reviewQAPairs.length,
    selectedMaterialIds.length,
  ]);
  const sourceIngestionAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.materialsSourceIngestion
  );
  const chunkingAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.materialsChunking
  );
  const qaGenerationAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.materialsQAGeneration
  );
  const qaQualityGateAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.materialsQAQualityGate
  );
  const reviewChunkById = useMemo(
    () => new Map(reviewChunks.map((chunk) => [chunk.id, chunk])),
    [reviewChunks]
  );
  const normalizedQaSearch = qaReviewSearch.trim().toLowerCase();
  const filteredReviewQAPairs = useMemo(
    () =>
      reviewQAPairs.filter((qaPair) => {
        if (qaReviewStatusFilter !== "all" && qaPair.reviewStatus !== qaReviewStatusFilter) {
          return false;
        }
        if (
          qaReviewQualityFilter !== "all" &&
          qaPair.qualityGate?.status !== qaReviewQualityFilter
        ) {
          return false;
        }
        if (!normalizedQaSearch) {
          return true;
        }
        const sourceReference = sourceReferenceFromQAPair(qaPair);
        const sourceChunk = reviewChunkById.get(qaPair.chunkId);
        const searchableText = [
          qaPair.question,
          qaPair.answer,
          qaPair.generatorModel,
          qaTypeFromMetadata(qaPair),
          sourceReference.sourceTitle,
          sourceReference.sourceUri,
          sourceChunk?.text,
          qaPair.qualityGate?.reasons.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchableText.includes(normalizedQaSearch);
      }),
    [
      normalizedQaSearch,
      qaReviewQualityFilter,
      qaReviewStatusFilter,
      reviewChunkById,
      reviewQAPairs,
    ]
  );
  const visibleReviewChunkIds = useMemo(
    () => new Set(filteredReviewQAPairs.map((qaPair) => qaPair.chunkId)),
    [filteredReviewQAPairs]
  );
  const filteredReviewChunks = useMemo(() => {
    if (!normalizedQaSearch && qaReviewStatusFilter === "all" && qaReviewQualityFilter === "all") {
      return reviewChunks;
    }
    return reviewChunks.filter((chunk) => visibleReviewChunkIds.has(chunk.id));
  }, [
    normalizedQaSearch,
    qaReviewQualityFilter,
    qaReviewStatusFilter,
    reviewChunks,
    visibleReviewChunkIds,
  ]);
  const qaGeneratorSelection = qaGeneratorPreflight?.selection || qaGeneratorRuntime?.selection;
  const modelBackedQAProof = useMemo(
    () =>
      qaGeneratorQualityProof?.results.find((result) =>
        result.label.toLowerCase().includes("cached local model")
      ) || null,
    [qaGeneratorQualityProof]
  );
  const deterministicQAProof = useMemo(
    () =>
      qaGeneratorQualityProof?.results.find((result) =>
        result.label.toLowerCase().includes("deterministic")
      ) || null,
    [qaGeneratorQualityProof]
  );
  const modelBackedQAProofPassed = Boolean(
    modelBackedQAProof &&
      modelBackedQAProof.status === "passed" &&
      modelBackedQAProof.rows.length > 0 &&
      !modelBackedQAProof.quality.hallucinationRisk
  );
  const modelBackedQAProofStatus = !qaGeneratorQualityProof
    ? "not-run"
    : modelBackedQAProofPassed
      ? "passed"
      : "warning";
  const qaProofMode = qaGeneratorQualityProof?.proofMode;
  const qaProofSourceLabel = qaProofMode
    ? qaProofMode.simulated
      ? "simulated mock proof"
      : `${qaProofMode.source} proof`
    : "proof not run";
  const activeQAGeneratorMode = qaGeneratorRuntime?.mode || qaGeneratorDraft.mode;
  const activeQAGeneratorModel = qaGeneratorRuntime?.modelId || qaGeneratorDraft.modelId;
  const configuredQAGeneratorModel = qaGeneratorRuntime?.modelId?.trim() || "";
  const draftedQAGeneratorModel = qaGeneratorDraft.modelId.trim() || DEFAULT_QA_GENERATOR_MODEL_ID;
  const canRunModelBackedQAProof = Boolean(
    qaGeneratorRuntime?.ready &&
      qaGeneratorRuntime.mode === "transformers" &&
      configuredQAGeneratorModel === draftedQAGeneratorModel
  );
  const modelBackedQAProofBlockedReason =
    qaGeneratorDraft.mode !== "transformers"
      ? "Switch to Local Transformers before running model-backed proof."
      : !qaGeneratorRuntime?.ready || qaGeneratorRuntime.mode !== "transformers"
        ? "Configure + preflight a cached local model before running proof."
        : configuredQAGeneratorModel !== draftedQAGeneratorModel
          ? "Configure the selected generator model before running proof."
          : "";
  const trainingQualityGatePassed = Boolean(
    activeQAGeneratorMode === "transformers" &&
      modelBackedQAProofPassed &&
      qaProofMode &&
      !qaProofMode.simulated
  );
  const simulatedModelBackedProofPassed = Boolean(
    modelBackedQAProofPassed && qaProofMode?.simulated
  );
  const assemblyIntentIsTraining = assemblyIntent === "training";
  const canStartAssemblyLine =
    !isStartingAssembly &&
    selectedMaterialIds.length > 0 &&
    (!assemblyIntentIsTraining || trainingQualityGatePassed);
  const assemblyStartLabel = isStartingAssembly
    ? "Running"
    : assemblyIntentIsTraining
      ? "Start Training Assembly Line"
      : "Start Smoke Assembly Line";
  const assemblyGateTitle = trainingQualityGatePassed
    ? "Training-quality QA is unlocked"
    : assemblyIntentIsTraining
      ? simulatedModelBackedProofPassed
        ? "Live QA proof still required"
        : "Training-quality QA is gated"
      : "Smoke/demo Assembly Line selected";
  const assemblyGateBody = trainingQualityGatePassed
    ? "The cached local model produced a passing proof, so new Assembly Line output can be treated as training-quality candidate data after human review."
    : assemblyIntentIsTraining
      ? simulatedModelBackedProofPassed
        ? "The cached-model proof passed in simulated mock mode. Use API mode with the real local Transformers generator before creating training-quality rows."
        : "Run a passing model-backed QA proof before generating training-quality rows. This prevents deterministic smoke output from being mistaken for real fine-tuning data."
      : "Smoke/demo runs keep the pipeline moving for rehearsals, UI checks, and first-run learning, but their JSONL exports should stay clearly marked for review.";
  const assemblyGeneratorWarning = useMemo(() => {
    if (activeQAGeneratorMode === "deterministic") {
      return {
        status: "smoke",
        title: "Generating smoke-grade QA",
        body:
          "The Assembly Line is using deterministic smoke mode. Generated rows are useful for demos and workflow tests, but JSONL training readiness will stay caution until you use a model-backed generator.",
        action: "Switch to Local Transformers, configure a cached model, and run the model-backed proof before real training.",
      };
    }
    if (!qaGeneratorQualityProof) {
      return {
        status: "unproven",
        title: "Model-backed generator is unproven",
        body:
          "Local Transformers mode is selected, but the cached model proof has not run in this session.",
        action: "Run model-backed proof before starting the Assembly Line for training-worthy QA.",
      };
    }
    if (!modelBackedQAProofPassed) {
      return {
        status: "review",
        title: "Model-backed proof needs review",
        body:
          "The cached local model did not produce a clean grounded QA proof. Assembly Line output may fall back or produce rows that need extra review.",
        action: "Use the proof details above to cache a better model or return to deterministic smoke mode for demos.",
      };
    }
    return null;
  }, [activeQAGeneratorMode, modelBackedQAProofPassed, qaGeneratorQualityProof]);

  const qaGeneratorArchiveModelId =
    qaGeneratorPreflight?.modelId?.trim()
    || qaGeneratorPreflight?.model?.modelId?.trim()
    || qaGeneratorDraft.modelId.trim();
  const cachedQAGeneratorArchiveEntry = useMemo(
    () => findCachedArchiveEntryForModel(draftedQAGeneratorModel, archiveEntries),
    [archiveEntries, draftedQAGeneratorModel]
  );
  const qaGeneratorCacheReady = Boolean(
    cachedQAGeneratorArchiveEntry ||
      (qaGeneratorPreflight?.mode === "transformers" && qaGeneratorPreflight.model?.cached) ||
      (qaGeneratorRuntime?.mode === "transformers" &&
        qaGeneratorRuntime.ready &&
        configuredQAGeneratorModel === draftedQAGeneratorModel)
  );
  const qaGeneratorCacheState =
    qaGeneratorDraft.mode === "deterministic"
      ? "caution"
      : qaGeneratorCacheReady
        ? "ready"
        : qaGeneratorPreflight && qaGeneratorPreflight.mode === "transformers"
          ? "blocked"
          : "caution";
  const qaGeneratorCacheTitle =
    qaGeneratorDraft.mode === "deterministic"
      ? "Smoke mode ready"
      : qaGeneratorCacheReady
        ? "QA generator cached"
        : qaGeneratorPreflight
          ? "Cache before training-quality QA"
          : "Preflight before real QA";
  const qaGeneratorCacheDetail =
    qaGeneratorDraft.mode === "deterministic"
      ? "Deterministic generation keeps demos and CI moving without downloads. Switch to Local Transformers and cache the model before creating training-grade QA pairs."
      : cachedQAGeneratorArchiveEntry?.localPath
        ? `${draftedQAGeneratorModel} is cached at ${cachedQAGeneratorArchiveEntry.localPath}. Run Configure + preflight before model-backed proof.`
        : qaGeneratorPreflight?.model?.cached
          ? qaGeneratorPreflight.model.message
          : qaGeneratorPreflight?.model
            ? qaGeneratorPreflight.model.message
            : `${draftedQAGeneratorModel} should be checked against Archive before the Assembly Line generates training-worthy pairs.`;
  const qaGeneratorCacheActionLabel =
    qaGeneratorCacheReady
      ? "Configure + preflight"
      : qaGeneratorPreflight?.mode === "transformers" &&
          qaGeneratorPreflight.model &&
          !qaGeneratorPreflight.model.cached
        ? "Prepare in Archive"
        : "Preflight cache";

  const canOpenQAGeneratorInArchive =
    qaGeneratorPreflight?.mode === "transformers" &&
    qaGeneratorPreflight.model &&
    !qaGeneratorPreflight.model.cached &&
    Boolean(qaGeneratorArchiveModelId);

  const openQAGeneratorArchive = () => {
    if (!canOpenQAGeneratorInArchive || !qaGeneratorArchiveModelId) {
      return;
    }
    onOpenArchiveModel(qaGeneratorArchiveModelId, "QA Generator");
  };
  const isWebsiteMaterial = draft.kind === "website" && !selectedFile;
  const normalizedWebsiteSource = draft.sourceUri.trim();
  const hasFreshWebsitePreview =
    !isWebsiteMaterial ||
    Boolean(websitePreview && websitePreview.sourceUrl === normalizedWebsiteSource);

  const updateDraft = <K extends keyof IngestMaterialRequest>(
    key: K,
    value: IngestMaterialRequest[K]
  ) => {
    setWebsitePreview(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateAssemblyDraft = <K extends keyof StartAssemblyLineRequest>(
    key: K,
    value: StartAssemblyLineRequest[K]
  ) => {
    setAssemblyDraft((current) => ({ ...current, [key]: value }));
  };

  const updateQAGeneratorDraft = <K extends keyof ConfigureQAGeneratorRuntimeRequest>(
    key: K,
    value: ConfigureQAGeneratorRuntimeRequest[K]
  ) => {
    setQAGeneratorPreflight(null);
    setQAGeneratorArchiveMessage(null);
    setQAGeneratorDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleMaterialSelection = (materialId: string) => {
    setSelectedMaterialIds((current) =>
      current.includes(materialId)
        ? current.filter((id) => id !== materialId)
        : [...current, materialId]
    );
  };

  const registerMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const trimmedName = draft.name.trim();
      if (!trimmedName) {
        throw new Error("Material name cannot be empty.");
      }
      if (isWebsiteMaterial && !hasFreshWebsitePreview) {
        throw new Error("Preview this website before staging it as Material.");
      }
      const material = selectedFile
        ? await repository.importMaterialFile(workshop.id, {
            name: trimmedName,
            kind: importableMaterialKinds.includes(draft.kind as ImportMaterialFileRequest["kind"])
              ? (draft.kind as ImportMaterialFileRequest["kind"])
              : inferMaterialKindFromFile(selectedFile.name),
            file: selectedFile,
          })
        : await repository.registerMaterial(workshop.id, {
            ...draft,
            name: trimmedName,
            sourceUri: draft.sourceUri.trim(),
          });
      setMaterials((current) => [material, ...current.filter((item) => item.id !== material.id)]);
      setDraft({ name: "", kind: draft.kind, sourceUri: "" });
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
      onLoopEvidenceRefresh?.();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Could not register Material.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setWebsitePreview(null);
    if (!file) {
      return;
    }
    const inferredKind = inferMaterialKindFromFile(file.name);
    setDraft((current) => ({
      ...current,
      name: current.name || materialNameFromFile(file.name) || file.name,
      kind: inferredKind,
      sourceUri: "",
    }));
  };

  const previewWebsiteMaterial = async () => {
    const sourceUri = draft.sourceUri.trim();
    if (!sourceUri) {
      setError("Website source cannot be empty.");
      return;
    }

    setIsPreviewingWebsite(true);
    setWebsitePreview(null);
    setError(null);

    try {
      const preview = await repository.previewWebsiteMaterial(workshop.id, { sourceUri });
      setWebsitePreview(preview);
    } catch (previewError: unknown) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview website Material.");
    } finally {
      setIsPreviewingWebsite(false);
    }
  };

  const startAssemblyLine = async () => {
    if (assemblyIntentIsTraining && !trainingQualityGatePassed) {
      setError("Training-quality Assembly Line is blocked until model-backed QA proof passes.");
      return;
    }

    setIsStartingAssembly(true);
    setError(null);

    try {
      const run = await repository.startAssemblyLine(workshop.id, {
        ...assemblyDraft,
        materialSourceIds: selectedMaterialIds,
      });
      setAssemblyRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setReviewRunId(run.id);
      const [chunks, qaPairs] = await Promise.all([
        repository.listMaterialChunks(workshop.id, run.id),
        repository.listQAPairs(workshop.id, run.id),
      ]);
      setReviewChunks(chunks);
      setReviewQAPairs(qaPairs);
      const refreshedMaterials = await repository.listMaterials(workshop.id);
      setMaterials(refreshedMaterials);
      setSelectedMaterialIds([]);
      onLoopEvidenceRefresh?.();
    } catch (assemblyError: unknown) {
      setError(
        assemblyError instanceof Error ? assemblyError.message : "Could not start Assembly Line."
      );
    } finally {
      setIsStartingAssembly(false);
    }
  };

  const configureQAGenerator = async () => {
    setIsConfiguringGenerator(true);
    setError(null);
    try {
      const request = {
        ...qaGeneratorDraft,
        modelId: qaGeneratorDraft.modelId.trim() || DEFAULT_QA_GENERATOR_MODEL_ID,
        maxNewTokens: Number(qaGeneratorDraft.maxNewTokens),
        temperature: Number(qaGeneratorDraft.temperature),
      };
      if (request.mode === "transformers") {
        const preflight = await repository.preflightQAGenerator(request);
        setQAGeneratorPreflight(preflight);
        if (!preflight.ok) {
          setError(preflight.summary);
          return;
        }
      }
      const runtime = await repository.configureQAGeneratorRuntime(request);
      setQAGeneratorRuntime(runtime);
      setQAGeneratorDraft({
        mode: runtime.mode,
        modelId: runtime.modelId,
        maxNewTokens: runtime.maxNewTokens,
        temperature: runtime.temperature,
      });
      setQAGeneratorSmokeProof(null);
      setQAGeneratorQualityProof(null);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not configure QA generator.");
    } finally {
      setIsConfiguringGenerator(false);
    }
  };

  const preflightQAGenerator = async () => {
    setIsPreflightingGenerator(true);
    setError(null);
    try {
      const preflight = await repository.preflightQAGenerator({
        ...qaGeneratorDraft,
        modelId: qaGeneratorDraft.modelId.trim() || DEFAULT_QA_GENERATOR_MODEL_ID,
        maxNewTokens: Number(qaGeneratorDraft.maxNewTokens),
        temperature: Number(qaGeneratorDraft.temperature),
      });
      setQAGeneratorPreflight(preflight);
    } catch (preflightError: unknown) {
      setError(preflightError instanceof Error ? preflightError.message : "Could not preflight QA generator.");
    } finally {
      setIsPreflightingGenerator(false);
    }
  };

  const runQAGeneratorSmokeProof = async () => {
    setIsRunningGeneratorSmoke(true);
    setError(null);
    try {
      const smokeProof = await repository.runQAGeneratorSmokeProof();
      setQAGeneratorSmokeProof(smokeProof);
      setQAGeneratorRuntime(smokeProof.runtime);
    } catch (smokeError: unknown) {
      setError(smokeError instanceof Error ? smokeError.message : "Could not run QA generator smoke proof.");
    } finally {
      setIsRunningGeneratorSmoke(false);
    }
  };

  const runQAGeneratorQualityProof = async () => {
    if (!canRunModelBackedQAProof) {
      setError(modelBackedQAProofBlockedReason || "Configure a cached local model first.");
      return;
    }
    setIsRunningGeneratorQualityProof(true);
    setError(null);
    try {
      const qualityProof = await repository.runQAGeneratorQualityProof();
      setQAGeneratorQualityProof(qualityProof);
      setQAGeneratorRuntime(qualityProof.runtime);
    } catch (proofError: unknown) {
      setError(proofError instanceof Error ? proofError.message : "Could not run QA quality proof.");
    } finally {
      setIsRunningGeneratorQualityProof(false);
    }
  };

  const configureModelBackedGeneratorFromWarning = async () => {
    setIsPreflightingGenerator(true);
    setIsConfiguringGenerator(true);
    setError(null);
    try {
      const returnedArchiveModelId =
        qaGeneratorArchiveHandoff?.purpose === "qa-generator"
          ? qaGeneratorArchiveHandoff.modelId.trim()
          : "";
      const request: ConfigureQAGeneratorRuntimeRequest = {
        ...qaGeneratorDraft,
        mode: "transformers",
        modelId:
          returnedArchiveModelId
          || qaGeneratorDraft.modelId.trim()
          || DEFAULT_QA_GENERATOR_MODEL_ID,
        maxNewTokens: Number(qaGeneratorDraft.maxNewTokens),
        temperature: Number(qaGeneratorDraft.temperature),
      };
      setQAGeneratorDraft(request);
      const preflight = await repository.preflightQAGenerator(request);
      setQAGeneratorPreflight(preflight);
      if (preflight.model && !preflight.model.cached) {
        onOpenArchiveModel(preflight.modelId, "QA Generator");
        return;
      }
      if (!preflight.ok) {
        setError(preflight.summary);
        return;
      }
      const runtime = await repository.configureQAGeneratorRuntime(request);
      setQAGeneratorRuntime(runtime);
      setQAGeneratorDraft({
        mode: runtime.mode,
        modelId: runtime.modelId,
        maxNewTokens: runtime.maxNewTokens,
        temperature: runtime.temperature,
      });
      setQAGeneratorSmokeProof(null);
      setQAGeneratorQualityProof(null);
    } catch (generatorError: unknown) {
      setError(
        generatorError instanceof Error
          ? generatorError.message
          : "Could not configure model-backed QA generation."
      );
    } finally {
      setIsPreflightingGenerator(false);
      setIsConfiguringGenerator(false);
    }
  };

  const previewQAPairsExport = async () => {
    if (!reviewRunId) {
      return;
    }

    setIsPreviewingJsonl(true);
    setError(null);
    setExportState(null);

    try {
      const preview = await repository.previewQAPairsExport(workshop.id, {
        assemblyLineRunId: reviewRunId,
        name: exportName.trim() || `${workshop.name} QA Dataset`,
        includeDrafts: includeDraftsInExport,
        includeLowQuality: includeLowQualityInExport,
      });
      setJsonlPreview(preview);
    } catch (previewError: unknown) {
      setJsonlPreview(null);
      setError(previewError instanceof Error ? previewError.message : "Could not preview JSONL export.");
    } finally {
      setIsPreviewingJsonl(false);
    }
  };

  const exportQAPairs = async () => {
    if (!reviewRunId) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportState(null);

    try {
      const exportResult = await repository.exportQAPairs(workshop.id, {
        assemblyLineRunId: reviewRunId,
        name: exportName.trim() || `${workshop.name} QA Dataset`,
        includeDrafts: includeDraftsInExport,
        includeLowQuality: includeLowQualityInExport,
      });
      setMaterials((current) => [
        exportResult.material,
        ...current.filter((item) => item.id !== exportResult.material.id),
      ]);
      setExportState(
        `Exported ${exportResult.qaPairCount.toLocaleString()} QA pairs to ${exportResult.exportUri}`
      );
      setJsonlPreview(null);
      onLoopEvidenceRefresh?.();
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Could not export QA pairs.");
    } finally {
      setIsExporting(false);
    }
  };

  const updateLocalQAPair = (qaPairId: string, updates: Partial<QAPair>) => {
    setReviewQAPairs((current) =>
      current.map((qaPair) => (qaPair.id === qaPairId ? { ...qaPair, ...updates } : qaPair))
    );
  };

  const saveQAPairReview = async (
    qaPair: QAPair,
    reviewStatus: QAPair["reviewStatus"] = qaPair.reviewStatus
  ) => {
    setSavingQAPairId(qaPair.id);
    setError(null);
    try {
      const saved = await repository.updateQAPairReview(workshop.id, qaPair.id, {
        question: qaPair.question,
        answer: qaPair.answer,
        reviewStatus,
      });
      updateLocalQAPair(qaPair.id, saved);
      onLoopEvidenceRefresh?.();
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not save QA review.");
    } finally {
      setSavingQAPairId(null);
    }
  };

  return (
    <section className="materials-workbench" aria-label="Materials workbench">
      <div className="workbench-hero panel-glass">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="status-badge is-forging">{workshop.name}</div>
      </div>

      <LoopFocusCallout
        focus={loopFocus}
        nextAction={materialsNextAction}
        section="materials"
      />

      <div className="workbench-grid">
        {materialStats.map((stat) => (
          <article className="stat-card panel-glass" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="materials-layout">
        <div
          className={`materials-controls ${materialFocusTarget === "source" ? "is-loop-focused" : ""}`}
          ref={sourcePanelRef}
        >
          <form className="material-form panel-glass" onSubmit={registerMaterial}>
          <div>
            <p className="section-eyebrow">Catalog</p>
            <h2>Add Material</h2>
          </div>

          <label className="field-label" htmlFor="material-name">Name</label>
          <input
            id="material-name"
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder="Episode summaries"
            required
          />

          <label className="field-label" htmlFor="material-file">Local file</label>
          <input
            key={fileInputKey}
            id="material-file"
            type="file"
            accept=".txt,.md,.markdown,.text,.csv,.jsonl,.ndjson,.pdf,.transcript,.srt,.vtt"
            onChange={handleFileSelection}
          />
          {selectedFile && (
            <p className="save-state">
              Importing {selectedFile.name} into controlled runtime storage.
            </p>
          )}

          <label className="field-label" htmlFor="material-kind">Material type</label>
          <select
            id="material-kind"
            value={draft.kind}
            onChange={(event) => updateDraft("kind", event.target.value as MaterialKind)}
          >
            {materialKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>{kind.label}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="material-source">
            Source path or URL
            <AcademyActionTooltip action={sourceIngestionAcademyAction} label="?" />
          </label>
          <input
            id="material-source"
            type="text"
            value={draft.sourceUri}
            onChange={(event) => updateDraft("sourceUri", event.target.value)}
            placeholder={
              draft.kind === "website"
                ? "https://example.com/source-page"
                : "runtime/materials/sources/episode-summaries.csv"
            }
            required={!selectedFile}
            disabled={Boolean(selectedFile)}
          />
          {isWebsiteMaterial && (
            <>
              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isPreviewingWebsite || !normalizedWebsiteSource}
                  onClick={previewWebsiteMaterial}
                >
                  <i className="fas fa-eye" aria-hidden="true" />
                  {isPreviewingWebsite ? "Previewing" : "Preview Scrape"}
                </button>
                <span className="selection-count">
                  {hasFreshWebsitePreview ? "Preview ready" : "Preview required"}
                </span>
                <AcademyActionTooltip
                  action={sourceIngestionAcademyAction}
                  label="Why preview?"
                />
              </div>
              {websitePreview && (
                <article className="website-preview-card" aria-label="Website scrape preview">
                  <div className="runtime-readiness-header">
                    <div>
                      <span className="panel-kicker">Website Preview</span>
                      <strong>{websitePreview.title || "Untitled page"}</strong>
                      <p>{websitePreview.description || websitePreview.sourceUrl}</p>
                    </div>
                    <span className="status-badge is-active">ready</span>
                  </div>
                  <div className="material-meta">
                    <span>{websitePreview.estimatedTokenCount.toLocaleString()} tokens</span>
                    <span>{websitePreview.textLength.toLocaleString()} chars</span>
                    <span>{formatBytes(websitePreview.fetchLimitBytes)} limit</span>
                  </div>
                  <blockquote>{websitePreview.textPreview}</blockquote>
                </article>
              )}
            </>
          )}

          <button
            className="button-primary"
            type="submit"
            disabled={isSaving || (isWebsiteMaterial && !hasFreshWebsitePreview)}
          >
            <i className="fas fa-box-archive" aria-hidden="true" />
            {isSaving ? "Staging" : selectedFile ? "Import Material" : "Stage Material"}
          </button>
          {error && <p className="save-state error-state">{error}</p>}
          </form>

          <section className="assembly-panel panel-glass" aria-label="Assembly Line controls">
            <div>
              <p className="section-eyebrow">Assembly Line</p>
              <h2>Prepare QA Pairs</h2>
            </div>

            <div className="qa-generator-panel">
              <div className="runtime-readiness-header">
                <div>
                  <span className="panel-kicker">QA Generator</span>
                  <strong>{qaGeneratorRuntime?.status || "loading"}</strong>
                  <p>{qaGeneratorRuntime?.detail || "Reading generator runtime state..."}</p>
                </div>
                <div className="runtime-load-actions">
                  <span className={`status-badge ${qaGeneratorRuntime?.ready ? "is-active" : ""}`}>
                    {qaGeneratorRuntime?.ready ? "Ready" : "Review"}
                  </span>
                  <AcademyActionTooltip
                    action={qaGenerationAcademyAction}
                    label="Why this mode?"
                  />
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <label className="field-label" htmlFor="qa-generator-mode">Mode</label>
                  <select
                    id="qa-generator-mode"
                    value={qaGeneratorDraft.mode}
                    onChange={(event) =>
                      updateQAGeneratorDraft(
                        "mode",
                        event.target.value as ConfigureQAGeneratorRuntimeRequest["mode"]
                      )
                    }
                  >
                    <option value="deterministic">Deterministic smoke</option>
                    <option value="transformers">Local Transformers</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="qa-generator-model">Generator model</label>
                  <BaseModelSelector
                    id="qa-generator-model"
                    value={qaGeneratorDraft.modelId}
                    defaultBaseModel={DEFAULT_QA_GENERATOR_MODEL_ID}
                    settings={settings}
                    archiveEntries={archiveEntries}
                    onChange={(modelId) => updateQAGeneratorDraft("modelId", modelId)}
                    onSearchBaseModels={onSearchBaseModels}
                    searchAriaLabel="Search Hugging Face QA generator models"
                    searchPlaceholder="Search QA generator models or paste repo id"
                    defaultOptionLabel="QA default"
                  />
                  <p className="field-hint">
                    Quality proof defaults to Qwen. {SMOKE_QA_GENERATOR_MODEL_ID} stays reserved for
                    tiny smoke and load proofs.
                  </p>
                </div>
              </div>

              <article className={`qa-generator-cache-readiness readiness-${qaGeneratorCacheState}`}>
                <div>
                  <p className="panel-kicker">Generator cache readiness</p>
                  <strong>{qaGeneratorCacheTitle}</strong>
                  <span>{qaGeneratorCacheDetail}</span>
                </div>
                <div className="qa-generator-cache-actions">
                  <span className={`status-badge readiness-${qaGeneratorCacheState}`}>
                    {qaGeneratorCacheState}
                  </span>
                  {qaGeneratorDraft.mode === "transformers" && (
                    <button
                      className="button-secondary button-compact"
                      disabled={isPreflightingGenerator || isConfiguringGenerator}
                      onClick={
                        canOpenQAGeneratorInArchive && !qaGeneratorCacheReady
                          ? openQAGeneratorArchive
                          : preflightQAGenerator
                      }
                      type="button"
                    >
                      <i className="fas fa-box-archive" aria-hidden="true" />
                      {isPreflightingGenerator || isConfiguringGenerator
                        ? "Checking"
                        : qaGeneratorCacheActionLabel}
                    </button>
                  )}
                </div>
              </article>

              <div className="settings-grid">
                <div>
                  <label className="field-label" htmlFor="qa-generator-max-tokens">Max new tokens</label>
                  <input
                    id="qa-generator-max-tokens"
                    type="number"
                    min={24}
                    max={2048}
                    step={16}
                    value={qaGeneratorDraft.maxNewTokens}
                    onChange={(event) =>
                      updateQAGeneratorDraft("maxNewTokens", Number(event.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="qa-generator-temperature">Temperature</label>
                  <input
                    id="qa-generator-temperature"
                    type="number"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={qaGeneratorDraft.temperature}
                    onChange={(event) =>
                      updateQAGeneratorDraft("temperature", Number(event.target.value))
                    }
                  />
                </div>
              </div>

              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isPreflightingGenerator}
                  onClick={preflightQAGenerator}
                >
                  {isPreflightingGenerator ? "Checking" : "Preflight"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isConfiguringGenerator}
                  onClick={configureQAGenerator}
                >
                  {isConfiguringGenerator ? "Configuring" : "Configure"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isRunningGeneratorSmoke}
                  onClick={runQAGeneratorSmokeProof}
                >
                  {isRunningGeneratorSmoke ? "Testing" : "Smoke proof"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isRunningGeneratorQualityProof || !canRunModelBackedQAProof}
                  onClick={runQAGeneratorQualityProof}
                  title={modelBackedQAProofBlockedReason || "Run a local model-backed QA proof."}
                >
                  {isRunningGeneratorQualityProof ? "Testing" : "Model-backed QA proof"}
                </button>
              </div>

              {qaGeneratorArchiveMessage && (
                <article
                  className="qa-generator-archive-return"
                  aria-label="Returned from Archive"
                >
                  <div>
                    <span className="panel-kicker">Returned from Archive</span>
                    <strong>QA generator model cached</strong>
                    <p>{qaGeneratorArchiveMessage}</p>
                  </div>
                  <button
                    className="button-primary button-compact"
                    type="button"
                    disabled={isPreflightingGenerator || isConfiguringGenerator}
                    onClick={configureModelBackedGeneratorFromWarning}
                  >
                    <i className="fas fa-bolt" aria-hidden="true" />
                    {isPreflightingGenerator || isConfiguringGenerator
                      ? "Checking model"
                      : "Configure + preflight"}
                  </button>
                </article>
              )}

              <article
                className={`qa-model-proof-card qa-model-proof-${modelBackedQAProofStatus}`}
                aria-label="Model-backed QA proof"
              >
                <div className="runtime-readiness-header">
                  <div>
                    <span className="panel-kicker">Model-backed QA proof</span>
                    <strong>
                      {modelBackedQAProofPassed
                        ? "Cached model produced grounded QA"
                        : qaGeneratorQualityProof
                          ? "Cached model proof needs review"
                          : "Run proof before training export"}
                    </strong>
                    <p>
                      {modelBackedQAProof?.detail ||
                        "Checks the deterministic baseline against the cached local model so JSONL export can become training-safe instead of smoke-only."}
                    </p>
                  </div>
                  <span className={`status-badge ${modelBackedQAProofPassed ? "is-active" : "quality-blocked"}`}>
                    {modelBackedQAProofStatus}
                  </span>
                </div>
                <div className="qa-model-proof-actions">
                  <button
                    className="button-primary button-compact"
                    type="button"
                    disabled={isRunningGeneratorQualityProof || !canRunModelBackedQAProof}
                    onClick={runQAGeneratorQualityProof}
                    title={modelBackedQAProofBlockedReason || "Run a local model-backed QA proof."}
                  >
                    <i className="fas fa-vial-circle-check" aria-hidden="true" />
                    {isRunningGeneratorQualityProof ? "Running proof" : "Run model-backed proof"}
                  </button>
                  <span>
                    Runtime {qaGeneratorRuntime?.mode || qaGeneratorDraft.mode} /{" "}
                    {qaGeneratorRuntime?.modelId || qaGeneratorDraft.modelId}
                  </span>
                  <span className={qaProofMode?.simulated ? "quality-blocked-text" : "success-text"}>
                    {qaProofSourceLabel}
                    {qaProofMode?.localFilesOnly ? " · local files only" : ""}
                  </span>
                  {!canRunModelBackedQAProof && modelBackedQAProofBlockedReason && (
                    <span className="quality-blocked-text">
                      {modelBackedQAProofBlockedReason}
                    </span>
                  )}
                </div>
                {qaGeneratorQualityProof && (
                  <div className="qa-model-proof-summary">
                    <span>
                      <strong>{deterministicQAProof?.status || "unknown"}</strong>
                      deterministic baseline
                    </span>
                    <span>
                      <strong>{modelBackedQAProof?.status || "not cached"}</strong>
                      cached local model
                    </span>
                    <span>
                      <strong>
                        {modelBackedQAProof
                          ? `${Math.round(modelBackedQAProof.quality.score * 100)}%`
                          : "0%"}
                      </strong>
                      proof score
                    </span>
                    <span>
                      <strong>
                        {modelBackedQAProof?.rows[0]?.generatorModel || "none"}
                      </strong>
                      generator
                    </span>
                    <span>
                      <strong>{qaProofMode?.preflightStatus || "unknown"}</strong>
                      backend preflight
                    </span>
                  </div>
                )}
                {modelBackedQAProof?.rows[0] && (
                  <blockquote className="qa-model-proof-sample">
                    <strong>{modelBackedQAProof.rows[0].question}</strong>
                    <span>{modelBackedQAProof.rows[0].answer}</span>
                  </blockquote>
                )}
              </article>

              {qaGeneratorSelection && (
                <div className="qa-generator-selection" aria-label="QA generator tier selection">
                  <div className="runtime-readiness-header">
                    <div>
                      <span className="panel-kicker">Model Selection</span>
                      <strong>Tier {qaGeneratorSelection.selectedTier} · {qaGeneratorSelection.selectedProvider}</strong>
                      <p>
                        {qaGeneratorSelection.platform.os} / {qaGeneratorSelection.platform.machine} ·{" "}
                        {qaGeneratorSelection.platform.accelerator.toUpperCase()} · context{" "}
                        {qaGeneratorSelection.contextWindowRequirement.estimatedRequiredContextTokens.toLocaleString()} tokens
                      </p>
                    </div>
                    <span className="status-badge is-active">
                      {qaGeneratorSelection.qualityPreference}
                    </span>
                  </div>
                  <div className="qa-generator-tier-grid">
                    {qaGeneratorSelection.tiers.map((tier) => (
                      <article
                        className={`qa-generator-tier-card tier-status-${tier.status}`}
                        key={`${tier.tier}-${tier.provider}`}
                      >
                        <div>
                          <strong>Tier {tier.tier}: {tier.label}</strong>
                          <span>{tier.provider} · {tier.quality} quality · {tier.speed}</span>
                        </div>
                        <span className={`status-badge readiness-${tier.status}`}>
                          {tier.status}
                        </span>
                        <p>{tier.reason}</p>
                      </article>
                    ))}
                  </div>
                  <p className="runtime-readiness-gate">{qaGeneratorSelection.fallbackPolicy}</p>
                </div>
              )}

              {qaGeneratorPreflight && (
                <div className={`qa-generator-preflight qa-generator-preflight-${qaGeneratorPreflight.status}`}>
                  <div className="runtime-readiness-header">
                    <div>
                      <span className="panel-kicker">Generator Preflight</span>
                      <strong>{qaGeneratorPreflight.title}</strong>
                      <p>{qaGeneratorPreflight.summary}</p>
                    </div>
                    <span className={`status-badge readiness-${qaGeneratorPreflight.status}`}>
                      {qaGeneratorPreflight.status}
                    </span>
                  </div>
                  <div className="material-meta">
                    <span>{qaGeneratorPreflight.model?.cached ? "cached" : "not cached"}</span>
                    <span>Load {formatBytes(qaGeneratorPreflight.memory.estimatedLoadBytes)}</span>
                    <span>Available {formatBytes(qaGeneratorPreflight.memory.availableBytes)}</span>
                    <span>{qaGeneratorPreflight.memory.fitStatus}</span>
                  </div>
                  <div className="qa-preflight-checks">
                    {qaGeneratorPreflight.checks.map((check) => (
                      <div className={`qa-preflight-check qa-preflight-check-${check.status}`} key={check.id}>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                    ))}
                  </div>
                  <p className="runtime-readiness-gate">{qaGeneratorPreflight.nextAction}</p>
                  {canOpenQAGeneratorInArchive && (
                    <button
                      className="button-secondary button-compact"
                      data-testid="qa-generator-find-in-archive"
                      type="button"
                      onClick={openQAGeneratorArchive}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openQAGeneratorArchive();
                        }
                      }}
                    >
                      <i className="fas fa-box-archive" aria-hidden="true" />
                      Find in Archive
                    </button>
                  )}
                </div>
              )}

              {qaGeneratorSmokeProof && (
                <div className={`qa-generator-proof qa-generator-proof-${qaGeneratorSmokeProof.status}`}>
                  <strong>{qaGeneratorSmokeProof.status}</strong>
                  <p>{qaGeneratorSmokeProof.summary}</p>
                  {qaGeneratorSmokeProof.rows[0] && (
                    <span>
                      {qaGeneratorSmokeProof.rows[0].generatorModel} /{" "}
                      {Math.round((qaGeneratorSmokeProof.rows[0].confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
              )}

              {qaGeneratorQualityProof && (
                <div className="qa-quality-proof">
                  <p>{qaGeneratorQualityProof.recommendation}</p>
                  <div className="qa-quality-proof-grid">
                    {qaGeneratorQualityProof.results.map((result) => (
                      <article className="qa-quality-proof-card" key={result.label}>
                        <div className="runtime-readiness-header">
                          <div>
                            <span className="panel-kicker">{result.label}</span>
                            <strong>{Math.round(result.quality.score * 100)}% proof</strong>
                          </div>
                          <span className={`status-badge ${result.status === "passed" ? "is-active" : "quality-blocked"}`}>
                            {result.status}
                          </span>
                        </div>
                        <p>{result.detail}</p>
                        {result.rows[0] ? (
                          <blockquote>
                            <strong>{result.rows[0].question}</strong>
                            <span>{result.rows[0].answer}</span>
                          </blockquote>
                        ) : (
                          <span className="empty-state">No cached model row generated.</span>
                        )}
                        <div className="material-meta">
                          {result.proofSource && <span>{result.proofSource}</span>}
                          {result.localFilesOnly && <span>local files only</span>}
                          {result.preflightStatus && <span>preflight {result.preflightStatus}</span>}
                          {result.quality.qaType && <span>{result.quality.qaType}</span>}
                          <span>{Math.round(result.quality.confidence * 100)}% confidence</span>
                          <span>{Math.round(result.quality.sourceOverlap * 100)}% overlap</span>
                          {typeof result.quality.sourceTermCoverage === "number" && (
                            <span>{Math.round(result.quality.sourceTermCoverage * 100)}% term coverage</span>
                          )}
                          <span>{result.quality.answerLength} words</span>
                          {result.quality.answerInSource && <span>answer found in source</span>}
                          {result.quality.hallucinationRisk && <span>grounding risk</span>}
                          {result.quality.trivialQuestion && <span>trivial question</span>}
                          {result.quality.groundedTerms && result.quality.groundedTerms.length > 0 && (
                            <span>Grounded: {result.quality.groundedTerms.join(", ")}</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {assemblyGeneratorWarning && (
              <div className={`assembly-generator-warning warning-${assemblyGeneratorWarning.status}`}>
                <div>
                  <span className="panel-kicker">Generator readiness</span>
                  <strong>{assemblyGeneratorWarning.title}</strong>
                  <p>{assemblyGeneratorWarning.body}</p>
                </div>
                <div className="assembly-generator-warning-action">
                  <span>
                    Active generator: {activeQAGeneratorMode} / {activeQAGeneratorModel}
                  </span>
                  <strong>{assemblyGeneratorWarning.action}</strong>
                  <button
                    className="button-secondary button-compact"
                    disabled={isPreflightingGenerator || isConfiguringGenerator}
                    onClick={configureModelBackedGeneratorFromWarning}
                    type="button"
                  >
                    <i className="fas fa-bolt" aria-hidden="true" />
                    {isPreflightingGenerator || isConfiguringGenerator
                      ? "Checking model"
                      : "Configure + preflight"}
                  </button>
                </div>
              </div>
            )}

            <div
              className={`assembly-generator-warning warning-${trainingQualityGatePassed ? "ready" : assemblyIntentIsTraining ? "review" : "smoke"}`}
              aria-label="Assembly Line training-quality gate"
            >
              <div>
                <span className="panel-kicker">Assembly intent</span>
                <strong>{assemblyGateTitle}</strong>
                <p>{assemblyGateBody}</p>
              </div>
              <div className="assembly-generator-warning-action">
                <label className="field-label" htmlFor="assembly-intent">
                  Intent
                </label>
                <select
                  id="assembly-intent"
                  value={assemblyIntent}
                  onChange={(event) => setAssemblyIntent(event.target.value as AssemblyIntent)}
                >
                  <option value="training">Training-quality</option>
                  <option value="smoke">Smoke/demo</option>
                </select>
                <span>
                  Proof: {modelBackedQAProofStatus} · {qaProofSourceLabel}
                </span>
                {assemblyIntentIsTraining && !trainingQualityGatePassed && (
                  <button
                    className="button-secondary button-compact"
                    type="button"
                    disabled={isRunningGeneratorQualityProof || !canRunModelBackedQAProof}
                    onClick={runQAGeneratorQualityProof}
                    title={modelBackedQAProofBlockedReason || "Run a local model-backed QA proof."}
                  >
                    <i className="fas fa-vial-circle-check" aria-hidden="true" />
                    {isRunningGeneratorQualityProof ? "Running proof" : "Run model-backed proof"}
                  </button>
                )}
              </div>
            </div>

            <div className="settings-grid">
              <div>
                <label className="field-label" htmlFor="chunk-size">
                  Chunk size
                  <AcademyActionTooltip action={chunkingAcademyAction} label="?" />
                </label>
                <input
                  id="chunk-size"
                  type="number"
                  min={128}
                  step={128}
                  value={assemblyDraft.chunkSizeTokens}
                  onChange={(event) => updateAssemblyDraft("chunkSizeTokens", Number(event.target.value))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="chunk-overlap">
                  Overlap
                  <AcademyActionTooltip action={chunkingAcademyAction} label="?" />
                </label>
                <input
                  id="chunk-overlap"
                  type="number"
                  min={0}
                  step={32}
                  value={assemblyDraft.chunkOverlapTokens}
                  onChange={(event) => updateAssemblyDraft("chunkOverlapTokens", Number(event.target.value))}
                />
              </div>
            </div>

            <label className="field-label" htmlFor="qa-pairs-per-source">QA pairs per source</label>
            <input
              id="qa-pairs-per-source"
              type="number"
              min={1}
              max={200}
              value={assemblyDraft.qaPairsPerSource}
              onChange={(event) => updateAssemblyDraft("qaPairsPerSource", Number(event.target.value))}
            />

            <button
              className="button-primary"
              type="button"
              disabled={!canStartAssemblyLine}
              onClick={startAssemblyLine}
            >
              <i className="fas fa-gears" aria-hidden="true" />
              {assemblyStartLabel}
            </button>
            <span className="selection-count">{selectedMaterialIds.length} selected</span>
          </section>
        </div>

        <div className="materials-catalog panel-glass">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Sources</p>
              <h2>Material Catalog</h2>
            </div>
          </div>
          <div className="material-list">
            {materials.map((material) => {
              const scrape = scrapeMetadataFromMaterial(material);
              const fetchedDate = formatCatalogDate(scrape?.fetchedAt);
              return (
                <article className="material-row" key={material.id}>
                  <label className="material-select" htmlFor={`material-${material.id}`}>
                    <input
                      id={`material-${material.id}`}
                      type="checkbox"
                      checked={selectedMaterialIds.includes(material.id)}
                      onChange={() => toggleMaterialSelection(material.id)}
                    />
                    <span className="sr-only">Select {material.name}</span>
                  </label>
                  <div>
                    <strong>{scrape?.title || material.name}</strong>
                    <span>{scrape?.sourceUrl || material.sourceUri}</span>
                    {scrape?.storedSourceUri && (
                      <span className="material-source-note">Snapshot: {scrape.storedSourceUri}</span>
                    )}
                  </div>
                  <div className="material-meta">
                    <span>{material.kind}</span>
                    <span>{scrape?.status || material.status}</span>
                    {fetchedDate && <span>fetched {fetchedDate}</span>}
                    {scrape?.estimatedTokenCount ? (
                      <span>{scrape.estimatedTokenCount.toLocaleString()} tokens</span>
                    ) : null}
                    <span>{material.chunkCount} chunks</span>
                    <span>{material.qaPairCount} QA</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <section
        className={`assembly-runs panel-glass ${materialFocusTarget === "assembly" ? "is-loop-focused" : ""}`}
        aria-label="Assembly Line runs"
        ref={assemblyPanelRef}
      >
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Assembly Line</p>
            <h2>Recent Runs</h2>
          </div>
        </div>
        <div className="assembly-run-list">
          {assemblyRuns.length === 0 ? (
            <p className="empty-state">No Assembly Line runs yet.</p>
          ) : (
            assemblyRuns.map((run) => (
              <button
                className={`assembly-run-row ${reviewRunId === run.id ? "is-active" : ""}`}
                key={run.id}
                onClick={() => setReviewRunId(run.id)}
                type="button"
              >
                <div>
                  <strong>{run.status}</strong>
                  <span>{run.materialSourceIds.length} Materials / {run.progress}%</span>
                </div>
                <div className="material-meta">
                  <span>{run.chunkCount} chunks</span>
                  <span>{run.qaPairCount} QA</span>
                  <span>{run.chunkSizeTokens} tokens</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section
        className={`assembly-review panel-glass ${materialFocusTarget === "review" ? "is-loop-focused" : ""}`}
        aria-label="Assembly Line output review"
        ref={reviewPanelRef}
      >
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Review</p>
            <h2>Generated Chunks and QA</h2>
          </div>
          <div
            className={`review-actions ${materialFocusTarget === "jsonl" ? "is-loop-focused" : ""}`}
            ref={jsonlControlsRef}
          >
            <span className="status-badge">{reviewChunks.length} chunks / {reviewQAPairs.length} QA</span>
            <span className="status-badge">
              {qaReviewStats.accepted} accepted / {qaReviewStats.draft} draft
            </span>
            <span className={`status-badge ${qaReviewStats.blocked ? "quality-blocked" : "is-active"}`}>
              {qaReviewStats.blocked} quality blocked
            </span>
            <AcademyActionTooltip
              action={qaQualityGateAcademyAction}
              label="Why blocked?"
            />
            <input
              aria-label="Exported Material name"
              type="text"
              value={exportName}
              onChange={(event) => {
                setExportName(event.target.value);
                setJsonlPreview(null);
              }}
            />
            <label className="toggle-row qa-export-toggle">
              <input
                type="checkbox"
                checked={includeDraftsInExport}
                onChange={(event) => {
                  setIncludeDraftsInExport(event.target.checked);
                  setJsonlPreview(null);
                }}
              />
              <span>Include draft rows</span>
            </label>
            <label className="toggle-row qa-export-toggle">
              <input
                type="checkbox"
                checked={includeLowQualityInExport}
                onChange={(event) => {
                  setIncludeLowQualityInExport(event.target.checked);
                  setJsonlPreview(null);
                }}
              />
              <span>Override quality gate</span>
            </label>
            <button
              className="button-secondary"
              type="button"
              disabled={!reviewRunId || reviewQAPairs.length === 0 || isPreviewingJsonl}
              onClick={previewQAPairsExport}
            >
              <i className="fas fa-magnifying-glass-chart" aria-hidden="true" />
              {isPreviewingJsonl ? "Previewing" : "Preview JSONL"}
            </button>
            <button
              className="button-secondary"
              type="button"
              disabled={
                !reviewRunId ||
                reviewQAPairs.length === 0 ||
                (!includeDraftsInExport && qaReviewStats.accepted === 0) ||
                (!includeLowQualityInExport && qaReviewStats.blocked > 0) ||
                isExporting
              }
              onClick={exportQAPairs}
            >
              <i className="fas fa-file-export" aria-hidden="true" />
              {isExporting ? "Exporting" : "Export JSONL"}
            </button>
          </div>
        </div>
        {exportState && <p className="save-state success-state">{exportState}</p>}
        {qaReviewStats.blocked > 0 && !includeLowQualityInExport && (
          <p className="save-state error-state">
            Quality gate is blocking {qaReviewStats.blocked} QA row(s). Accept higher-quality rows or use the override.
            {" "}
            <AcademyActionTooltip
              action={qaQualityGateAcademyAction}
              label="Learn why"
            />
          </p>
        )}
        {jsonlPreview && (
          <div className={`jsonl-preview-card validation-${jsonlPreview.validation.status}`}>
            <div className="runtime-readiness-header">
              <div>
                <span className="panel-kicker">JSONL Preview</span>
                <strong>{jsonlPreview.rowCount.toLocaleString()} Forge-ready candidate rows</strong>
                <p>
                  {jsonlPreview.validation.forgeReady
                    ? "Schema and source references are ready for Forge handoff."
                    : "Resolve blocked checks before exporting this Material."}
                </p>
              </div>
              <span className={`status-badge readiness-${jsonlPreview.validation.status}`}>
                {jsonlPreview.validation.status}
              </span>
            </div>
            <div className="qa-preflight-checks">
              {jsonlPreview.validation.checks.map((check) => (
                <div className={`qa-preflight-check qa-preflight-check-${check.status}`} key={check.id}>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              ))}
            </div>
            {jsonlPreview.trainingReadiness && (
              <div className={`qa-training-readiness readiness-${jsonlPreview.trainingReadiness.status}`}>
                <div className="runtime-readiness-header">
                  <div>
                    <span className="panel-kicker">Training readiness</span>
                    <strong>
                      {jsonlPreview.trainingReadiness.defaultTrainingSafe
                        ? "Ready for default Forge training"
                        : "Review before Forge training"}
                    </strong>
                    <p>{jsonlPreview.trainingReadiness.recommendation}</p>
                  </div>
                  <span className={`status-badge readiness-${jsonlPreview.trainingReadiness.status}`}>
                    {jsonlPreview.trainingReadiness.status}
                  </span>
                </div>
                <div className="qa-training-readiness-stats">
                  <span>
                    <strong>{jsonlPreview.trainingReadiness.reviewedRows}</strong>
                    reviewed
                  </span>
                  <span>
                    <strong>{jsonlPreview.trainingReadiness.sourceReferencedRows}</strong>
                    source-linked
                  </span>
                  <span>
                    <strong>{jsonlPreview.trainingReadiness.qualityPassedRows}</strong>
                    quality-passed
                  </span>
                  <span>
                    <strong>{jsonlPreview.trainingReadiness.qualityBlockedRows}</strong>
                    blocked
                  </span>
                </div>
                <div className="qa-preflight-checks">
                  {jsonlPreview.trainingReadiness.checks.map((check) => (
                    <div className={`qa-preflight-check qa-preflight-check-${check.status}`} key={check.id}>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  ))}
                </div>
                <div className="qa-training-readiness-meta">
                  <span>
                    Models: {jsonlPreview.trainingReadiness.generatorModels.join(", ") || "unknown"}
                  </span>
                  <span>
                    Prompt: {jsonlPreview.trainingReadiness.promptVersions.join(", ") || "unknown"}
                  </span>
                </div>
              </div>
            )}
            {(jsonlPreview.validation.errors.length > 0 || jsonlPreview.validation.warnings.length > 0) && (
              <div className="jsonl-preview-messages">
                {jsonlPreview.validation.errors.map((message) => (
                  <span className="quality-blocked" key={`error-${message}`}>{message}</span>
                ))}
                {jsonlPreview.validation.warnings.map((message) => (
                  <span key={`warning-${message}`}>{message}</span>
                ))}
              </div>
            )}
            <details className="jsonl-preview-lines" open>
              <summary>Sample JSONL rows</summary>
              <pre>{jsonlPreview.jsonlPreview.join("\n")}</pre>
            </details>
          </div>
        )}
        <div className="qa-review-toolbar" aria-label="QA review filters">
          <label>
            <span>Status</span>
            <select
              value={qaReviewStatusFilter}
              onChange={(event) => setQaReviewStatusFilter(event.target.value as QAReviewStatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="accepted">Accepted</option>
              <option value="edited">Edited</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            <span>Quality</span>
            <select
              value={qaReviewQualityFilter}
              onChange={(event) => setQaReviewQualityFilter(event.target.value as QAReviewQualityFilter)}
            >
              <option value="all">All quality</option>
              <option value="passed">Passed</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label className="qa-review-search">
            <span>Search</span>
            <input
              type="search"
              value={qaReviewSearch}
              onChange={(event) => setQaReviewSearch(event.target.value)}
              placeholder="Question, answer, source, reason"
            />
          </label>
          <span className="status-badge">
            {filteredReviewQAPairs.length} shown / {reviewQAPairs.length} total
          </span>
        </div>
        <div className="assembly-review-grid">
          <div className="review-column">
            <h3>Chunks</h3>
            <div className="review-list">
              {reviewChunks.length === 0 ? (
                <p className="empty-state">Run the Assembly Line to inspect generated chunks.</p>
              ) : filteredReviewChunks.length === 0 ? (
                <p className="empty-state">No chunks match the current QA filters.</p>
              ) : (
                filteredReviewChunks.map((chunk) => {
                  const sourceReference = sourceReferenceFromChunk(chunk);
                  return (
                    <article className="review-card" key={chunk.id}>
                      <strong>Chunk {chunk.chunkIndex + 1} / {chunk.tokenCount} tokens</strong>
                      <div className="source-reference-row">
                        <span>{formatSourceReference(sourceReference)}</span>
                        {sourceReference.sourceUri && <span>{sourceReference.sourceUri}</span>}
                        {sourceReference.fingerprint && <span>fp {sourceReference.fingerprint}</span>}
                      </div>
                      <p>{chunk.text}</p>
                    </article>
                  );
                })
              )}
            </div>
          </div>
          <div className="review-column">
            <h3>QA Pairs</h3>
            <div className="review-list">
              {reviewQAPairs.length === 0 ? (
                <p className="empty-state">Generated QA pairs will appear here before Forge training.</p>
              ) : filteredReviewQAPairs.length === 0 ? (
                <p className="empty-state">No QA pairs match the current filters.</p>
              ) : (
                filteredReviewQAPairs.map((qaPair) => {
                  const sourceReference = sourceReferenceFromQAPair(qaPair);
                  const sourceChunk = reviewChunkById.get(qaPair.chunkId);
                  return (
                  <article className="review-card qa-review-card" key={qaPair.id}>
                    <div className="qa-review-card-header">
                      <span className={`status-badge qa-status-${qaPair.reviewStatus}`}>
                        {qaPair.reviewStatus}
                      </span>
                      <span className="qa-generator-badge">
                        {qaPair.generatorModel || "generator pending"}
                      </span>
                      {typeof qaPair.confidence === "number" && (
                        <span className="qa-confidence-badge">
                          {Math.round(qaPair.confidence * 100)}% confidence
                        </span>
                      )}
                      {qaPair.qualityGate?.status === "blocked" && (
                        <span className="qa-quality-badge qa-quality-blocked">
                          quality blocked
                          <AcademyActionTooltip
                            action={qaQualityGateAcademyAction}
                            label="?"
                          />
                        </span>
                      )}
                      {qaTypeFromMetadata(qaPair) && (
                        <span className="qa-quality-badge">
                          {qaTypeFromMetadata(qaPair)}
                        </span>
                      )}
                      {qaPair.reviewedAt && (
                        <span className="qa-reviewed-time">
                          {new Date(qaPair.reviewedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    <div className="source-reference-row">
                      <span>{formatSourceReference(sourceReference)}</span>
                      {sourceReference.sourceUri && <span>{sourceReference.sourceUri}</span>}
                      {sourceReference.fingerprint && <span>fp {sourceReference.fingerprint}</span>}
                    </div>
                    {sourceChunk && (
                      <details className="qa-source-preview">
                        <summary>Inspect source chunk</summary>
                        <p>{sourceChunk.text}</p>
                      </details>
                    )}
                    {qaPair.qualityGate?.status === "blocked" && (
                      <p className="qa-quality-note">
                        {qaPair.qualityGate.reasons.join("; ")}
                        {qaPair.qualityGate.metrics && (
                          <>
                            {" "}
                            Score {Math.round(qaPair.qualityGate.metrics.score * 100)}%,
                            overlap {Math.round(qaPair.qualityGate.metrics.sourceOverlap * 100)}%.
                          </>
                        )}
                      </p>
                    )}
                    <div className="qa-quality-learning-row">
                      <span>
                        QA type teaches the generator what kind of example this row is meant to become.
                      </span>
                      {promptVersionFromMetadata(qaPair) && (
                        <span>Prompt: {promptVersionFromMetadata(qaPair)}</span>
                      )}
                      {qaPair.qualityGate?.metrics?.groundedTerms &&
                        qaPair.qualityGate.metrics.groundedTerms.length > 0 && (
                          <span>
                            Grounded terms: {qaPair.qualityGate.metrics.groundedTerms.join(", ")}
                          </span>
                        )}
                      {qaPair.qualityGate?.metrics?.answerInSource && (
                        <span>Answer appears in source</span>
                      )}
                      {qaPair.qualityGate?.metrics?.hallucinationRisk && (
                        <span>Grounding risk</span>
                      )}
                      {qaPair.qualityGate?.metrics?.trivialQuestion && (
                        <span>Trivial question</span>
                      )}
                      {typeof qaPair.qualityGate?.metrics?.sourceTermCoverage === "number" && (
                        <span>
                          Term coverage {Math.round(qaPair.qualityGate.metrics.sourceTermCoverage * 100)}%
                        </span>
                      )}
                    </div>
                    <label className="field-label" htmlFor={`qa-question-${qaPair.id}`}>
                      Question
                    </label>
                    <textarea
                      id={`qa-question-${qaPair.id}`}
                      value={qaPair.question}
                      onChange={(event) =>
                        updateLocalQAPair(qaPair.id, {
                          question: event.target.value,
                          reviewStatus: qaPair.reviewStatus === "accepted" ? "edited" : qaPair.reviewStatus,
                        })
                      }
                      rows={3}
                    />
                    <label className="field-label" htmlFor={`qa-answer-${qaPair.id}`}>
                      Answer
                    </label>
                    <textarea
                      id={`qa-answer-${qaPair.id}`}
                      value={qaPair.answer}
                      onChange={(event) =>
                        updateLocalQAPair(qaPair.id, {
                          answer: event.target.value,
                          reviewStatus: qaPair.reviewStatus === "accepted" ? "edited" : qaPair.reviewStatus,
                        })
                      }
                      rows={5}
                    />
                    <div className="qa-review-actions">
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair, "accepted")}
                      >
                        Accept
                      </button>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair, "rejected")}
                      >
                        Reject
                      </button>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair)}
                      >
                        {savingQAPairId === qaPair.id ? "Saving" : "Save"}
                      </button>
                    </div>
                  </article>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={academyAction}
        onAction={onOpenAcademy}
      />
      <LearningCard
        title="Source evidence comes first"
        body="Imported files and website snapshots become the evidence chain for chunks, QA rows, JSONL exports, and later Forge runs."
        academyAction={sourceIngestionAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.materialsSourceIngestion)}
      />
      <LearningCard
        title="Chunks define what the generator can see"
        body="Chunk size controls the context window for each QA draft. Overlap protects boundary context, but too much overlap can create repetitive training examples."
        academyAction={chunkingAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.materialsChunking)}
      />
      <LearningCard
        title="QA generation mode changes data quality"
        body="Deterministic mode keeps demos and CI reliable. Model-backed generation is the path for context-aware QA pairs that are worth reviewing for training."
        academyAction={qaGenerationAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.materialsQAGeneration)}
      />
      <LearningCard
        title="Quality gates protect the Forge"
        body="Blocked rows are not failures; they are signals that a question, answer, grounding, or generator fallback needs human review before training."
        academyAction={qaQualityGateAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.materialsQAQualityGate)}
      />

      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="What happens next?" />
      </div>
    </section>
  );
};

export default MaterialsWorkbench;
