import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ACADEMY_ACTION_IDS,
  findAcademyAction,
} from "../domain/academyRegistry";
import {
  Artifact,
  AcademyAction,
  Construct,
  ConstructMessage,
  ConstructModelHandoff,
  ConstructPromptChain,
  ConstructRuntime,
  ConstructRuntimeEvent,
  ConstructRuntimePreflightResult,
  ConstructRuntimeProbeResult,
  ConstructRuntimeValidation,
  ConstructRuntimeValidationPage,
  CreateConstructRuntimeEventRequest,
  FoundryLoopFocus,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  ReviewedTrialVerdict,
  resolveDefaultBaseModel,
  Trial,
  TrialVerdict,
} from "../domain/foundry";
import { buildRuntimeReadinessSummary } from "../domain/constructReadiness";
import { activeFoundryDataSource } from "../domain/dataSourceMode";
import {
  ModelPreparationActivity,
  SystemReadinessModelAction,
} from "../domain/systemReadiness";
import {
  formatLoadDuration,
  formatRuntimeMemory,
  formatRuntimeTimestamp,
  getLoadedModelSnapshot,
  getRuntimeLoadEvent,
  getRuntimeMemory,
  shortModelId,
} from "../domain/runtimeState";
import { FoundryRepository } from "../services/foundryRepository";
import LoopFocusCallout from "./LoopFocusCallout";
import {
  AcademyActionTooltip,
  LearningCard,
  TrainingMetricExplainer,
} from "./LearningComponents";
import { WorkspaceSettings } from "./SettingsOverlay";
import SystemReadinessPanel from "./SystemReadinessPanel";

interface ResponseInspection {
  messageId: string;
  prompt: string;
  response: string;
  totalTokens: number;
  runtimeMode: string;
  runtimeStatus: string;
  modelId: string;
  device: string;
  contextWindow: number;
  maxNewTokens: number;
  temperature: number;
  includeLibraryContext: boolean;
  systemPrompt: string;
  promptChain?: ConstructPromptChain;
  artifactId: string;
  constructId: string;
}

type RuntimeLoadPhase = "idle" | "configuring" | "loading" | "ready" | "failed";
type RuntimeSmokeStatus = "idle" | "loading" | "streaming" | "passed" | "failed";
type RuntimeHistoryFilter = "all" | "smoke" | "load" | "preflight" | "memory" | "failures";
type RuntimeValidationStatusFilter = "all" | ConstructRuntimeValidation["status"];

interface RuntimeSmokeResult {
  modelId: string;
  device: string;
  totalTokens: number;
  durationSeconds: number;
  cleanupStatus: string;
  memoryAvailableGb?: number;
  completedAt: string;
}

interface SendMessageOptions {
  smokeTest?: boolean;
  smokeStartedAt?: number;
  systemPromptOverride?: string;
  includeLibraryContextOverride?: boolean;
  preserveComposer?: boolean;
}

const LOCAL_SMOKE_MODEL_ID = "sshleifer/tiny-gpt2";
const LOCAL_SMOKE_PROMPT =
  "Runtime smoke test: reply with one short sentence from The Foundry.";
const PROMPT_CHAIN_CONTRACT_VERSION = "foundry.construct.prompt-chain.v1";
const SMOKE_RESULT_STORAGE_PREFIX = "foundry.construct.smokeResult";
const RUNTIME_VALIDATION_PAGE_SIZE = 5;
const RUNTIME_HISTORY_FILTERS: Array<{ id: RuntimeHistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "smoke", label: "Smoke" },
  { id: "load", label: "Loads" },
  { id: "preflight", label: "Preflight" },
  { id: "memory", label: "Memory" },
  { id: "failures", label: "Failures" },
];

const ALL_VALIDATION_FILTER = "all";

const emptyRuntimeValidationPage = (
  page = 1,
  pageSize = RUNTIME_VALIDATION_PAGE_SIZE
): ConstructRuntimeValidationPage => ({
  items: [],
  total: 0,
  page,
  pageSize,
  pageCount: 0,
  filters: {},
  facets: {
    models: [],
    devices: [],
    statuses: [],
  },
});

const smokeResultStorageKey = (constructId: string, artifactId: string) =>
  `${SMOKE_RESULT_STORAGE_PREFIX}.${constructId}.${artifactId}`;

const isRuntimeSmokeResult = (value: unknown): value is RuntimeSmokeResult => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeSmokeResult>;
  return (
    typeof candidate.modelId === "string" &&
    typeof candidate.device === "string" &&
    typeof candidate.totalTokens === "number" &&
    typeof candidate.durationSeconds === "number" &&
    typeof candidate.cleanupStatus === "string" &&
    typeof candidate.completedAt === "string" &&
    (candidate.memoryAvailableGb === undefined || typeof candidate.memoryAvailableGb === "number")
  );
};

const loadPersistedSmokeResult = (
  constructId: string,
  artifactId: string
): RuntimeSmokeResult | null => {
  try {
    const rawResult = window.localStorage.getItem(smokeResultStorageKey(constructId, artifactId));
    if (!rawResult) {
      return null;
    }
    const parsedResult: unknown = JSON.parse(rawResult);
    return isRuntimeSmokeResult(parsedResult) ? parsedResult : null;
  } catch {
    return null;
  }
};

const persistSmokeResult = (
  constructId: string,
  artifactId: string,
  result: RuntimeSmokeResult
) => {
  try {
    window.localStorage.setItem(
      smokeResultStorageKey(constructId, artifactId),
      JSON.stringify(result)
    );
  } catch {
    // Best-effort session history only; runtime behavior should not depend on storage.
  }
};

const smokeResultFromRuntimeEvent = (
  event: ConstructRuntimeEvent,
  constructId: string,
  artifactId: string
): RuntimeSmokeResult | null => {
  if (
    event.type !== "smoke" ||
    event.status !== "passed" ||
    event.constructId !== constructId ||
    event.artifactId !== artifactId
  ) {
    return null;
  }
  const smokeResult = event.metadata?.smokeResult;
  return isRuntimeSmokeResult(smokeResult) ? smokeResult : null;
};

const latestSmokeResultFromRuntimeEvents = (
  events: ConstructRuntimeEvent[],
  constructId: string,
  artifactId: string
): RuntimeSmokeResult | null => {
  for (const event of events) {
    const smokeResult = smokeResultFromRuntimeEvent(event, constructId, artifactId);
    if (smokeResult) {
      return smokeResult;
    }
  }
  return null;
};

const findSmokeModelArchiveEntry = (archiveEntries: ModelArchiveEntry[]) =>
  archiveEntries.find(
    (entry) =>
      entry.repoId === LOCAL_SMOKE_MODEL_ID ||
      entry.localPath.endsWith("sshleifer-tiny-gpt2") ||
      entry.localPath.endsWith("sshleifer/tiny-gpt2")
  );

const isModelArchiveEntryCached = (entry?: ModelArchiveEntry) =>
  Boolean(entry?.localPath && (entry.status === "cached" || entry.status === "ready"));

const buildDefaultSystemPrompt = (construct: Construct, artifact: Artifact) =>
  `You are ${construct.name}, a Foundry Construct testing Artifact ${artifact.name}. Stay grounded in the Workshop Material, name uncertainty clearly, and keep replies useful for Trial review.`;

const buildEvidenceSystemPrompt = (construct: Construct, artifact: Artifact) =>
  `You are ${construct.name}, a Foundry Construct testing Artifact ${artifact.name}. Answer with source-grounded evidence first, separate persona behavior from known source facts, and call out uncertainty when the Workshop Material does not support a claim.`;

const createPromptChain = (
  systemPrompt: string,
  userPrompt: string,
  includeLibraryContext: boolean
): ConstructPromptChain => {
  const normalizedSystemPrompt = systemPrompt.trim();
  return {
    contractVersion: PROMPT_CHAIN_CONTRACT_VERSION,
    systemPrompt: normalizedSystemPrompt,
    systemPromptPresent: normalizedSystemPrompt.length > 0,
    systemPromptPreview: normalizedSystemPrompt.slice(0, 240),
    userPrompt,
    userPromptPreview: userPrompt.slice(0, 240),
    includeLibraryContext,
    instructionOrder: ["system", "user", "library-context", "generation-settings"],
    createdAt: new Date().toISOString(),
  };
};

const mergeRuntimeTimelineEvents = (
  current: ConstructRuntimeEvent[],
  incoming: ConstructRuntimeEvent[]
) => {
  const byId = new Map<string, ConstructRuntimeEvent>();
  [...current, ...incoming].forEach((event) => {
    byId.set(event.id, event);
  });
  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 50);
};

const runtimeHistoryMatchesFilter = (
  event: ConstructRuntimeEvent,
  filter: RuntimeHistoryFilter
) => {
  if (filter === "all") {
    return true;
  }
  if (filter === "failures") {
    return event.status === "failed";
  }
  if (filter === "load") {
    return ["handoff", "configure", "load", "probe"].includes(event.type);
  }
  if (filter === "memory") {
    return event.type === "unload";
  }
  return event.type === filter;
};

const runtimeHistoryEventLabel = (event: ConstructRuntimeEvent) => {
  if (event.type === "unload" && event.title.toLowerCase().includes("memory")) {
    return "Memory";
  }
  const labels: Record<ConstructRuntimeEvent["type"], string> = {
    handoff: "Handoff",
    preflight: "Preflight",
    configure: "Configure",
    load: "Load",
    unload: "Unload",
    probe: "Probe",
    smoke: "Smoke",
  };
  return labels[event.type];
};

const formatRuntimeEventMetadata = (event: ConstructRuntimeEvent | null) =>
  JSON.stringify(event?.metadata || {}, null, 2);

const formatRuntimeValidationMetadata = (validation: ConstructRuntimeValidation | null) =>
  JSON.stringify(validation?.metadata || {}, null, 2);

const uniqueSortedValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

const downloadJsonFile = (fileName: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  downloadLink.href = objectUrl;
  downloadLink.download = fileName;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(objectUrl);
};

interface DiagnosticsBundlePreview {
  fileName: string;
  bundle: Record<string, unknown>;
  eventCount: number;
  validationCount: number;
  redactionAudit: Array<{
    field: string;
    status: string;
    risk: string;
    reason: string;
    policy: string;
  }>;
  validationSummary: {
    filters: {
      modelId?: string | null;
      device?: string | null;
      status?: ConstructRuntimeValidation["status"] | null;
    };
    validations: ConstructRuntimeValidation[];
  };
  exportedAt: string;
  redactions: string[];
}

interface ConstructWorkbenchProps {
  academyActions: AcademyAction[];
  artifact: Artifact;
  construct: Construct;
  handoff?: ConstructModelHandoff | null;
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  sourceStatus?: FoundryRuntimeStatus | null;
  archiveEntries?: ModelArchiveEntry[];
  preparationActivity?: ModelPreparationActivity;
  onPrepareModel?: (action: SystemReadinessModelAction) => void;
  onCancelPreparation?: () => void;
  onOpenAcademyAction: (actionId: string) => void;
  onRuntimeChanged?: (runtime: ConstructRuntime) => void;
  onLoopEvidenceRefresh?: () => void;
  onOpenTrialComparison?: () => void;
  loopFocus?: FoundryLoopFocus | null;
}

