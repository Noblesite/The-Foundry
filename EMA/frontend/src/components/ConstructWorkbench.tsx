import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Artifact,
  Construct,
  ConstructMessage,
  ConstructModelHandoff,
  ConstructRuntime,
  ConstructRuntimeEvent,
  ConstructRuntimePreflightResult,
  ConstructRuntimeProbeResult,
  CreateConstructRuntimeEventRequest,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
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
import { LearningCard, TrainingMetricExplainer } from "./LearningComponents";
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
  artifactId: string;
  constructId: string;
}

type RuntimeLoadPhase = "idle" | "configuring" | "loading" | "ready" | "failed";
type RuntimeSmokeStatus = "idle" | "loading" | "streaming" | "passed" | "failed";
type RuntimeHistoryFilter = "all" | "smoke" | "load" | "preflight" | "memory" | "failures";

interface RuntimeSmokeResult {
  modelId: string;
  device: string;
  totalTokens: number;
  durationSeconds: number;
  cleanupStatus: string;
  memoryAvailableGb?: number;
  completedAt: string;
}

const LOCAL_SMOKE_MODEL_ID = "sshleifer/tiny-gpt2";
const LOCAL_SMOKE_PROMPT =
  "Runtime smoke test: reply with one short sentence from The Foundry.";
const SMOKE_RESULT_STORAGE_PREFIX = "foundry.construct.smokeResult";
const RUNTIME_HISTORY_FILTERS: Array<{ id: RuntimeHistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "smoke", label: "Smoke" },
  { id: "load", label: "Loads" },
  { id: "preflight", label: "Preflight" },
  { id: "memory", label: "Memory" },
  { id: "failures", label: "Failures" },
];

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

interface ConstructWorkbenchProps {
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
  onRuntimeChanged?: (runtime: ConstructRuntime) => void;
}

const ConstructWorkbench: React.FC<ConstructWorkbenchProps> = ({
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
  onRuntimeChanged,
}) => {
  const conversationId = `construct-${construct.id}`;
  const configuredModelTarget = settings.constructModelId || resolveDefaultBaseModel(settings);
  const [activeConstruct, setActiveConstruct] = useState(construct);
  const [activeArtifact, setActiveArtifact] = useState(artifact);
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
  const [runtimeHistoryFilter, setRuntimeHistoryFilter] = useState<RuntimeHistoryFilter>("all");
  const [selectedRuntimeEvent, setSelectedRuntimeEvent] =
    useState<ConstructRuntimeEvent | null>(null);
  const [isConfirmingHistoryClear, setIsConfirmingHistoryClear] = useState(false);
  const [isClearingRuntimeHistory, setIsClearingRuntimeHistory] = useState(false);
  const [runtimeHistoryMessage, setRuntimeHistoryMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [lastInspection, setLastInspection] = useState<ResponseInspection | null>(null);
  const [trialVerdict, setTrialVerdict] = useState<TrialVerdict | null>(null);
  const [savedTrial, setSavedTrial] = useState<Trial | null>(null);
  const [isSavingTrial, setIsSavingTrial] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setSelectedRuntimeEvent(null);
    setIsConfirmingHistoryClear(false);
    setRuntimeHistoryMessage(null);
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
    const targetModel =
      options?.modelOverride || configuredModelTarget || runtimeLoadTarget || activeArtifact.baseModel;
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
      detail: `Preparing transformers runtime for ${shortModelId(targetModel)}.`,
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
      title: "Model load started",
      detail: `Loading ${shortModelId(targetModel)} into the local runtime.`,
    });
    const runtimeStatus = await repository.loadConstructRuntime({
      modelId: targetModel,
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
      title: "Model loaded",
      detail: `${shortModelId(targetModel)} loaded on ${runtimeStatus.device} in ${formatLoadDuration(
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
    options?: { smokeTest?: boolean; smokeStartedAt?: number }
  ) => {
    const messageText = (presetText ?? input).trim();
    if (!messageText) {
      return;
    }

    const userMessage: ConstructMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: messageText,
      tokenCount: messageText.split(/\s+/).length,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
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
        includeLibraryContext,
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
            artifactId: event.artifact.id,
            constructId: event.construct.id,
          });
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
          setRuntimeSmokeStatus("failed");
          setRuntimeSmokeMessage(event.message);
          setRuntimeSmokeResult(null);
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
        setRuntimeSmokeStatus("failed");
        setRuntimeSmokeMessage(
          chatError instanceof Error ? chatError.message : "Runtime smoke test failed."
        );
        setRuntimeSmokeResult(null);
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

  const runRuntimeSmokeTest = async () => {
    const smokeModel = LOCAL_SMOKE_MODEL_ID;
    const smokeStartedAt = performance.now();
    setIsRuntimeBusy(true);
    setRuntimeSmokeStatus("loading");
    setRuntimeSmokeMessage(`Loading cached smoke model ${shortModelId(smokeModel)}.`);
    setRuntimeSmokeResult(null);
    setError(null);
    addRuntimeTimelineEvent({
      type: "smoke",
      status: "running",
      title: "Smoke test started",
      detail: `Construct will load cached ${shortModelId(
        smokeModel
      )} and stream a short verification reply.`,
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

  const saveTrial = async (verdict: TrialVerdict) => {
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
          runtimeStatus: lastInspection.runtimeStatus,
          modelId: lastInspection.modelId,
          device: lastInspection.device,
        },
      });
      setTrialVerdict(verdict);
      setSavedTrial(trial);
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
    readinessBlocksLoad ||
    readinessNeedsConfirmation;
  const loadButtonLabel = isRuntimeBusy
    ? runtimePhaseLabel
    : readinessBlocksLoad
    ? "Blocked"
    : readinessNeedsConfirmation
    ? "Review Caution"
    : "Load Current Model";
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

            <div className="construct-runtime-card">
              <div className="runtime-load-header">
                <div>
                  <p className="panel-kicker">Local runtime</p>
                  <strong>{runtime?.loaded ? "Model loaded" : "Ready to load cached model"}</strong>
                </div>
                <span className={`status-badge runtime-phase-${runtimeLoadPhase}`}>
                  {runtimePhaseLabel}
                </span>
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
                  <span>Memory cleanup</span>
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
                </div>
                <button
                  className="button-primary button-compact"
                  disabled={smokeButtonDisabled}
                  onClick={() => void runRuntimeSmokeTest()}
                  title={
                    readinessBlocksLoad
                      ? "Readiness checks blocked loading."
                      : readinessNeedsConfirmation
                      ? "Load with caution must be confirmed before smoke testing."
                      : "Load the runtime and stream a smoke-test prompt."
                  }
                  type="button"
                >
                  <i className="fas fa-bolt" aria-hidden="true" />
                  {runtimeSmokeStatus === "loading"
                    ? "Loading"
                    : runtimeSmokeStatus === "streaming"
                    ? "Streaming"
                    : "Run Smoke Test"}
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
              <input
                className="composer-input"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void sendMessage()}
                placeholder={`Test ${activeArtifact.name}...`}
                type="text"
                value={input}
              />
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
              <span>Adapter</span>
              <strong>{activeArtifact.adapterPath || "not registered"}</strong>
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
              <span>Last load</span>
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
                </div>
                <div className="trial-actions" aria-label="Trial verdict">
                  {(["pass", "needs-work", "fail"] as TrialVerdict[]).map((verdict) => (
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
                {trialVerdict && (
                  <p className="save-state success-state">
                    Trial saved as {trialVerdict}
                    {savedTrial ? ` (${savedTrial.id}).` : "."}
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