const ConstructWorkbench: React.FC<ConstructWorkbenchProps> = ({
  academyActions,
  artifact,
  construct,
  handoff,
  repository,
  settings,
  sourceStatus,
  archiveEntries = [],
  preparationActivity,
  onPrepareModel,
  onCancelPreparation,
  onOpenAcademyAction,
  onRuntimeChanged,
  onLoopEvidenceRefresh,
  onOpenTrialComparison,
  loopFocus,
}) => {
  const conversationId = `construct-${construct.id}`;
  const configuredModelTarget = settings.constructModelId || resolveDefaultBaseModel(settings);
  const constructLoopFocused = loopFocus?.section === "construct";
  const constructRuntimeFocusRef = useRef<HTMLDivElement | null>(null);
  const [activeConstruct, setActiveConstruct] = useState(construct);
  const [activeArtifact, setActiveArtifact] = useState(artifact);
  const activePromptDefault = useMemo(
    () => buildDefaultSystemPrompt(activeConstruct, activeArtifact),
    [activeArtifact, activeConstruct]
  );
  const evidencePromptDefault = useMemo(
    () => buildEvidenceSystemPrompt(activeConstruct, activeArtifact),
    [activeArtifact, activeConstruct]
  );
  const previousPromptDefault = useRef(activePromptDefault);
  const [systemPrompt, setSystemPrompt] = useState(activePromptDefault);
  const [promptWorkbenchOpen, setPromptWorkbenchOpen] = useState(true);
  const [messages, setMessages] = useState<ConstructMessage[]>([
    {
      id: "welcome",
      sender: "assistant",
      text: `Artifact ${artifact.name} is loaded. Ask a question to test the Construct runtime contract.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [includeLibraryContext, setIncludeLibraryContext] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState("simulated");
  const [runtimeDetail, setRuntimeDetail] = useState("Using deterministic simulated token streaming.");
  const [runtime, setRuntime] = useState<ConstructRuntime | null>(null);
  const [probePrompt, setProbePrompt] = useState("The Foundry is");

  useEffect(() => {
    if (!constructLoopFocused) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      constructRuntimeFocusRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [constructLoopFocused, loopFocus?.requestedAt]);
  const [probeModelId, setProbeModelId] = useState("sshleifer/tiny-gpt2");
  const [probeResult, setProbeResult] = useState<ConstructRuntimeProbeResult | null>(null);
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
  const [isReleasingMemory, setIsReleasingMemory] = useState(false);
  const [runtimeMemoryReleaseMessage, setRuntimeMemoryReleaseMessage] = useState<string | null>(null);
  const [runtimeLoadPhase, setRuntimeLoadPhase] = useState<RuntimeLoadPhase>("idle");
  const [runtimeLoadTarget, setRuntimeLoadTarget] = useState(configuredModelTarget || artifact.baseModel);
  const [runtimeSmokeStatus, setRuntimeSmokeStatus] = useState<RuntimeSmokeStatus>("idle");
  const [runtimeSmokeMessage, setRuntimeSmokeMessage] = useState(
    "Load the current model, stream a short reply, and inspect the runtime contract."
  );
  const [runtimeSmokeResult, setRuntimeSmokeResult] = useState<RuntimeSmokeResult | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [isProbingRuntime, setIsProbingRuntime] = useState(false);
  const [isPreflightingRuntime, setIsPreflightingRuntime] = useState(false);
  const [preflightResult, setPreflightResult] = useState<ConstructRuntimePreflightResult | null>(null);
  const [readinessGateMessage, setReadinessGateMessage] = useState<string | null>(null);
  const [confirmedCautionTarget, setConfirmedCautionTarget] = useState<string | null>(null);
  const [runtimeTimeline, setRuntimeTimeline] = useState<ConstructRuntimeEvent[]>([]);
  const [runtimeValidations, setRuntimeValidations] = useState<ConstructRuntimeValidation[]>([]);
  const [runtimeValidationPage, setRuntimeValidationPage] = useState<ConstructRuntimeValidationPage>(
    () => emptyRuntimeValidationPage()
  );
  const [runtimeHistoryFilter, setRuntimeHistoryFilter] = useState<RuntimeHistoryFilter>("all");
  const [runtimeValidationModelFilter, setRuntimeValidationModelFilter] =
    useState<string>(ALL_VALIDATION_FILTER);
  const [runtimeValidationDeviceFilter, setRuntimeValidationDeviceFilter] =
    useState<string>(ALL_VALIDATION_FILTER);
  const [runtimeValidationStatusFilter, setRuntimeValidationStatusFilter] =
    useState<RuntimeValidationStatusFilter>("all");
  const [runtimeValidationPageNumber, setRuntimeValidationPageNumber] = useState(1);
  const [selectedRuntimeEvent, setSelectedRuntimeEvent] =
    useState<ConstructRuntimeEvent | null>(null);
  const [selectedRuntimeValidation, setSelectedRuntimeValidation] =
    useState<ConstructRuntimeValidation | null>(null);
  const [isExportingRuntimeHistory, setIsExportingRuntimeHistory] = useState(false);
  const [isExportingRuntimeValidations, setIsExportingRuntimeValidations] = useState(false);
  const [runtimeValidationExportMessage, setRuntimeValidationExportMessage] =
    useState<string | null>(null);
  const [isPreparingDiagnosticsBundle, setIsPreparingDiagnosticsBundle] = useState(false);
  const [diagnosticsBundlePreview, setDiagnosticsBundlePreview] =
    useState<DiagnosticsBundlePreview | null>(null);
  const [isConfirmingHistoryClear, setIsConfirmingHistoryClear] = useState(false);
  const [isClearingRuntimeHistory, setIsClearingRuntimeHistory] = useState(false);
  const [runtimeHistoryMessage, setRuntimeHistoryMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRunningPromptRecipe, setIsRunningPromptRecipe] = useState(false);
  const [promptRecipeMessage, setPromptRecipeMessage] = useState<string | null>(null);
  const [lastInspection, setLastInspection] = useState<ResponseInspection | null>(null);
  const [trialVerdict, setTrialVerdict] = useState<TrialVerdict | null>(null);
  const [savedTrial, setSavedTrial] = useState<Trial | null>(null);
  const [isSavingTrial, setIsSavingTrial] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSystemPrompt((currentPrompt) =>
      currentPrompt.trim() && currentPrompt !== previousPromptDefault.current
        ? currentPrompt
        : activePromptDefault
    );
    previousPromptDefault.current = activePromptDefault;
  }, [activePromptDefault]);

  const refreshRuntimeTimeline = useCallback(async () => {
    try {
      const events = await repository.listConstructRuntimeEvents();
      if (events.length > 0) {
        setRuntimeTimeline((current) => mergeRuntimeTimelineEvents(current, events));
      }
      return events;
    } catch {
      return [];
    }
  }, [repository]);

  const refreshRuntimeValidations = useCallback(async () => {
    try {
      const page = await repository.listConstructRuntimeValidations({
        modelId:
          runtimeValidationModelFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationModelFilter,
        device:
          runtimeValidationDeviceFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationDeviceFilter,
        status:
          runtimeValidationStatusFilter === "all"
            ? undefined
            : runtimeValidationStatusFilter,
        page: runtimeValidationPageNumber,
        pageSize: RUNTIME_VALIDATION_PAGE_SIZE,
      });
      setRuntimeValidationPage(page);
      setRuntimeValidations(page.items);
      return page.items;
    } catch {
      setRuntimeValidationPage(
        emptyRuntimeValidationPage(runtimeValidationPageNumber, RUNTIME_VALIDATION_PAGE_SIZE)
      );
      setRuntimeValidations([]);
      return [];
    }
  }, [
    repository,
    runtimeValidationDeviceFilter,
    runtimeValidationModelFilter,
    runtimeValidationPageNumber,
    runtimeValidationStatusFilter,
  ]);

  const addRuntimeTimelineEvent = useCallback(
    (event: Omit<CreateConstructRuntimeEventRequest, "constructId" | "artifactId" | "runtimeStatus">) => {
      void repository
        .recordConstructRuntimeEvent({
          ...event,
          constructId: activeConstruct.id,
          artifactId: activeArtifact.id,
          runtimeStatus: runtime?.status,
          source: "frontend",
        })
        .then((recordedEvent) => {
          setRuntimeTimeline((current) =>
            mergeRuntimeTimelineEvents(current, [recordedEvent])
          );
        })
        .catch(() => {
          setRuntimeTimeline((current) =>
            mergeRuntimeTimelineEvents(current, [
              {
                ...event,
                id: `runtime-event-local-${Date.now()}-${current.length}`,
                timestamp: new Date().toISOString(),
                constructId: activeConstruct.id,
                artifactId: activeArtifact.id,
                runtimeStatus: runtime?.status,
                source: "frontend" as const,
              } satisfies ConstructRuntimeEvent,
            ])
          );
        });
    },
    [activeArtifact.id, activeConstruct.id, repository, runtime?.status]
  );

  const recordRuntimeValidation = useCallback(
    async (
      request: Omit<ConstructRuntimeValidation, "id" | "createdAt" | "constructId" | "artifactId">
    ) => {
      const validation = await repository.createConstructRuntimeValidation({
        ...request,
        constructId: activeConstruct.id,
        artifactId: activeArtifact.id,
      });
      setRuntimeValidations((current) =>
        [validation, ...current].slice(0, RUNTIME_VALIDATION_PAGE_SIZE)
      );
      setRuntimeValidationPage((current) => ({
        ...current,
        items: [validation, ...current.items].slice(0, current.pageSize),
        total: current.total + 1,
        pageCount: Math.max(1, Math.ceil((current.total + 1) / current.pageSize)),
      }));
      return validation;
    },
    [activeArtifact.id, activeConstruct.id, repository]
  );

  const downloadRuntimeHistoryExport = useCallback(async () => {
    setIsExportingRuntimeHistory(true);
    setRuntimeHistoryMessage(null);
    try {
      const result = await repository.exportConstructRuntimeEvents();
      const exportedAt = result.exportedAt || new Date().toISOString();
      const safeTimestamp = exportedAt.replace(/[:.]/g, "-");
      downloadJsonFile(`foundry-runtime-history-${safeTimestamp}.json`, result);
      setRuntimeHistoryMessage(
        `Exported ${result.eventCount} runtime event${
          result.eventCount === 1 ? "" : "s"
        } as JSON.`
      );
    } catch (historyError: unknown) {
      setRuntimeHistoryMessage(
        historyError instanceof Error
          ? historyError.message
          : "Could not export runtime history."
      );
    } finally {
      setIsExportingRuntimeHistory(false);
    }
  }, [repository]);

  const downloadRuntimeValidationExport = useCallback(async () => {
    setIsExportingRuntimeValidations(true);
    setRuntimeValidationExportMessage(null);
    try {
      const result = await repository.exportConstructRuntimeValidations({
        modelId:
          runtimeValidationModelFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationModelFilter,
        device:
          runtimeValidationDeviceFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationDeviceFilter,
        status:
          runtimeValidationStatusFilter === "all"
            ? undefined
            : runtimeValidationStatusFilter,
      });
      const exportedAt = result.exportedAt || new Date().toISOString();
      const safeTimestamp = exportedAt.replace(/[:.]/g, "-");
      downloadJsonFile(`foundry-runtime-validations-${safeTimestamp}.json`, result);
      setRuntimeValidationExportMessage(
        `Exported ${result.validationCount} validation run${
          result.validationCount === 1 ? "" : "s"
        } as JSON.`
      );
    } catch (validationError: unknown) {
      setRuntimeValidationExportMessage(
        validationError instanceof Error
          ? validationError.message
          : "Could not export validation history."
      );
    } finally {
      setIsExportingRuntimeValidations(false);
    }
  }, [
    repository,
    runtimeValidationDeviceFilter,
    runtimeValidationModelFilter,
    runtimeValidationStatusFilter,
  ]);

  const prepareDiagnosticsBundlePreview = async () => {
    setIsPreparingDiagnosticsBundle(true);
    setRuntimeHistoryMessage(null);
    try {
      const diagnosticsBundle = await repository.exportConstructDiagnosticsBundle({
        modelId:
          runtimeValidationModelFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationModelFilter,
        device:
          runtimeValidationDeviceFilter === ALL_VALIDATION_FILTER
            ? undefined
            : runtimeValidationDeviceFilter,
        status:
          runtimeValidationStatusFilter === "all"
            ? undefined
            : runtimeValidationStatusFilter,
      });
      const runtimeHistoryExport = diagnosticsBundle.runtimeHistory;
      const runtimeValidationExport = diagnosticsBundle.validationHistory.filteredExport;
      const exportedAt = diagnosticsBundle.exportedAt || new Date().toISOString();
      const safeTimestamp = exportedAt.replace(/[:.]/g, "-");
      setDiagnosticsBundlePreview({
        fileName: `foundry-construct-diagnostics-${safeTimestamp}.json`,
        bundle: diagnosticsBundle,
        eventCount: runtimeHistoryExport.eventCount,
        validationCount: runtimeValidationExport.validationCount,
        validationSummary: {
          filters: runtimeValidationExport.filters,
          validations: runtimeValidationExport.validations.slice(0, 5),
        },
        redactionAudit: diagnosticsBundle.redactionAudit || [],
        exportedAt,
        redactions: diagnosticsBundle.redactions || [
          "Hugging Face token value is not exported.",
          "Source material contents and chat message text are not bundled.",
        ],
      });
      setRuntimeHistoryMessage(
        `Prepared diagnostics bundle with ${runtimeHistoryExport.eventCount} runtime event${
          runtimeHistoryExport.eventCount === 1 ? "" : "s"
        } and ${runtimeValidationExport.validationCount} validation run${
          runtimeValidationExport.validationCount === 1 ? "" : "s"
        }. Review it before downloading.`
      );
    } catch (historyError: unknown) {
      setRuntimeHistoryMessage(
        historyError instanceof Error
          ? historyError.message
          : "Could not prepare diagnostics bundle."
      );
    } finally {
      setIsPreparingDiagnosticsBundle(false);
    }
  };

  const downloadDiagnosticsBundlePreview = () => {
    if (!diagnosticsBundlePreview) {
      return;
    }
    downloadJsonFile(diagnosticsBundlePreview.fileName, diagnosticsBundlePreview.bundle);
    setRuntimeHistoryMessage(
      `Downloaded diagnostics bundle prepared at ${formatRuntimeTimestamp(
        diagnosticsBundlePreview.exportedAt
      )}.`
    );
  };

  const clearRuntimeHistory = useCallback(async () => {
    if (!isConfirmingHistoryClear) {
      setIsConfirmingHistoryClear(true);
      setRuntimeHistoryMessage("Click Confirm Clear to remove saved runtime history.");
      return;
    }

    setIsClearingRuntimeHistory(true);
    try {
      const result = await repository.clearConstructRuntimeEvents();
      setRuntimeTimeline([]);
      setSelectedRuntimeEvent(null);
      setRuntimeHistoryFilter("all");
      setRuntimeHistoryMessage(
        `Cleared ${result.deletedCount} runtime event${
          result.deletedCount === 1 ? "" : "s"
        } at ${formatRuntimeTimestamp(result.clearedAt)}.`
      );
      setIsConfirmingHistoryClear(false);
    } catch (historyError: unknown) {
      setRuntimeHistoryMessage(
        historyError instanceof Error
          ? historyError.message
          : "Could not clear runtime history."
      );
    } finally {
      setIsClearingRuntimeHistory(false);
    }
  }, [isConfirmingHistoryClear, repository]);

  useEffect(() => {
    let isCurrent = true;
    setActiveConstruct(construct);
    setActiveArtifact(artifact);
    setMessages([
      {
        id: "welcome",
        sender: "assistant",
        text: `Artifact ${artifact.name} is loaded. Ask a question to test the Construct runtime contract.`,
      },
    ]);
    setLastInspection(null);
    setTrialVerdict(null);
    setSavedTrial(null);
    setTrialError(null);
    setRuntimeMode("simulated");
    setRuntimeDetail("Using deterministic simulated token streaming.");
    setRuntimeLoadPhase("idle");
    setRuntimeLoadTarget(configuredModelTarget || artifact.baseModel);
    const persistedSmokeResult = loadPersistedSmokeResult(construct.id, artifact.id);
    setRuntimeSmokeStatus(persistedSmokeResult ? "passed" : "idle");
    setRuntimeSmokeMessage(
      persistedSmokeResult
        ? `Last smoke test passed on ${persistedSmokeResult.device}. Run again to verify the current runtime.`
        : "Load the current model, stream a short reply, and inspect the runtime contract."
    );
    setRuntimeSmokeResult(persistedSmokeResult);
    setRuntimeMemoryReleaseMessage(null);
    setHandoffNotice(null);
    setPreflightResult(null);
    setReadinessGateMessage(null);
    setConfirmedCautionTarget(null);
    setProbeResult(null);
    setRuntimeTimeline([]);
    setRuntimeValidations([]);
    setRuntimeValidationPage(emptyRuntimeValidationPage());
    setRuntimeValidationModelFilter(ALL_VALIDATION_FILTER);
    setRuntimeValidationDeviceFilter(ALL_VALIDATION_FILTER);
    setRuntimeValidationStatusFilter("all");
    setRuntimeValidationPageNumber(1);
    setRuntimeValidationExportMessage(null);
    setSelectedRuntimeEvent(null);
      setSelectedRuntimeValidation(null);
      setIsConfirmingHistoryClear(false);
    setRuntimeHistoryMessage(null);
    setPromptRecipeMessage(null);
    repository
      .listConstructRuntimeEvents()
      .then((events) => {
        if (!isCurrent) {
          return;
        }
        if (events.length > 0) {
          setRuntimeTimeline(events.slice(0, 50));
          const backendSmokeResult = latestSmokeResultFromRuntimeEvents(
            events,
            construct.id,
            artifact.id
          );
          if (backendSmokeResult) {
            setRuntimeSmokeStatus("passed");
            setRuntimeSmokeMessage(
              `Last smoke test passed on ${backendSmokeResult.device}. Run again to verify the current runtime.`
            );
            setRuntimeSmokeResult(backendSmokeResult);
            persistSmokeResult(construct.id, artifact.id, backendSmokeResult);
          }
          return;
        }
        void repository
          .recordConstructRuntimeEvent({
            type: "handoff",
            status: "info",
            title: "Construct session ready",
            detail: `Runtime target set to ${configuredModelTarget || artifact.baseModel}.`,
            constructId: construct.id,
            artifactId: artifact.id,
            modelId: configuredModelTarget || artifact.baseModel,
            source: "frontend",
          })
          .then((event) => {
            if (isCurrent) {
              setRuntimeTimeline([event]);
            }
          });
      })
      .catch(() => {
        if (isCurrent) {
          setRuntimeTimeline([
            {
              id: `runtime-event-local-${Date.now()}`,
              type: "handoff",
              status: "info",
              title: "Construct session ready",
              detail: `Runtime target set to ${configuredModelTarget || artifact.baseModel}.`,
              timestamp: new Date().toISOString(),
              constructId: construct.id,
              artifactId: artifact.id,
              modelId: configuredModelTarget || artifact.baseModel,
              source: "frontend",
            },
          ]);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [artifact, configuredModelTarget, construct, repository]);

  useEffect(() => {
    void refreshRuntimeValidations();
  }, [refreshRuntimeValidations]);

  useEffect(() => {
    let isCurrent = true;

    repository
      .getConstructRuntime()
      .then((runtimeStatus) => {
        if (isCurrent) {
          setRuntime(runtimeStatus);
          setRuntimeMode(runtimeStatus.mode);
          setRuntimeDetail(runtimeStatus.detail);
          onRuntimeChanged?.(runtimeStatus);
        }
      })
      .catch((runtimeError: unknown) => {
        if (isCurrent) {
          setError(
            runtimeError instanceof Error ? runtimeError.message : "Could not load runtime status."
          );
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [onRuntimeChanged, repository]);

  useEffect(() => {
    const shouldPollTimeline =
      isRuntimeBusy ||
      isPreflightingRuntime ||
      isProbingRuntime ||
      runtimeSmokeStatus === "loading" ||
      runtimeSmokeStatus === "streaming";

    if (!shouldPollTimeline) {
      return;
    }

    let isCurrent = true;
    const pollTimeline = () => {
      if (isCurrent) {
        void refreshRuntimeTimeline();
      }
    };

    pollTimeline();
    const interval = window.setInterval(pollTimeline, 5000);
    return () => {
      isCurrent = false;
      window.clearInterval(interval);
    };
  }, [
    isPreflightingRuntime,
    isProbingRuntime,
    isRuntimeBusy,
    refreshRuntimeTimeline,
    runtimeSmokeStatus,
  ]);

  const formatBytes = (bytes: number) => {
    if (!bytes) {
      return "Unknown";
    }
    const gb = bytes / 1024 ** 3;
    if (gb >= 1) {
      return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
    }
    const mb = bytes / 1024 ** 2;
    return `${Math.max(1, Math.round(mb))} MB`;
  };

  const runRuntimePreflight = async (modelOverride?: string) => {
    const targetModel = modelOverride || configuredModelTarget || activeArtifact.baseModel;
    setIsPreflightingRuntime(true);
    setRuntimeLoadTarget(targetModel);
    setError(null);
    addRuntimeTimelineEvent({
      type: "preflight",
      status: "running",
      title: "Preflight started",
      detail: `Checking ${shortModelId(targetModel)} on ${settings.constructDevice}.`,
    });
    try {
      const result = await repository.preflightConstructRuntime({
        modelId: targetModel,
        device: settings.constructDevice,
      });
      await refreshRuntimeTimeline();
      setPreflightResult(result);
      setReadinessGateMessage(null);
      const readiness = buildRuntimeReadinessSummary(result);
      addRuntimeTimelineEvent({
        type: "preflight",
        status:
          readiness.status === "ready"
            ? "passed"
            : readiness.status === "caution"
            ? "warning"
            : "failed",
        title: readiness.title,
        detail: readiness.summary,
      });
      return result;
    } catch (runtimeError: unknown) {
      setPreflightResult(null);
      const message =
        runtimeError instanceof Error ? runtimeError.message : "Could not preflight runtime.";
      addRuntimeTimelineEvent({
        type: "preflight",
        status: "failed",
        title: "Preflight failed",
        detail: message,
      });
      setError(message);
      throw runtimeError;
    } finally {
      setIsPreflightingRuntime(false);
    }
  };

  useEffect(() => {
    if (!handoff?.modelId) {
      return;
    }

    const label = handoff.label || handoff.modelId;
    setRuntimeLoadTarget(handoff.modelId);
    setRuntimeSmokeStatus("idle");
    setRuntimeSmokeMessage("Archive handoff received. Run the smoke test when preflight is clear.");
    setHandoffNotice(`${label} arrived from Archive.`);
    setPreflightResult(null);
    setReadinessGateMessage(null);
    setConfirmedCautionTarget(null);
    setProbeResult(null);
    addRuntimeTimelineEvent({
      type: "handoff",
      status: "info",
      title: "Archive handoff received",
      detail: `${label} is ready for Construct preflight.`,
    });
    if (handoff.preflightOnOpen) {
      void runRuntimePreflight(handoff.modelId);
    }
    // The handoff timestamp is the command boundary; settings and artifact may settle in the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.requestedAt]);

  const configureRuntime = async () => {
    const targetModel = configuredModelTarget || runtimeLoadTarget || activeArtifact.baseModel;
    setIsRuntimeBusy(true);
    setRuntimeLoadPhase("configuring");
    setRuntimeLoadTarget(targetModel);
    setError(null);
    addRuntimeTimelineEvent({
      type: "configure",
      status: "running",
      title: "Configuring runtime",
      detail: `${settings.constructRuntimeMode} runtime targeting ${shortModelId(targetModel)}.`,
    });
    try {
      const runtimeStatus = await repository.configureConstructRuntime({
        mode: settings.constructRuntimeMode,
        modelId: targetModel,
        device: settings.constructDevice,
      });
      await refreshRuntimeTimeline();
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
      setRuntimeLoadPhase("ready");
      addRuntimeTimelineEvent({
        type: "configure",
        status: "passed",
        title: "Runtime configured",
        detail: `${runtimeStatus.mode} is ready on ${runtimeStatus.device}.`,
      });
    } catch (runtimeError: unknown) {
      const message =
        runtimeError instanceof Error ? runtimeError.message : "Could not configure runtime.";
      addRuntimeTimelineEvent({
        type: "configure",
        status: "failed",
        title: "Configure failed",
        detail: message,
      });
      setError(message);
      setRuntimeLoadPhase("failed");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const loadCurrentRuntime = async (options?: { confirmCaution?: boolean; modelOverride?: string }) => {
    const adapterBackedArtifact =
      activeArtifact.readiness?.artifactKind === "lora-adapter" && activeArtifact.adapterPath;
    const targetModel = adapterBackedArtifact
      ? activeArtifact.baseModel
      : options?.modelOverride || configuredModelTarget || runtimeLoadTarget || activeArtifact.baseModel;
    const adapterPath = adapterBackedArtifact ? activeArtifact.adapterPath : undefined;
    const preflight = await runRuntimePreflight(targetModel);
    const readiness = buildRuntimeReadinessSummary(preflight);
    if (!readiness.canLoad) {
      setRuntimeLoadPhase("failed");
      addRuntimeTimelineEvent({
        type: "load",
        status: "failed",
        title: "Load blocked",
        detail: readiness.nextAction,
      });
      throw new Error("Readiness check blocked loading. Fix the failed checks and preflight again.");
    }
    const cautionAlreadyConfirmed = confirmedCautionTarget === targetModel;
    if (readiness.requiresConfirmation && !options?.confirmCaution && !cautionAlreadyConfirmed) {
      setRuntimeLoadPhase("idle");
      setReadinessGateMessage("Caution review required. Choose Load Anyway to continue.");
      addRuntimeTimelineEvent({
        type: "load",
        status: "warning",
        title: "Load waiting for confirmation",
        detail: readiness.nextAction,
      });
      throw new Error("Caution review required before loading this model.");
    }
    if (readiness.requiresConfirmation && options?.confirmCaution) {
      setConfirmedCautionTarget(targetModel);
      setReadinessGateMessage(null);
    }
    if (!readiness.requiresConfirmation) {
      setConfirmedCautionTarget(null);
    }
    setRuntimeLoadPhase("configuring");
    setRuntimeLoadTarget(targetModel);
    setError(null);
    addRuntimeTimelineEvent({
      type: "configure",
      status: "running",
      title: "Runtime configure started",
      detail: adapterPath
        ? `Preparing transformers runtime for ${shortModelId(targetModel)} with ${activeArtifact.name}.`
        : `Preparing transformers runtime for ${shortModelId(targetModel)}.`,
    });
    const configured = await repository.configureConstructRuntime({
      mode: "transformers",
      modelId: targetModel,
      device: settings.constructDevice,
    });
    await refreshRuntimeTimeline();
    setRuntime(configured);
    setRuntimeMode(configured.mode);
    setRuntimeDetail(configured.detail);
    addRuntimeTimelineEvent({
      type: "configure",
      status: "passed",
      title: "Runtime configure passed",
      detail: `${configured.mode} selected on ${configured.device}.`,
    });
    setRuntimeLoadPhase("loading");
    addRuntimeTimelineEvent({
      type: "load",
      status: "running",
      title: adapterPath ? "Model and adapter load started" : "Model load started",
      detail: adapterPath
        ? `Loading ${shortModelId(targetModel)} plus adapter ${activeArtifact.id}.`
        : `Loading ${shortModelId(targetModel)} into the local runtime.`,
    });
    const runtimeStatus = await repository.loadConstructRuntime({
      modelId: targetModel,
      adapterPath,
      artifactId: adapterPath ? activeArtifact.id : undefined,
    });
    await refreshRuntimeTimeline();
    setRuntime(runtimeStatus);
    setRuntimeMode(runtimeStatus.mode);
    setRuntimeDetail(runtimeStatus.detail);
    onRuntimeChanged?.(runtimeStatus);
    setRuntimeLoadPhase("ready");
    const completedLoadEvent = getRuntimeLoadEvent(runtimeStatus);
    addRuntimeTimelineEvent({
      type: "load",
      status: "passed",
      title: adapterPath ? "Model and adapter loaded" : "Model loaded",
      detail: adapterPath
        ? `${shortModelId(targetModel)} loaded with adapter ${activeArtifact.id} on ${
            runtimeStatus.device
          } in ${formatLoadDuration(completedLoadEvent.durationSeconds)}.`
        : `${shortModelId(targetModel)} loaded on ${runtimeStatus.device} in ${formatLoadDuration(
            completedLoadEvent.durationSeconds
          )}.`,
    });
    return runtimeStatus;
  };

  const loadRuntime = async (options?: { confirmCaution?: boolean }) => {
    setIsRuntimeBusy(true);
    try {
      await loadCurrentRuntime(options);
    } catch (runtimeError: unknown) {
      const message = runtimeError instanceof Error ? runtimeError.message : "Could not load runtime.";
      addRuntimeTimelineEvent({
        type: "load",
        status: message.includes("Caution review") ? "warning" : "failed",
        title: message.includes("Caution review") ? "Load paused" : "Load failed",
        detail: message,
      });
      setError(message);
      setRuntimeLoadPhase("failed");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const unloadRuntime = async () => {
    setIsRuntimeBusy(true);
    setRuntimeLoadPhase("idle");
    setError(null);
    setRuntimeMemoryReleaseMessage(null);
    addRuntimeTimelineEvent({
      type: "unload",
      status: "running",
      title: "Unload requested",
      detail: `Releasing ${shortModelId(runtime?.modelId || runtimeLoadTarget)} from Construct.`,
    });
    try {
      const runtimeStatus = await repository.unloadConstructRuntime();
      await refreshRuntimeTimeline();
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
      addRuntimeTimelineEvent({
        type: "unload",
        status: "passed",
        title: "Runtime unloaded",
        detail: "Construct returned to a cold local runtime state.",
      });
    } catch (runtimeError: unknown) {
      const message = runtimeError instanceof Error ? runtimeError.message : "Could not unload runtime.";
      addRuntimeTimelineEvent({
        type: "unload",
        status: "failed",
        title: "Unload failed",
        detail: message,
      });
      setError(message);
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const releaseRuntimeMemory = async () => {
    setIsReleasingMemory(true);
    setRuntimeLoadPhase("idle");
    setError(null);
    setRuntimeMemoryReleaseMessage(null);
    addRuntimeTimelineEvent({
      type: "unload",
      status: "running",
      title: "Memory release requested",
      detail: `Clearing runtime cache and requesting memory cleanup for ${shortModelId(
        runtime?.modelId || runtimeLoadTarget
      )}.`,
    });
    try {
      const runtimeStatus = await repository.releaseConstructRuntimeMemory();
      await refreshRuntimeTimeline();
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
      const cleanup = (runtimeStatus.diagnostics?.memoryCleanup || {}) as Record<string, unknown>;
      const cacheBefore =
        typeof cleanup.cacheSizeBefore === "number" ? cleanup.cacheSizeBefore : 0;
      const cacheAfter =
        typeof cleanup.cacheSizeAfter === "number" ? cleanup.cacheSizeAfter : 0;
      const methods = Array.isArray(cleanup.methods)
        ? cleanup.methods.filter((method): method is string => typeof method === "string")
        : [];
      setRuntimeMemoryReleaseMessage(
        `Runtime memory released. Cache ${cacheBefore} -> ${cacheAfter}${
          methods.length ? ` via ${methods.join(", ")}` : ""
        }.`
      );
      addRuntimeTimelineEvent({
        type: "unload",
        status: cleanup.status === "warning" ? "warning" : "passed",
        title: "Memory released",
        detail: `Runtime cache ${cacheBefore} -> ${cacheAfter}. Metrics refreshed after cleanup.`,
      });
    } catch (runtimeError: unknown) {
      const message =
        runtimeError instanceof Error ? runtimeError.message : "Could not release runtime memory.";
      addRuntimeTimelineEvent({
        type: "unload",
        status: "failed",
        title: "Memory release failed",
        detail: message,
      });
      setError(message);
    } finally {
      setIsReleasingMemory(false);
    }
  };

  const probeRuntime = async () => {
    setIsProbingRuntime(true);
    setError(null);
    setProbeResult(null);
    addRuntimeTimelineEvent({
      type: "probe",
      status: "running",
      title: "Small model probe started",
      detail: `Testing ${shortModelId(probeModelId.trim() || "sshleifer/tiny-gpt2")}.`,
    });
    try {
      const result = await repository.probeConstructRuntime({
        modelId: probeModelId.trim() || "sshleifer/tiny-gpt2",
        prompt: probePrompt.trim() || "The Foundry is",
        maxNewTokens: Math.min(48, Math.max(1, settings.maxNewTokens || 24)),
        device: settings.constructDevice,
      });
      await refreshRuntimeTimeline();
      setProbeResult(result);
      if (result.ok) {
        setRuntimeMode("transformers");
        setRuntimeDetail(`Probe completed on ${result.device} in ${result.totalSeconds}s.`);
      }
      addRuntimeTimelineEvent({
        type: "probe",
        status: result.ok ? "passed" : "failed",
        title: result.ok ? "Small model probe passed" : "Small model probe failed",
        detail: result.ok
          ? `${shortModelId(result.modelId)} answered on ${result.device} in ${result.totalSeconds}s.`
          : result.error || "Probe did not return a usable response.",
      });
    } catch (runtimeError: unknown) {
      const message = runtimeError instanceof Error ? runtimeError.message : "Could not probe runtime.";
      addRuntimeTimelineEvent({
        type: "probe",
        status: "failed",
        title: "Small model probe failed",
        detail: message,
      });
      setError(message);
    } finally {
      setIsProbingRuntime(false);
    }
  };

  const sendMessage = async (
    presetText?: string,
    options?: SendMessageOptions
  ) => {
    const messageText = (presetText ?? input).trim();
    if (!messageText) {
      return;
    }
    const turnSystemPrompt = options?.systemPromptOverride ?? systemPrompt;
    const turnIncludeLibraryContext =
      options?.includeLibraryContextOverride ?? includeLibraryContext;

    const userMessage: ConstructMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: messageText,
      tokenCount: messageText.split(/\s+/).length,
    };

    setMessages((current) => [...current, userMessage]);
    if (!options?.preserveComposer) {
      setInput("");
    }
    setTrialVerdict(null);
    setSavedTrial(null);
    setTrialError(null);
    setIsSending(true);
    setError(null);

    try {
      if (options?.smokeTest) {
        setRuntimeSmokeStatus("streaming");
        setRuntimeSmokeMessage("Runtime loaded. Streaming the smoke prompt now.");
        setRuntimeSmokeResult(null);
      }
      const assistantMessageId = `assistant-${Date.now()}`;
      let assistantText = "";
      const activePromptChain = createPromptChain(
        turnSystemPrompt,
        messageText,
        turnIncludeLibraryContext
      );
      setMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          sender: "assistant",
          text: "",
        },
      ]);
      await repository.streamConstructChat(activeConstruct.id, {
        conversationId,
        message: messageText,
        systemPrompt: activePromptChain.systemPrompt || undefined,
        includeLibraryContext: turnIncludeLibraryContext,
        maxNewTokens: settings.maxNewTokens,
        temperature: settings.temperature,
      }, (event) => {
        if (event.type === "token") {
          assistantText += event.token;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, text: message.text + event.token }
                : message
            )
          );
          return;
        }
        if (event.type === "done") {
          setActiveConstruct(event.construct);
          setActiveArtifact(event.artifact);
          const eventRuntime = event.runtime;
          if (event.runtime) {
            setRuntimeMode(event.runtime.mode);
            setRuntimeDetail(event.runtime.detail);
            const nextRuntime = {
              mode: event.runtime?.mode === "transformers" ? "transformers" : "simulated",
              status: event.runtime?.status || runtime?.status || "fallback",
              detail: event.runtime?.detail || runtime?.detail || "",
              modelId: event.runtime?.modelId || runtime?.modelId || activeArtifact.baseModel,
              device: event.runtime?.device || runtime?.device || "none",
              loaded: event.runtime?.loaded ?? runtime?.loaded ?? false,
              diagnostics: event.runtime?.diagnostics || runtime?.diagnostics,
            } satisfies ConstructRuntime;
            setRuntime(nextRuntime);
            onRuntimeChanged?.(nextRuntime);
          }
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, id: event.messageId, tokenCount: event.totalTokens }
                : message
            )
          );
          setLastInspection({
            messageId: event.messageId,
            prompt: messageText,
            response: assistantText,
            totalTokens: event.totalTokens,
            runtimeMode: eventRuntime?.mode || runtimeMode,
            runtimeStatus: eventRuntime?.status || runtime?.status || "fallback",
            modelId: eventRuntime?.modelId || runtime?.modelId || activeArtifact.baseModel,
            device: eventRuntime?.device || runtime?.device || settings.constructDevice,
            contextWindow: event.generation.contextWindow,
            maxNewTokens: event.generation.maxNewTokens,
            temperature: event.generation.temperature,
            includeLibraryContext: event.generation.includeLibraryContext,
            systemPrompt: activePromptChain.systemPrompt,
            promptChain: event.generation.promptChain || activePromptChain,
            artifactId: event.artifact.id,
            constructId: event.construct.id,
          });
          if (event.trial) {
            setSavedTrial(event.trial);
            setTrialVerdict(event.trial.verdict);
            onLoopEvidenceRefresh?.();
          }
          if (options?.smokeTest) {
            const diagnostics = (eventRuntime?.diagnostics || {}) as Record<string, unknown>;
            const cleanup = (diagnostics.memoryCleanup || {}) as Record<string, unknown>;
            const memory = (diagnostics.memory || {}) as Record<string, unknown>;
            const smokeResult: RuntimeSmokeResult = {
              modelId: eventRuntime?.modelId || runtime?.modelId || activeArtifact.baseModel,
              device: eventRuntime?.device || runtime?.device || settings.constructDevice,
              totalTokens: event.totalTokens,
              durationSeconds: Number(
                ((performance.now() - (options.smokeStartedAt || performance.now())) / 1000).toFixed(2)
              ),
              cleanupStatus:
                typeof cleanup.status === "string" ? cleanup.status : memoryCleanupStatus,
              memoryAvailableGb:
                typeof memory.availableGb === "number" ? memory.availableGb : undefined,
              completedAt: new Date().toISOString(),
            };
            setRuntimeSmokeStatus("passed");
            setRuntimeSmokeMessage(
              `Smoke test passed on ${smokeResult.device}.`
            );
            setRuntimeSmokeResult(smokeResult);
            persistSmokeResult(event.construct.id, event.artifact.id, smokeResult);
            void recordRuntimeValidation({
              modelId: smokeResult.modelId,
              device: smokeResult.device,
              status: "passed",
              totalTokens: smokeResult.totalTokens,
              durationSeconds: smokeResult.durationSeconds,
              cleanupStatus: smokeResult.cleanupStatus,
              memoryAvailableGb: smokeResult.memoryAvailableGb,
              error: null,
              metadata: {
                source: "construct-smoke-test",
                prompt: LOCAL_SMOKE_PROMPT,
              },
            });
            addRuntimeTimelineEvent({
              type: "smoke",
              status: "passed",
              title: "Smoke test passed",
              detail: `Reply streamed with ${event.totalTokens} tokens on ${
                eventRuntime?.device || runtime?.device || settings.constructDevice
              }.`,
              modelId: smokeResult.modelId,
              metadata: {
                smokeResult,
              },
            });
          }
          return;
        }
        if (options?.smokeTest) {
          const failedModelId = runtime?.modelId || activeArtifact.baseModel;
          const failedDevice = runtime?.device || settings.constructDevice;
          setRuntimeSmokeStatus("failed");
          setRuntimeSmokeMessage(event.message);
          setRuntimeSmokeResult(null);
          void recordRuntimeValidation({
            modelId: failedModelId,
            device: failedDevice,
            status: "failed",
            totalTokens: 0,
            durationSeconds: Number(
              ((performance.now() - (options.smokeStartedAt || performance.now())) / 1000).toFixed(2)
            ),
            cleanupStatus: memoryCleanupStatus,
            memoryAvailableGb: undefined,
            error: event.message,
            metadata: {
              source: "construct-smoke-test",
              prompt: LOCAL_SMOKE_PROMPT,
            },
          });
          addRuntimeTimelineEvent({
            type: "smoke",
            status: "failed",
            title: "Smoke stream failed",
            detail: event.message,
          });
        }
        setError(event.message);
      });
    } catch (chatError: unknown) {
      if (options?.smokeTest) {
        const failedModelId = runtime?.modelId || activeArtifact.baseModel;
        const failedDevice = runtime?.device || settings.constructDevice;
        setRuntimeSmokeStatus("failed");
        setRuntimeSmokeMessage(
          chatError instanceof Error ? chatError.message : "Runtime smoke test failed."
        );
        setRuntimeSmokeResult(null);
        void recordRuntimeValidation({
          modelId: failedModelId,
          device: failedDevice,
          status: "failed",
          totalTokens: 0,
          durationSeconds: Number(
            ((performance.now() - (options.smokeStartedAt || performance.now())) / 1000).toFixed(2)
          ),
          cleanupStatus: memoryCleanupStatus,
          memoryAvailableGb: undefined,
          error: chatError instanceof Error ? chatError.message : "Runtime smoke test failed.",
          metadata: {
            source: "construct-smoke-test",
            prompt: LOCAL_SMOKE_PROMPT,
          },
        });
        addRuntimeTimelineEvent({
          type: "smoke",
          status: "failed",
          title: "Smoke test failed",
          detail: chatError instanceof Error ? chatError.message : "Runtime smoke test failed.",
        });
      }
      setError(chatError instanceof Error ? chatError.message : "Could not talk to Construct.");
    } finally {
      setIsSending(false);
    }
  };

  const runPromptComparisonRecipe = async () => {
    const comparisonPrompt =
      input.trim() ||
      lastInspection?.prompt ||
      "Explain what this Artifact learned from the Workshop Material, then name one uncertainty.";

    setIsRunningPromptRecipe(true);
    setPromptRecipeMessage("Running two prompt variants and capturing Trials.");
    setError(null);
    try {
      await sendMessage(comparisonPrompt, {
        systemPromptOverride: systemPrompt,
        includeLibraryContextOverride: includeLibraryContext,
        preserveComposer: true,
      });
      await sendMessage(comparisonPrompt, {
        systemPromptOverride: evidencePromptDefault,
        includeLibraryContextOverride: true,
        preserveComposer: true,
      });
      setPromptRecipeMessage(
        "Prompt comparison recipe captured two Trials. Opening Trials comparison."
      );
      onOpenTrialComparison?.();
    } catch (recipeError: unknown) {
      setPromptRecipeMessage(null);
      setError(
        recipeError instanceof Error
          ? recipeError.message
          : "Prompt comparison recipe failed."
      );
    } finally {
      setIsRunningPromptRecipe(false);
    }
  };

  const runRuntimeSmokeTest = async () => {
    const smokeModel = LOCAL_SMOKE_MODEL_ID;
    if (!smokeModelCached) {
      const detail =
        "sshleifer/tiny-gpt2 is a tiny smoke-test model for proving download, preflight, load, streaming, and cleanup. It is not a quality benchmark.";
      setRuntimeSmokeStatus("idle");
      setRuntimeSmokeMessage("Preparing the tiny smoke-test model in Archive.");
      addRuntimeTimelineEvent({
        type: "smoke",
        status: "info",
        title: "Smoke model preparation requested",
        detail,
        modelId: smokeModel,
      });
      onPrepareModel?.({
        type: "download-model",
        label: "Prepare Smoke Model",
        detail,
        modelId: smokeModel,
      });
      return;
    }

    const smokeStartedAt = performance.now();
    setIsRuntimeBusy(true);
    setRuntimeSmokeStatus("loading");
    setRuntimeSmokeMessage(
      `Loading cached smoke model ${shortModelId(
        smokeModel
      )}. This verifies runtime wiring, not answer quality.`
    );
    setRuntimeSmokeResult(null);
    setError(null);
    addRuntimeTimelineEvent({
      type: "smoke",
      status: "running",
      title: "Smoke test started",
      detail: `Construct will load cached ${shortModelId(
        smokeModel
      )}, stream a short verification reply, then clean memory.`,
    });
    try {
      await loadCurrentRuntime({ modelOverride: smokeModel });
      setIsRuntimeBusy(false);
      await sendMessage(LOCAL_SMOKE_PROMPT, { smokeTest: true, smokeStartedAt });
    } catch (runtimeError: unknown) {
      setRuntimeSmokeStatus("failed");
      setRuntimeLoadPhase("failed");
      setRuntimeSmokeResult(null);
      setRuntimeSmokeMessage(
        runtimeError instanceof Error ? runtimeError.message : "Runtime smoke test failed."
      );
      setError(runtimeError instanceof Error ? runtimeError.message : "Runtime smoke test failed.");
      setIsRuntimeBusy(false);
    }
  };

  const saveTrial = async (verdict: ReviewedTrialVerdict) => {
    if (!lastInspection) {
      return;
    }

    setIsSavingTrial(true);
    setTrialError(null);
    try {
      const trial = await repository.createTrial(activeArtifact.workshopId, {
        artifactId: lastInspection.artifactId,
        constructId: lastInspection.constructId,
        messageId: lastInspection.messageId,
        prompt: lastInspection.prompt,
        response: lastInspection.response,
        verdict,
        runtimeMode: lastInspection.runtimeMode,
        tokenCount: lastInspection.totalTokens,
        generationSettings: {
          contextWindow: lastInspection.contextWindow,
          maxNewTokens: lastInspection.maxNewTokens,
          temperature: lastInspection.temperature,
          includeLibraryContext: lastInspection.includeLibraryContext,
          systemPrompt: lastInspection.systemPrompt,
          promptChain:
            lastInspection.promptChain ||
            createPromptChain(
              lastInspection.systemPrompt,
              lastInspection.prompt,
              lastInspection.includeLibraryContext
            ),
          runtimeStatus: lastInspection.runtimeStatus,
          modelId: lastInspection.modelId,
          device: lastInspection.device,
          runtime,
        },
      });
      setTrialVerdict(verdict);
      setSavedTrial(trial);
      onLoopEvidenceRefresh?.();
    } catch (saveError: unknown) {
      setTrialError(saveError instanceof Error ? saveError.message : "Could not save Trial.");
    } finally {
      setIsSavingTrial(false);
    }
  };

  const promptPresets = [
    "Introduce yourself in the target voice and name what you were trained to understand.",
    "Answer as the target persona. What should I ask you to test the Artifact?",
    "Explain one thing you learned from the training Material, and be honest if the source data is missing.",
    "Give a short refusal if the question is outside your source Material.",
  ];

  const runtimeMemory = getRuntimeMemory(runtime);
  const loadedModel = getLoadedModelSnapshot(runtime);
  const smokeArchiveEntry = findSmokeModelArchiveEntry(archiveEntries);
  const smokeModelCached = isModelArchiveEntryCached(smokeArchiveEntry);
  const smokeModelPreparing =
    preparationActivity?.state === "downloading" ||
    preparationActivity?.state === "routing" ||
    preparationActivity?.state === "registering" ||
    preparationActivity?.state === "handoff";
  const memoryCleanup = (runtime?.diagnostics?.memoryCleanup || {}) as Record<string, unknown>;
  const memoryCleanupStatus =
    typeof memoryCleanup.status === "string" ? memoryCleanup.status : "idle";
  const memoryCleanupFinishedAt =
    typeof memoryCleanup.finishedAt === "string" ? memoryCleanup.finishedAt : null;
  const memoryCleanupMethods = Array.isArray(memoryCleanup.methods)
    ? memoryCleanup.methods.filter((method): method is string => typeof method === "string")
    : [];
  const memoryCleanupCacheBefore =
    typeof memoryCleanup.cacheSizeBefore === "number" ? memoryCleanup.cacheSizeBefore : null;
  const memoryCleanupCacheAfter =
    typeof memoryCleanup.cacheSizeAfter === "number" ? memoryCleanup.cacheSizeAfter : null;
  const loadedModelDiagnostics =
    runtime?.diagnostics?.loadedModel && typeof runtime.diagnostics.loadedModel === "object"
      ? (runtime.diagnostics.loadedModel as Record<string, unknown>)
      : {};
  const loadedModelAdapterPath =
    typeof loadedModelDiagnostics.adapterPath === "string"
      ? loadedModelDiagnostics.adapterPath
      : null;
  const loadedModelAdapterLoaded = loadedModelDiagnostics.adapterLoaded === true;
  const apiReachable = Boolean(sourceStatus?.api.reachable);
  const constructReachable = Boolean(sourceStatus?.construct.reachable);
  const sourceReachabilityLabel = sourceStatus
    ? apiReachable
      ? "API reachable"
      : activeFoundryDataSource.liveConstruct
        ? "API offline"
        : "Mock mode"
    : activeFoundryDataSource.liveConstruct
      ? "Checking API"
      : "Mock mode";
  const sourceRuntimeDetail = sourceStatus?.construct.detail || activeFoundryDataSource.detail;
  const loadEvent = getRuntimeLoadEvent(runtime);
  const runtimeLoadingAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.constructRuntimeLoading
  );
  const adapterEvidenceAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.constructAdapterEvidence
  );
  const memoryCleanupAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.constructMemoryCleanup
  );
  const adapterEvidenceLabel = activeArtifact.adapterPath
    ? "Adapter registered"
    : loadedModelAdapterLoaded
      ? "Adapter loaded"
      : "No adapter";
  const runtimePhaseLabel = {
    idle: "Idle",
    configuring: "Configuring",
    loading: "Loading",
    ready: "Ready",
    failed: "Failed",
  }[runtimeLoadPhase];
  const readinessSummary = useMemo(
    () => (preflightResult ? buildRuntimeReadinessSummary(preflightResult) : null),
    [preflightResult]
  );
  const runtimeHistoryCounts = useMemo(
    () =>
      RUNTIME_HISTORY_FILTERS.reduce<Record<RuntimeHistoryFilter, number>>(
        (counts, filter) => ({
          ...counts,
          [filter.id]: runtimeTimeline.filter((event) =>
            runtimeHistoryMatchesFilter(event, filter.id)
          ).length,
        }),
        {
          all: 0,
          smoke: 0,
          load: 0,
          preflight: 0,
          memory: 0,
          failures: 0,
        }
      ),
    [runtimeTimeline]
  );
  const filteredRuntimeTimeline = useMemo(
    () =>
      runtimeTimeline.filter((event) =>
        runtimeHistoryMatchesFilter(event, runtimeHistoryFilter)
      ),
    [runtimeHistoryFilter, runtimeTimeline]
  );
  const runtimeValidationModelOptions = useMemo(
    () => uniqueSortedValues(runtimeValidationPage.facets.models.map((facet) => facet.value)),
    [runtimeValidationPage.facets.models]
  );
  const runtimeValidationDeviceOptions = useMemo(
    () => uniqueSortedValues(runtimeValidationPage.facets.devices.map((facet) => facet.value)),
    [runtimeValidationPage.facets.devices]
  );
  const runtimeValidationCounts = useMemo(
    () => ({
      all: runtimeValidationPage.facets.statuses.reduce((total, facet) => total + facet.count, 0),
      passed:
        runtimeValidationPage.facets.statuses.find((facet) => facet.value === "passed")?.count || 0,
      failed:
        runtimeValidationPage.facets.statuses.find((facet) => facet.value === "failed")?.count || 0,
    }),
    [runtimeValidationPage.facets.statuses]
  );
  const filteredRuntimeValidations = runtimeValidations;
  const runtimeValidationPassRate = runtimeValidationCounts.all
    ? Math.round((runtimeValidationCounts.passed / runtimeValidationCounts.all) * 100)
    : 0;
  const latestRuntimeValidation = runtimeValidations[0] || null;
  const readinessBlocksLoad = readinessSummary?.status === "blocked";
  const currentReadinessTarget = preflightResult?.modelId || runtimeLoadTarget;
  const readinessNeedsConfirmation =
    readinessSummary?.requiresConfirmation === true &&
    confirmedCautionTarget !== currentReadinessTarget;
  const loadButtonDisabled =
    isRuntimeBusy ||
    isPreflightingRuntime ||
    isSending ||
    isReleasingMemory ||
    readinessBlocksLoad ||
    readinessNeedsConfirmation;
  const smokeButtonDisabled =
    isRuntimeBusy ||
    isSending ||
    isPreflightingRuntime ||
    isReleasingMemory ||
    smokeModelPreparing ||
    (smokeModelCached && (readinessBlocksLoad || readinessNeedsConfirmation));
  const smokeButtonLabel = smokeModelPreparing
    ? "Preparing"
    : !smokeModelCached
    ? "Prepare Smoke Model"
    : runtimeSmokeStatus === "loading"
    ? "Loading"
    : runtimeSmokeStatus === "streaming"
    ? "Streaming"
    : "Run Smoke Test";
  const smokeButtonTitle = !smokeModelCached
    ? "Download the tiny smoke-test model into Archive before loading it."
    : readinessBlocksLoad
    ? "Readiness checks blocked loading."
    : readinessNeedsConfirmation
    ? "Load with caution must be confirmed before smoke testing."
    : "Load the runtime and stream a smoke-test prompt.";
  const loadButtonLabel = isRuntimeBusy
    ? runtimePhaseLabel
    : readinessBlocksLoad
    ? "Blocked"
    : readinessNeedsConfirmation
    ? "Review Caution"
    : "Load Current Model";
  const constructNextAction = useMemo(() => {
    if (!constructLoopFocused) {
      return undefined;
    }
    if (runtime?.loaded) {
      return "Send a prompt, inspect the runtime evidence, then save the reply as a Trial verdict.";
    }
    if (readinessBlocksLoad) {
      return readinessSummary?.nextAction || "Resolve runtime readiness blockers before loading.";
    }
    if (readinessNeedsConfirmation) {
      return "Review the caution state and confirm the target before loading the model.";
    }
    if (!smokeModelCached) {
      return "Prepare the tiny smoke model or select a cached Archive model before loading.";
    }
    return "Load the current model, then run a smoke prompt to prove streaming inference.";
  }, [
    constructLoopFocused,
    readinessBlocksLoad,
    readinessNeedsConfirmation,
    readinessSummary?.nextAction,
    runtime?.loaded,
    smokeModelCached,
  ]);
  const formatTimelineTime = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));

  return (
    <section className="construct-workbench" aria-label="Local model construct">
      <div className="construct-brief panel-glass">
        <div>
          <p className="section-eyebrow">Construct</p>
          <h1>Talk to your local model</h1>
          <p>
            Run an inference session against the active Artifact and inspect the
            generation settings the runtime contract receives.
          </p>
        </div>
        <div className="construct-status-grid">
          <div>
            <span>Artifact</span>
            <strong>{activeArtifact.name}</strong>
          </div>
          <div>
            <span>Base</span>
            <strong>{activeArtifact.baseModel}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{activeConstruct.status}</strong>
          </div>
        </div>
      </div>

      <LoopFocusCallout
        focus={loopFocus}
        nextAction={constructNextAction}
        section="construct"
      />

      <div className="construct-grid">
        <div className="construct-chat panel-glass">
          <div className="chat-surface">
            <div className="chat-header">
              <div>
                <p className="panel-kicker">Runtime contract</p>
                <h1>{activeConstruct.name}</h1>
              </div>
              <div className="chat-context-pills">
                <span title="Context window">
                  <i className="fas fa-window-maximize" aria-hidden="true" />
                  {activeConstruct.contextWindow.toLocaleString()}
                </span>
                <span title="Max new tokens">
                  <i className="fas fa-align-left" aria-hidden="true" />
                  {settings.maxNewTokens}
                </span>
                <span title="Temperature">
                  <i className="fas fa-temperature-half" aria-hidden="true" />
                  {settings.temperature}
                </span>
                <span title={runtimeDetail}>
                  <i className="fas fa-microchip" aria-hidden="true" />
                  {runtimeMode}
                </span>
              </div>
            </div>

            <div
              className={`construct-runtime-card ${constructLoopFocused ? "is-loop-focused" : ""}`}
              ref={constructRuntimeFocusRef}
            >
              <div className="runtime-load-header">
                <div>
                  <p className="panel-kicker">Local runtime</p>
                  <strong>{runtime?.loaded ? "Model loaded" : "Ready to load cached model"}</strong>
                </div>
                <div className="runtime-load-actions">
                  <span className={`status-badge runtime-phase-${runtimeLoadPhase}`}>
                    {runtimePhaseLabel}
                  </span>
                  <AcademyActionTooltip
                    action={runtimeLoadingAcademyAction}
                    label="Why load?"
                  />
                </div>
              </div>
              <span>{runtimeLoadTarget}</span>
              {handoffNotice && (
                <article className="runtime-handoff-banner">
                  <div>
                    <span>Archive handoff</span>
                    <strong>{handoffNotice}</strong>
                    <p>
                      Construct is checking compatibility now. Load stays manual so you can review
                      memory fit before starting inference.
                    </p>
                  </div>
                  <span
                    className={`status-badge ${
                      preflightResult
                        ? preflightResult.ok
                          ? "fit-fits"
                          : `fit-${preflightResult.fitStatus}`
                        : "runtime-phase-configuring"
                    }`}
                  >
                    {isPreflightingRuntime
                      ? "checking"
                      : preflightResult
                      ? preflightResult.ok
                        ? "preflight ready"
                        : "review"
                      : "queued"}
                  </span>
                </article>
              )}
              <div className="runtime-control-grid">
                <span
                  className={`status-badge source-${activeFoundryDataSource.mode}`}
                  title={activeFoundryDataSource.detail}
                >
                  {sourceReachabilityLabel}
                </span>
                <span className="status-badge">{runtime?.status || runtimeMode}</span>
                <span className="status-badge">{runtime?.loaded ? "loaded" : "not loaded"}</span>
                <span className="status-badge">{runtime?.device || settings.constructDevice}</span>
              </div>
              <div className="runtime-source-strip">
                <span>
                  {activeFoundryDataSource.label}
                  {constructReachable ? " connected" : ""}
                  <AcademyActionTooltip
                    action={runtimeLoadingAcademyAction}
                    label="?"
                  />
                </span>
                <strong>{sourceRuntimeDetail}</strong>
              </div>
              <SystemReadinessPanel
                compact
                settings={settings}
                sourceStatus={sourceStatus}
                runtime={runtime}
                archiveEntries={archiveEntries}
                preparationActivity={preparationActivity}
                onPrepareModel={onPrepareModel}
                onCancelPreparation={onCancelPreparation}
              />
              <div className="runtime-load-meter" aria-label={`Runtime load ${runtimePhaseLabel}`}>
                {(["configuring", "loading", "ready"] as RuntimeLoadPhase[]).map((phase) => (
                  <span
                    className={
                      runtimeLoadPhase === phase ||
                      (runtimeLoadPhase === "ready" && phase !== "configuring")
                        ? "is-active"
                        : ""
                    }
                    key={phase}
                  />
                ))}
              </div>
              <div className="runtime-diagnostics-grid">
                <div>
                  <span>Loaded model</span>
                  <strong>{shortModelId(loadedModel.modelId)}</strong>
                </div>
                <div>
                  <span>
                    Adapter
                    <AcademyActionTooltip
                      action={adapterEvidenceAcademyAction}
                      label="?"
                    />
                  </span>
                  <strong>{loadedModelAdapterPath || activeArtifact.adapterPath || adapterEvidenceLabel}</strong>
                </div>
                <div>
                  <span>Device</span>
                  <strong>{loadedModel.device || runtime?.device || settings.constructDevice}</strong>
                </div>
                <div>
                  <span>Memory</span>
                  <strong>
                    {runtimeMemory?.percentUsed !== undefined
                      ? `${runtimeMemory.percentUsed}%`
                      : "n/a"}
                  </strong>
                </div>
                <div>
                  <span>Available</span>
                  <strong>
                    {runtimeMemory?.availableGb !== undefined
                      ? `${runtimeMemory.availableGb} GB`
                      : "n/a"}
                  </strong>
                </div>
                <div>
                  <span>Cache</span>
                  <strong>{loadedModel.cacheSize !== undefined ? loadedModel.cacheSize : "n/a"}</strong>
                </div>
                <div>
                  <span>Last load</span>
                  <strong>{loadEvent.status || "idle"}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{formatLoadDuration(loadEvent.durationSeconds)}</strong>
                </div>
                <div>
                  <span>
                    Memory cleanup
                    <AcademyActionTooltip
                      action={memoryCleanupAcademyAction}
                      label="?"
                    />
                  </span>
                  <strong>{memoryCleanupStatus}</strong>
                </div>
                <div>
                  <span>Cleanup at</span>
                  <strong>{formatRuntimeTimestamp(memoryCleanupFinishedAt)}</strong>
                </div>
                <div>
                  <span>Cleanup methods</span>
                  <strong>{memoryCleanupMethods.length ? memoryCleanupMethods.join(", ") : "n/a"}</strong>
                </div>
                <div>
                  <span>Cache released</span>
                  <strong>
                    {memoryCleanupCacheBefore !== null && memoryCleanupCacheAfter !== null
                      ? `${memoryCleanupCacheBefore} -> ${memoryCleanupCacheAfter}`
                      : "n/a"}
                  </strong>
                </div>
              </div>
              {loadEvent.failureReason && (
                <p className="runtime-load-failure">
                  Load failed: {loadEvent.failureReason}
                </p>
              )}
              {runtimeMemoryReleaseMessage && (
                <p className="save-state success-state">{runtimeMemoryReleaseMessage}</p>
              )}
              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  disabled={isPreflightingRuntime || isRuntimeBusy || isSending || isReleasingMemory}
                  onClick={() => void runRuntimePreflight()}
                  type="button"
                >
                  <i className="fas fa-clipboard-check" aria-hidden="true" />
                  {isPreflightingRuntime ? "Checking" : "Preflight"}
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={isRuntimeBusy || isReleasingMemory}
                  onClick={configureRuntime}
                  type="button"
                >
                  <i className="fas fa-sliders" aria-hidden="true" />
                  Configure
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={loadButtonDisabled}
                  onClick={() => void loadRuntime()}
                  title={
                    readinessBlocksLoad
                      ? "Readiness checks blocked loading."
                      : readinessNeedsConfirmation
                      ? "Review the caution checklist and choose Load Anyway."
                      : "Load the current model into the Construct runtime."
                  }
                  type="button"
                >
                  <i className="fas fa-download" aria-hidden="true" />
                  {loadButtonLabel}
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={isRuntimeBusy || isReleasingMemory}
                  onClick={unloadRuntime}
                  type="button"
                >
                  <i className="fas fa-power-off" aria-hidden="true" />
                  Unload
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={isRuntimeBusy || isSending || isReleasingMemory}
                  onClick={() => void releaseRuntimeMemory()}
                  title="Clear cached model references and request Python/CUDA/MPS memory cleanup."
                  type="button"
                >
                  <i className="fas fa-broom" aria-hidden="true" />
                  {isReleasingMemory ? "Releasing" : "Release Memory"}
                </button>
              </div>
              {preflightResult && (
                <article className={`runtime-preflight-card fit-${preflightResult.fitStatus}`}>
                  <div className="runtime-preflight-header">
                    <div>
                      <strong>{preflightResult.ok ? "Preflight passed" : "Preflight needs review"}</strong>
                      <span>{preflightResult.modelType || "unknown model"} · {preflightResult.device}</span>
                    </div>
                    <span className={`status-badge fit-${preflightResult.fitStatus}`}>
                      {preflightResult.fitStatus}
                    </span>
                  </div>
                  <div className="runtime-preflight-stats">
                    <div>
                      <span>Estimated load</span>
                      <strong>{formatBytes(preflightResult.estimatedLoadBytes)}</strong>
                    </div>
                    <div>
                      <span>Available</span>
                      <strong>{formatBytes(preflightResult.availableBytes)}</strong>
                    </div>
                    <div>
                      <span>Context</span>
                      <strong>{preflightResult.contextWindow?.toLocaleString() || "n/a"}</strong>
                    </div>
                  </div>
                  <div className="runtime-preflight-checks">
                    {preflightResult.checks.map((check) => (
                      <div className={`preflight-check is-${check.status}`} key={check.id}>
                        <span>{check.label}</span>
                        <strong>{check.status}</strong>
                        <p>{check.detail}</p>
                      </div>
                    ))}
                  </div>
                  {preflightResult.warnings.length > 0 && (
                    <ul className="runtime-preflight-warnings">
                      {preflightResult.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </article>
              )}
              {readinessSummary && (
                <article className={`runtime-readiness-card readiness-${readinessSummary.status}`}>
                  <div className="runtime-readiness-header">
                    <div>
                      <p className="panel-kicker">Readiness checklist</p>
                      <strong>{readinessSummary.title}</strong>
                      <span>{readinessSummary.summary}</span>
                    </div>
                    <span className={`status-badge readiness-${readinessSummary.status}`}>
                      {readinessSummary.status}
                    </span>
                  </div>
                  <div className="runtime-readiness-items">
                    {readinessSummary.items.map((item) => (
                      <div className={`readiness-item is-${item.status}`} key={item.label}>
                        <i
                          className={`fas ${
                            item.status === "pass"
                              ? "fa-check"
                              : item.status === "warn"
                              ? "fa-triangle-exclamation"
                              : "fa-xmark"
                          }`}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.guidance}</span>
                          <p>{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {readinessSummary.warnings.length > 0 && (
                    <div className="runtime-readiness-warnings">
                      {readinessSummary.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  )}
                  <div className="runtime-readiness-next">
                    <span>Next step</span>
                    <strong>{readinessSummary.nextAction}</strong>
                  </div>
                  {readinessGateMessage && (
                    <p className="runtime-readiness-gate">{readinessGateMessage}</p>
                  )}
                  {readinessSummary.requiresConfirmation && (
                    <div className="runtime-readiness-actions">
                      <button
                        className="button-primary button-compact"
                        disabled={isRuntimeBusy || isPreflightingRuntime || isSending}
                        onClick={() => void loadRuntime({ confirmCaution: true })}
                        type="button"
                      >
                        <i className="fas fa-triangle-exclamation" aria-hidden="true" />
                        {readinessSummary.loadButtonLabel}
                      </button>
                    </div>
                  )}
                </article>
              )}
              <div className={`runtime-smoke-card smoke-${runtimeSmokeStatus}`}>
                <div>
                  <strong>Runtime Smoke Test</strong>
                  <span>{runtimeSmokeMessage}</span>
                  <small>
                    Uses {LOCAL_SMOKE_MODEL_ID} to verify Archive download, preflight, load,
                    streaming, and cleanup. It is not a response-quality benchmark.
                  </small>
                  <em>{smokeModelCached ? "Smoke model cached" : "Smoke model not cached"}</em>
                </div>
                <button
                  className="button-primary button-compact"
                  disabled={smokeButtonDisabled}
                  onClick={() => void runRuntimeSmokeTest()}
                  title={smokeButtonTitle}
                  type="button"
                >
                  <i className="fas fa-bolt" aria-hidden="true" />
                  {smokeButtonLabel}
                </button>
              </div>
              {runtimeSmokeResult && (
                <article className="runtime-smoke-result">
                  <div>
                    <span>Model</span>
                    <strong>{shortModelId(runtimeSmokeResult.modelId)}</strong>
                  </div>
                  <div>
                    <span>Device</span>
                    <strong>{runtimeSmokeResult.device}</strong>
                  </div>
                  <div>
                    <span>Tokens</span>
                    <strong>{runtimeSmokeResult.totalTokens}</strong>
                  </div>
                  <div>
                    <span>Duration</span>
                    <strong>{runtimeSmokeResult.durationSeconds}s</strong>
                  </div>
                  <div>
                    <span>Cleanup</span>
                    <strong>{runtimeSmokeResult.cleanupStatus}</strong>
                  </div>
                  <div>
                    <span>Available</span>
                    <strong>
                      {runtimeSmokeResult.memoryAvailableGb !== undefined
                        ? `${runtimeSmokeResult.memoryAvailableGb} GB`
                        : "n/a"}
                    </strong>
                  </div>
                  <div>
                    <span>Saved</span>
                    <strong>{formatRuntimeTimestamp(runtimeSmokeResult.completedAt)}</strong>
                  </div>
                </article>
              )}
              <article className="runtime-validation-card">
                <div className="runtime-validation-header">
                  <div>
                    <p className="panel-kicker">Runtime Validation</p>
                    <h3>Smoke history</h3>
                  </div>
                  <div className="runtime-validation-header-actions">
                    <span>
                      {filteredRuntimeValidations.length} of {runtimeValidationPage.total} matching
                    </span>
                    <button
                      className="button-secondary button-compact"
                      disabled={
                        isExportingRuntimeValidations ||
                        (runtimeValidationPage.total === 0 && runtimeValidationCounts.all === 0)
                      }
                      onClick={() => void downloadRuntimeValidationExport()}
                      type="button"
                    >
                      {isExportingRuntimeValidations ? "Exporting" : "Export JSON"}
                    </button>
                    <button
                      className="button-secondary button-compact"
                      disabled={isPreparingDiagnosticsBundle}
                      onClick={() => void prepareDiagnosticsBundlePreview()}
                      type="button"
                    >
                      {isPreparingDiagnosticsBundle ? "Preparing" : "Preview Bundle"}
                    </button>
                  </div>
                </div>
                {runtimeValidationExportMessage && (
                  <p className="runtime-validation-export-message">
                    {runtimeValidationExportMessage}
                  </p>
                )}
                {runtimeValidationPage.total > 0 || runtimeValidationCounts.all > 0 ? (
                  <>
                    <div className="runtime-validation-summary">
                      <div>
                        <span>Models</span>
                        <strong>{runtimeValidationModelOptions.length}</strong>
                      </div>
                      <div>
                        <span>Devices</span>
                        <strong>{runtimeValidationDeviceOptions.length}</strong>
                      </div>
                      <div>
                        <span>Pass rate</span>
                        <strong>{runtimeValidationPassRate}%</strong>
                      </div>
                      <div>
                        <span>Latest</span>
                        <strong>
                          {latestRuntimeValidation
                            ? formatRuntimeTimestamp(latestRuntimeValidation.createdAt)
                            : "n/a"}
                        </strong>
                      </div>
                    </div>
                    <div className="runtime-validation-filters" aria-label="Validation filters">
                      <div>
                        <span>Model</span>
                        <button
                          className={`runtime-validation-filter ${
                            runtimeValidationModelFilter === ALL_VALIDATION_FILTER
                              ? "is-active"
                              : ""
                          }`}
                          onClick={() => {
                            setRuntimeValidationModelFilter(ALL_VALIDATION_FILTER);
                            setRuntimeValidationPageNumber(1);
                          }}
                          type="button"
                        >
                          All
                        </button>
                        {runtimeValidationModelOptions.map((modelId) => (
                          <button
                            className={`runtime-validation-filter ${
                              runtimeValidationModelFilter === modelId ? "is-active" : ""
                            }`}
                            key={modelId}
                            onClick={() => {
                              setRuntimeValidationModelFilter(modelId);
                              setRuntimeValidationPageNumber(1);
                            }}
                            title={modelId}
                            type="button"
                          >
                            {shortModelId(modelId)}
                          </button>
                        ))}
                      </div>
                      <div>
                        <span>Device</span>
                        <button
                          className={`runtime-validation-filter ${
                            runtimeValidationDeviceFilter === ALL_VALIDATION_FILTER
                              ? "is-active"
                              : ""
                          }`}
                          onClick={() => {
                            setRuntimeValidationDeviceFilter(ALL_VALIDATION_FILTER);
                            setRuntimeValidationPageNumber(1);
                          }}
                          type="button"
                        >
                          All
                        </button>
                        {runtimeValidationDeviceOptions.map((device) => (
                          <button
                            className={`runtime-validation-filter ${
                              runtimeValidationDeviceFilter === device ? "is-active" : ""
                            }`}
                            key={device}
                            onClick={() => {
                              setRuntimeValidationDeviceFilter(device);
                              setRuntimeValidationPageNumber(1);
                            }}
                            type="button"
                          >
                            {device}
                          </button>
                        ))}
                      </div>
                      <div>
                        <span>Status</span>
                        {(["all", "passed", "failed"] as RuntimeValidationStatusFilter[]).map(
                          (status) => (
                            <button
                              className={`runtime-validation-filter ${
                                runtimeValidationStatusFilter === status ? "is-active" : ""
                              }`}
                              key={status}
                              onClick={() => {
                                setRuntimeValidationStatusFilter(status);
                                setRuntimeValidationPageNumber(1);
                              }}
                              type="button"
                            >
                              {status}
                              <strong>{runtimeValidationCounts[status]}</strong>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    {filteredRuntimeValidations.length > 0 ? (
                      <div className="runtime-validation-list">
                        {filteredRuntimeValidations.slice(0, 5).map((validation) => (
                          <button
                            aria-label={`Inspect validation details for ${shortModelId(
                              validation.modelId
                            )} on ${validation.device}`}
                            className={`runtime-validation-row is-${validation.status}`}
                            key={validation.id}
                            onClick={() => setSelectedRuntimeValidation(validation)}
                            title="Inspect validation details"
                            type="button"
                          >
                            <div>
                              <strong>{shortModelId(validation.modelId)}</strong>
                              <span>{validation.device}</span>
                            </div>
                            <div>
                              <strong>{validation.status}</strong>
                              <span>{formatRuntimeTimestamp(validation.createdAt)}</span>
                            </div>
                            <div>
                              <strong>{validation.totalTokens}</strong>
                              <span>{validation.durationSeconds}s</span>
                            </div>
                            <div>
                              <strong>{validation.cleanupStatus}</strong>
                              <span>
                                {validation.memoryAvailableGb !== undefined &&
                                validation.memoryAvailableGb !== null
                                  ? `${validation.memoryAvailableGb} GB free`
                                  : validation.error || "no memory sample"}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="runtime-validation-empty">
                        No validation runs match these filters.
                      </p>
                    )}
                    {runtimeValidationPage.pageCount > 1 && (
                      <div className="runtime-validation-pagination">
                        <button
                          className="button-secondary button-compact"
                          disabled={runtimeValidationPage.page <= 1}
                          onClick={() =>
                            setRuntimeValidationPageNumber((page) => Math.max(1, page - 1))
                          }
                          type="button"
                        >
                          Previous
                        </button>
                        <span>
                          Page {runtimeValidationPage.page} of {runtimeValidationPage.pageCount}
                        </span>
                        <button
                          className="button-secondary button-compact"
                          disabled={
                            runtimeValidationPage.page >= runtimeValidationPage.pageCount
                          }
                          onClick={() =>
                            setRuntimeValidationPageNumber((page) =>
                              Math.min(runtimeValidationPage.pageCount, page + 1)
                            )
                          }
                          type="button"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="runtime-validation-empty">
                    Run the smoke test to catalog model/device validation history.
                  </p>
                )}
              </article>
              <div className="runtime-probe-grid">
                <label className="field-label" htmlFor="runtime-probe-model">Tiny model probe</label>
                <input
                  id="runtime-probe-model"
                  onChange={(event) => setProbeModelId(event.target.value)}
                  value={probeModelId}
                />
                <label className="field-label" htmlFor="runtime-probe-prompt">Probe prompt</label>
                <input
                  id="runtime-probe-prompt"
                  onChange={(event) => setProbePrompt(event.target.value)}
                  value={probePrompt}
                />
                <button
                  className="button-primary button-compact"
                  disabled={isProbingRuntime}
                  onClick={() => void probeRuntime()}
                  type="button"
                >
                  <i className="fas fa-stethoscope" aria-hidden="true" />
                  {isProbingRuntime ? "Probing" : "Probe Small Model"}
                </button>
              </div>
              {probeResult && (
                <article className={`runtime-probe-result ${probeResult.ok ? "is-ok" : "is-error"}`}>
                  <div>
                    <strong>{probeResult.ok ? "Probe passed" : "Probe failed"}</strong>
                    <span>{probeResult.modelId}</span>
                  </div>
                  <div className="construct-inspector-grid">
                    <span>Device</span>
                    <strong>{probeResult.device}</strong>
                    <span>Requested</span>
                    <strong>{probeResult.requestedDevice}</strong>
                    <span>Load</span>
                    <strong>{probeResult.loadSeconds ?? "n/a"}s</strong>
                    <span>Total</span>
                    <strong>{probeResult.totalSeconds}s</strong>
                  </div>
                  {probeResult.output && <p>{probeResult.output}</p>}
                  {probeResult.error && <p>{probeResult.error}</p>}
                  <pre>{JSON.stringify(probeResult.diagnostics, null, 2)}</pre>
                </article>
              )}
              <span>{runtime?.modelId || configuredModelTarget}</span>
              <label className="toggle-row" htmlFor="construct-library-context">
                <input
                  id="construct-library-context"
                  checked={includeLibraryContext}
                  onChange={(event) => setIncludeLibraryContext(event.target.checked)}
                  type="checkbox"
                />
                <span>Include Library context</span>
              </label>
            </div>

            <section className="prompt-workbench panel-glass" aria-labelledby="prompt-workbench-title">
              <div className="prompt-workbench-header">
                <div>
                  <p className="panel-kicker">Prompt Chain</p>
                  <h3 id="prompt-workbench-title">System and user prompts</h3>
                </div>
                <button
                  className="button-secondary button-compact"
                  onClick={() => setPromptWorkbenchOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  <i
                    className={`fas ${promptWorkbenchOpen ? "fa-chevron-up" : "fa-chevron-down"}`}
                    aria-hidden="true"
                  />
                  {promptWorkbenchOpen ? "Hide" : "Edit"}
                </button>
              </div>
              {promptWorkbenchOpen && (
                <div className="prompt-workbench-body">
                  <label className="prompt-field" htmlFor="construct-system-prompt">
                    <span>System Prompt</span>
                    <textarea
                      id="construct-system-prompt"
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      rows={4}
                      value={systemPrompt}
                    />
                  </label>
                  <div className="prompt-lesson-grid">
                    <div>
                      <strong>System</strong>
                      <span>Sets durable behavior, boundaries, and tone before the turn begins.</span>
                    </div>
                    <div>
                      <strong>User</strong>
                      <span>Holds the current request that the Construct answers and Trials record.</span>
                    </div>
                    <div>
                      <strong>Library</strong>
                      <span>{includeLibraryContext ? "Context will be included." : "Context is off for this turn."}</span>
                    </div>
                  </div>
                  <button
                    className="button-secondary button-compact"
                    onClick={() => setSystemPrompt(activePromptDefault)}
                    type="button"
                  >
                    <i className="fas fa-rotate-left" aria-hidden="true" />
                    Reset System Prompt
                  </button>
                  <div className="prompt-compare-actions">
                    <button
                      className="button-secondary button-compact"
                      disabled={isSending || isRunningPromptRecipe || !lastInspection}
                      onClick={() => lastInspection && void sendMessage(lastInspection.prompt)}
                      type="button"
                    >
                      <i className="fas fa-repeat" aria-hidden="true" />
                      Rerun Last User Prompt
                    </button>
                    <button
                      className="button-primary button-compact"
                      disabled={isSending || isRunningPromptRecipe}
                      onClick={() => void runPromptComparisonRecipe()}
                      type="button"
                    >
                      <i className="fas fa-flask-vial" aria-hidden="true" />
                      {isRunningPromptRecipe ? "Running Recipe" : "Run Comparison Recipe"}
                    </button>
                    <button
                      className="button-secondary button-compact"
                      disabled={!lastInspection || isRunningPromptRecipe}
                      onClick={onOpenTrialComparison}
                      type="button"
                    >
                      <i className="fas fa-scale-balanced" aria-hidden="true" />
                      Open Trial Comparison
                    </button>
                  </div>
                  {promptRecipeMessage && (
                    <p className="save-state success-state prompt-recipe-state">
                      {promptRecipeMessage}
                    </p>
                  )}
                </div>
              )}
            </section>

            <div className="prompt-presets" aria-label="Construct test prompts">
              {promptPresets.map((preset) => (
                <button
                  className="button-secondary button-compact"
                  disabled={isSending}
                  key={preset}
                  onClick={() => void sendMessage(preset)}
                  type="button"
                >
                  <i className="fas fa-vial" aria-hidden="true" />
                  {preset}
                </button>
              ))}
            </div>

            <div className="message-stream">
              {messages.map((message) => (
                <div
                  className={`message-bubble ${
                    message.sender === "user" ? "user-bubble" : "bot-bubble prose llm-response"
                  }`}
                  key={message.id}
                >
                  {message.sender === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                  ) : (
                    message.text
                  )}
                </div>
              ))}
            </div>

            <div className="composer">
              <label className="user-prompt-field" htmlFor="construct-user-prompt">
                <span>User Prompt</span>
                <input
                  id="construct-user-prompt"
                  className="composer-input"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void sendMessage()}
                  placeholder={`Test ${activeArtifact.name}...`}
                  type="text"
                  value={input}
                />
              </label>
              <button
                aria-label="Send message"
                className="send-button"
                disabled={isSending}
                onClick={() => void sendMessage()}
                title="Send message"
              >
                <i className="fas fa-paper-plane" aria-hidden="true" />
              </button>
            </div>
            {error && <p className="save-state error-state">{error}</p>}
          </div>
        </div>
        <aside className="construct-learning">
          <article className="construct-inspector-card panel-glass">
            <p className="panel-kicker">Session Contract</p>
            <h2>Loaded Artifact</h2>
            <div className="construct-inspector-grid">
              <span>Artifact</span>
              <strong>{activeArtifact.name}</strong>
              <span>Forge</span>
              <strong>{activeArtifact.forgeRunId || "manual"}</strong>
              <span>
                Adapter
                <AcademyActionTooltip action={adapterEvidenceAcademyAction} label="?" />
              </span>
              <strong>{loadedModelAdapterPath || activeArtifact.adapterPath || "not registered"}</strong>
              <span>Runtime</span>
              <strong>{runtimeMode}</strong>
              <span>Runtime status</span>
              <strong>{runtime?.status || "offline"}</strong>
              <span>Loaded model</span>
              <strong>{shortModelId(loadedModel.modelId)}</strong>
              <span>Device</span>
              <strong>{loadedModel.device || runtime?.device || "none"}</strong>
              <span>Memory</span>
              <strong>{formatRuntimeMemory(runtimeMemory)}</strong>
              <span>
                Last load
                <AcademyActionTooltip action={runtimeLoadingAcademyAction} label="?" />
              </span>
              <strong>{loadEvent.status || "idle"}</strong>
              <span>Loaded at</span>
              <strong>{formatRuntimeTimestamp(loadEvent.finishedAt)}</strong>
              <span>Load time</span>
              <strong>{formatLoadDuration(loadEvent.durationSeconds)}</strong>
              <span>Library</span>
              <strong>{includeLibraryContext ? "included" : "off"}</strong>
            </div>
            {loadEvent.failureReason && (
              <p className="save-state error-state">Load failed: {loadEvent.failureReason}</p>
            )}
          </article>

          <article className="construct-inspector-card panel-glass runtime-timeline-card">
            <p className="panel-kicker">Runtime Timeline</p>
            <div className="runtime-history-heading">
              <h2>Runtime History</h2>
              <div className="runtime-history-actions">
                <span>{runtimeTimeline.length} events</span>
                <button
                  className="button-secondary button-compact"
                  disabled={isExportingRuntimeHistory || runtimeTimeline.length === 0}
                  onClick={() => void downloadRuntimeHistoryExport()}
                  type="button"
                >
                  {isExportingRuntimeHistory ? "Exporting" : "Export JSON"}
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={isPreparingDiagnosticsBundle}
                  onClick={() => void prepareDiagnosticsBundlePreview()}
                  type="button"
                >
                  {isPreparingDiagnosticsBundle ? "Preparing" : "Preview Bundle"}
                </button>
                {isConfirmingHistoryClear && (
                  <button
                    className="button-secondary button-compact"
                    disabled={isClearingRuntimeHistory}
                    onClick={() => {
                      setIsConfirmingHistoryClear(false);
                      setRuntimeHistoryMessage(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                )}
                <button
                  className={`button-secondary button-compact ${
                    isConfirmingHistoryClear ? "danger-action" : ""
                  }`}
                  disabled={isClearingRuntimeHistory || runtimeTimeline.length === 0}
                  onClick={() => void clearRuntimeHistory()}
                  type="button"
                >
                  {isClearingRuntimeHistory
                    ? "Clearing"
                    : isConfirmingHistoryClear
                    ? "Confirm Clear"
                    : "Clear History"}
                </button>
              </div>
            </div>
            {runtimeHistoryMessage && (
              <p className="runtime-history-message">{runtimeHistoryMessage}</p>
            )}
            {diagnosticsBundlePreview && (
              <div className="diagnostics-preview-panel">
                <div className="diagnostics-preview-header">
                  <div>
                    <p className="panel-kicker">Diagnostics Preview</p>
                    <h3>Review export contents</h3>
                    <span>{diagnosticsBundlePreview.fileName}</span>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setDiagnosticsBundlePreview(null)}
                    title="Close diagnostics preview"
                    type="button"
                  >
                    <i className="fas fa-xmark" aria-hidden="true" />
                  </button>
                </div>
                <div className="diagnostics-preview-grid">
                  <div>
                    <span>Contract</span>
                    <strong>
                      {String(diagnosticsBundlePreview.bundle.contractVersion || "unknown")}
                    </strong>
                  </div>
                  <div>
                    <span>Runtime events</span>
                    <strong>{diagnosticsBundlePreview.eventCount}</strong>
                  </div>
                  <div>
                    <span>Runtime validations</span>
                    <strong>{diagnosticsBundlePreview.validationCount}</strong>
                  </div>
                  <div>
                    <span>Prepared</span>
                    <strong>{formatRuntimeTimestamp(diagnosticsBundlePreview.exportedAt)}</strong>
                  </div>
                  <div>
                    <span>Sections</span>
                    <strong>{Object.keys(diagnosticsBundlePreview.bundle).length}</strong>
                  </div>
                </div>
                <div className="diagnostics-preview-redactions">
                  <strong>Redaction check</strong>
                  {diagnosticsBundlePreview.redactions.map((redaction) => (
                    <span key={redaction}>
                      <i className="fas fa-shield-halved" aria-hidden="true" />
                      {redaction}
                    </span>
                  ))}
                </div>
                <div className="diagnostics-redaction-audit">
                  <div className="diagnostics-redaction-audit-header">
                    <strong>Redaction audit</strong>
                    <span>{diagnosticsBundlePreview.redactionAudit.length} rules checked</span>
                  </div>
                  {diagnosticsBundlePreview.redactionAudit.length > 0 ? (
                    <div className="diagnostics-redaction-list">
                      {diagnosticsBundlePreview.redactionAudit.map((entry) => (
                        <div className="diagnostics-redaction-row" key={entry.field}>
                          <div>
                            <strong>{entry.field}</strong>
                            <span>
                              {entry.status} / {entry.risk}
                            </span>
                          </div>
                          <p>{entry.reason}</p>
                          <span>{entry.policy}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No structured redaction audit was provided by this bundle.</p>
                  )}
                </div>
                <div className="diagnostics-validation-inspector">
                  <div className="diagnostics-validation-header">
                    <div>
                      <strong>Validation export</strong>
                      <span>
                        {diagnosticsBundlePreview.validationCount} run
                        {diagnosticsBundlePreview.validationCount === 1 ? "" : "s"} attached
                      </span>
                    </div>
                    <span>
                      {diagnosticsBundlePreview.validationSummary.validations.length} shown
                    </span>
                  </div>
                  <div className="diagnostics-validation-filters">
                    <span>
                      Model{" "}
                      <strong>
                        {diagnosticsBundlePreview.validationSummary.filters.modelId
                          ? shortModelId(
                              diagnosticsBundlePreview.validationSummary.filters.modelId
                            )
                          : "all"}
                      </strong>
                    </span>
                    <span>
                      Device{" "}
                      <strong>
                        {diagnosticsBundlePreview.validationSummary.filters.device || "all"}
                      </strong>
                    </span>
                    <span>
                      Status{" "}
                      <strong>
                        {diagnosticsBundlePreview.validationSummary.filters.status || "all"}
                      </strong>
                    </span>
                  </div>
                  {diagnosticsBundlePreview.validationSummary.validations.length > 0 ? (
                    <div className="diagnostics-validation-list">
                      {diagnosticsBundlePreview.validationSummary.validations.map((validation) => (
                        <div
                          className={`diagnostics-validation-row is-${validation.status}`}
                          key={validation.id}
                        >
                          <div>
                            <strong>{shortModelId(validation.modelId)}</strong>
                            <span>{validation.device}</span>
                          </div>
                          <div>
                            <strong>{validation.status}</strong>
                            <span>{formatRuntimeTimestamp(validation.createdAt)}</span>
                          </div>
                          <div>
                            <strong>{validation.totalTokens}</strong>
                            <span>{validation.durationSeconds}s</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No validation rows match the active filters.</p>
                  )}
                </div>
                <details className="diagnostics-preview-details">
                  <summary>Bundle section keys</summary>
                  <code>{Object.keys(diagnosticsBundlePreview.bundle).join(", ")}</code>
                </details>
                <div className="diagnostics-preview-actions">
                  <button
                    className="button-primary button-compact"
                    onClick={downloadDiagnosticsBundlePreview}
                    type="button"
                  >
                    Download Bundle
                  </button>
                  <button
                    className="button-secondary button-compact"
                    onClick={() => setDiagnosticsBundlePreview(null)}
                    type="button"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            )}
            <div className="runtime-history-filters" aria-label="Runtime history filters">
              {RUNTIME_HISTORY_FILTERS.map((filter) => (
                <button
                  className={`runtime-history-filter ${
                    runtimeHistoryFilter === filter.id ? "is-active" : ""
                  }`}
                  key={filter.id}
                  onClick={() => setRuntimeHistoryFilter(filter.id)}
                  type="button"
                >
                  <span>{filter.label}</span>
                  <strong>{runtimeHistoryCounts[filter.id]}</strong>
                </button>
              ))}
            </div>
            <div className="runtime-timeline-list" aria-label="Construct runtime event timeline">
              {filteredRuntimeTimeline.length > 0 ? (
                filteredRuntimeTimeline.map((event) => (
                  <button
                    className={`runtime-timeline-event is-${event.status} event-${event.type}`}
                    key={event.id}
                    onClick={() => setSelectedRuntimeEvent(event)}
                    title="Inspect runtime event details"
                    type="button"
                  >
                    <span className="runtime-timeline-dot" aria-hidden="true">
                      <i
                        className={`fas ${
                          event.status === "passed"
                            ? "fa-check"
                            : event.status === "failed"
                            ? "fa-xmark"
                            : event.status === "warning"
                            ? "fa-triangle-exclamation"
                            : event.status === "running"
                            ? "fa-spinner"
                            : "fa-circle-info"
                        }`}
                      />
                    </span>
                    <div>
                      <div className="runtime-timeline-title">
                        <strong>{event.title}</strong>
                        <time dateTime={event.timestamp}>{formatTimelineTime(event.timestamp)}</time>
                      </div>
                      <div className="runtime-timeline-meta">
                        <span>{runtimeHistoryEventLabel(event)}</span>
                        <span>{event.status}</span>
                        <span>{event.source}</span>
                      </div>
                      <p>{event.detail}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="runtime-history-empty">
                  <strong>No matching events</strong>
                  <span>Run a smoke test, load, preflight, or memory release to populate this view.</span>
                </div>
              )}
            </div>
          </article>

          {selectedRuntimeEvent && (
            <div
              className="runtime-event-drawer-backdrop"
              onClick={() => setSelectedRuntimeEvent(null)}
              role="presentation"
            >
              <aside
                aria-labelledby="runtime-event-drawer-title"
                aria-modal="true"
                className="runtime-event-drawer panel-glass"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="runtime-event-drawer-header">
                  <div>
                    <p className="panel-kicker">
                      {runtimeHistoryEventLabel(selectedRuntimeEvent)} event
                    </p>
                    <h2 id="runtime-event-drawer-title">{selectedRuntimeEvent.title}</h2>
                  </div>
                  <button
                    aria-label="Close runtime event details"
                    className="icon-button"
                    onClick={() => setSelectedRuntimeEvent(null)}
                    type="button"
                  >
                    <i className="fas fa-xmark" aria-hidden="true" />
                  </button>
                </div>
                <p className="runtime-event-drawer-detail">{selectedRuntimeEvent.detail}</p>
                <div className="construct-inspector-grid runtime-event-detail-grid">
                  <span>Status</span>
                  <strong>{selectedRuntimeEvent.status}</strong>
                  <span>Source</span>
                  <strong>{selectedRuntimeEvent.source}</strong>
                  <span>Runtime</span>
                  <strong>{selectedRuntimeEvent.runtimeStatus || "n/a"}</strong>
                  <span>Model</span>
                  <strong>{selectedRuntimeEvent.modelId || "n/a"}</strong>
                  <span>Construct</span>
                  <strong>{selectedRuntimeEvent.constructId || "n/a"}</strong>
                  <span>Artifact</span>
                  <strong>{selectedRuntimeEvent.artifactId || "n/a"}</strong>
                  <span>Recorded</span>
                  <strong>{formatRuntimeTimestamp(selectedRuntimeEvent.timestamp)}</strong>
                </div>
                <div className="runtime-event-metadata">
                  <span>Metadata</span>
                  <pre>{formatRuntimeEventMetadata(selectedRuntimeEvent)}</pre>
                </div>
              </aside>
            </div>
          )}

          {selectedRuntimeValidation && (
            <div
              className="runtime-event-drawer-backdrop"
              onClick={() => setSelectedRuntimeValidation(null)}
              role="presentation"
            >
              <aside
                aria-labelledby="runtime-validation-drawer-title"
                aria-modal="true"
                className="runtime-event-drawer runtime-validation-drawer panel-glass"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="runtime-event-drawer-header">
                  <div>
                    <p className="panel-kicker">Validation run</p>
                    <h2 id="runtime-validation-drawer-title">
                      {shortModelId(selectedRuntimeValidation.modelId)}
                    </h2>
                  </div>
                  <button
                    aria-label="Close validation details"
                    className="icon-button"
                    onClick={() => setSelectedRuntimeValidation(null)}
                    type="button"
                  >
                    <i className="fas fa-xmark" aria-hidden="true" />
                  </button>
                </div>
                <p className="runtime-event-drawer-detail">
                  Smoke validation recorded for {selectedRuntimeValidation.device}. Use this to
                  compare model/device readiness before attaching a diagnostics bundle.
                </p>
                <div className="construct-inspector-grid runtime-event-detail-grid">
                  <span>Status</span>
                  <strong>{selectedRuntimeValidation.status}</strong>
                  <span>Model</span>
                  <strong>{selectedRuntimeValidation.modelId}</strong>
                  <span>Device</span>
                  <strong>{selectedRuntimeValidation.device}</strong>
                  <span>Tokens</span>
                  <strong>{selectedRuntimeValidation.totalTokens}</strong>
                  <span>Duration</span>
                  <strong>{selectedRuntimeValidation.durationSeconds}s</strong>
                  <span>Cleanup</span>
                  <strong>{selectedRuntimeValidation.cleanupStatus}</strong>
                  <span>Memory</span>
                  <strong>
                    {selectedRuntimeValidation.memoryAvailableGb !== undefined &&
                    selectedRuntimeValidation.memoryAvailableGb !== null
                      ? `${selectedRuntimeValidation.memoryAvailableGb} GB free`
                      : "n/a"}
                  </strong>
                  <span>Construct</span>
                  <strong>{selectedRuntimeValidation.constructId || "n/a"}</strong>
                  <span>Artifact</span>
                  <strong>{selectedRuntimeValidation.artifactId || "n/a"}</strong>
                  <span>Recorded</span>
                  <strong>{formatRuntimeTimestamp(selectedRuntimeValidation.createdAt)}</strong>
                </div>
                {selectedRuntimeValidation.error && (
                  <p className="runtime-validation-error">{selectedRuntimeValidation.error}</p>
                )}
                <div className="runtime-event-metadata">
                  <span>Metadata</span>
                  <pre>{formatRuntimeValidationMetadata(selectedRuntimeValidation)}</pre>
                </div>
                <div className="runtime-validation-detail-actions">
                  <button
                    className="button-primary button-compact"
                    disabled={isPreparingDiagnosticsBundle}
                    onClick={async () => {
                      await prepareDiagnosticsBundlePreview();
                      setSelectedRuntimeValidation(null);
                    }}
                    type="button"
                  >
                    {isPreparingDiagnosticsBundle ? "Preparing" : "Preview Diagnostics Bundle"}
                  </button>
                </div>
              </aside>
            </div>
          )}

          <article className="construct-inspector-card panel-glass">
            <p className="panel-kicker">Response Inspection</p>
            <h2>Last Reply</h2>
            {lastInspection ? (
              <>
                <div className="construct-inspector-grid">
                  <span>Tokens</span>
                  <strong>{lastInspection.totalTokens}</strong>
                  <span>Runtime</span>
                  <strong>{lastInspection.runtimeMode}</strong>
                  <span>Status</span>
                  <strong>{lastInspection.runtimeStatus}</strong>
                  <span>Device</span>
                  <strong>{lastInspection.device}</strong>
                  <span>Context</span>
                  <strong>{lastInspection.contextWindow.toLocaleString()}</strong>
                  <span>Max output</span>
                  <strong>{lastInspection.maxNewTokens}</strong>
                  <span>Temperature</span>
                  <strong>{lastInspection.temperature}</strong>
                  <span>Prompt chain</span>
                  <strong>
                    {lastInspection.promptChain?.instructionOrder.join(" -> ") ||
                      "system -> user -> settings"}
                  </strong>
                  <span>System prompt</span>
                  <strong>
                    {lastInspection.promptChain?.systemPromptPresent
                      ? lastInspection.promptChain.systemPromptPreview
                      : "not set"}
                  </strong>
                  <span>User prompt</span>
                  <strong>
                    {lastInspection.promptChain?.userPromptPreview || lastInspection.prompt}
                  </strong>
                </div>
                <div className="trial-actions" aria-label="Trial verdict">
                  {(["pass", "needs-work", "fail"] as ReviewedTrialVerdict[]).map((verdict) => (
                    <button
                      className={`button-secondary button-compact ${
                        trialVerdict === verdict ? "is-active" : ""
                      }`}
                      disabled={isSavingTrial}
                      key={verdict}
                      onClick={() => void saveTrial(verdict)}
                      type="button"
                    >
                      {verdict}
                    </button>
                  ))}
                </div>
                <div className="construct-comparison-actions">
                  <button
                    className="button-secondary button-compact"
                    disabled={isSending || isRunningPromptRecipe}
                    onClick={() => void sendMessage(lastInspection.prompt)}
                    type="button"
                  >
                    <i className="fas fa-repeat" aria-hidden="true" />
                    Rerun for comparison
                  </button>
                  <button
                    className="button-secondary button-compact"
                    disabled={isSending || isRunningPromptRecipe}
                    onClick={() => void runPromptComparisonRecipe()}
                    type="button"
                  >
                    <i className="fas fa-flask-vial" aria-hidden="true" />
                    {isRunningPromptRecipe ? "Running recipe" : "Run recipe"}
                  </button>
                  <button
                    className="button-primary button-compact"
                    disabled={isRunningPromptRecipe}
                    onClick={onOpenTrialComparison}
                    type="button"
                  >
                    <i className="fas fa-scale-balanced" aria-hidden="true" />
                    Open Trial Comparison
                  </button>
                </div>
                {savedTrial && (
                  <p className="save-state success-state">
                    {trialVerdict === "needs-review"
                      ? "Trial captured for review"
                      : `Trial saved as ${trialVerdict}`}
                    {` (${savedTrial.id}).`}
                  </p>
                )}
                {trialError && <p className="save-state error-state">{trialError}</p>}
              </>
            ) : (
              <p className="empty-state">Send a prompt to inspect generation settings.</p>
            )}
          </article>

          <LearningCard
            title="What is inference?"
            body="Inference is the moment the trained model turns your prompt, system instructions, retrieved context, and generation settings into new tokens."
          />
          <LearningCard
            title="System vs user prompt"
            body="The system prompt sets the Construct's standing instructions. The user prompt is the current test request. Trials save both so prompt changes can be compared later."
          />
          <LearningCard
            title="Runtime loading is the proof point"
            body="A loaded Construct tells you which model, device, and adapter are actually active. Use that evidence before deciding whether an Artifact changed behavior."
            academyAction={runtimeLoadingAcademyAction}
            onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.constructRuntimeLoading)}
          />
          {activeArtifact.adapterPath && (
            <LearningCard
              title="Adapter-backed Constructs"
              body="When a LoRA adapter is loaded with its base model, the response path is testing the Artifact produced by Forge instead of only the original base model."
              academyAction={adapterEvidenceAcademyAction}
              onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.constructAdapterEvidence)}
            />
          )}
          <LearningCard
            title="Memory cleanup keeps iteration smooth"
            body="Unload and release memory before switching models or adapters. The runtime records which cleanup hooks ran so users can see what changed."
            academyAction={memoryCleanupAcademyAction}
            onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.constructMemoryCleanup)}
          />
          <LearningCard
            title="Why token streaming matters"
            body="Streaming sends tokens as the model produces them, making latency visible and helping users understand that responses are generated step by step."
          />
          <TrainingMetricExplainer />
        </aside>
      </div>
    </section>
  );
};

export default ConstructWorkbench;
