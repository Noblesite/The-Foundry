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
  Trial,
  TrialVerdict,
} from "../domain/foundry";
import { buildRuntimeReadinessSummary } from "../domain/constructReadiness";
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

interface ConstructWorkbenchProps {
  artifact: Artifact;
  construct: Construct;
  handoff?: ConstructModelHandoff | null;
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  onRuntimeChanged?: (runtime: ConstructRuntime) => void;
}

const ConstructWorkbench: React.FC<ConstructWorkbenchProps> = ({
  artifact,
  construct,
  handoff,
  repository,
  settings,
  onRuntimeChanged,
}) => {
  const conversationId = `construct-${construct.id}`;
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
  const [runtimeLoadPhase, setRuntimeLoadPhase] = useState<RuntimeLoadPhase>("idle");
  const [runtimeLoadTarget, setRuntimeLoadTarget] = useState(
    settings.constructModelId || artifact.baseModel
  );
  const [runtimeSmokeStatus, setRuntimeSmokeStatus] = useState<RuntimeSmokeStatus>("idle");
  const [runtimeSmokeMessage, setRuntimeSmokeMessage] = useState(
    "Load the current model, stream a short reply, and inspect the runtime contract."
  );
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [isProbingRuntime, setIsProbingRuntime] = useState(false);
  const [isPreflightingRuntime, setIsPreflightingRuntime] = useState(false);
  const [preflightResult, setPreflightResult] = useState<ConstructRuntimePreflightResult | null>(null);
  const [readinessGateMessage, setReadinessGateMessage] = useState<string | null>(null);
  const [confirmedCautionTarget, setConfirmedCautionTarget] = useState<string | null>(null);
  const [runtimeTimeline, setRuntimeTimeline] = useState<ConstructRuntimeEvent[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [lastInspection, setLastInspection] = useState<ResponseInspection | null>(null);
  const [trialVerdict, setTrialVerdict] = useState<TrialVerdict | null>(null);
  const [savedTrial, setSavedTrial] = useState<Trial | null>(null);
  const [isSavingTrial, setIsSavingTrial] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            [recordedEvent, ...current.filter((item) => item.id !== recordedEvent.id)].slice(0, 10)
          );
        })
        .catch(() => {
          setRuntimeTimeline((current) =>
            [
              {
                ...event,
                id: `runtime-event-local-${Date.now()}-${current.length}`,
                timestamp: new Date().toISOString(),
                constructId: activeConstruct.id,
                artifactId: activeArtifact.id,
                runtimeStatus: runtime?.status,
                source: "frontend" as const,
              } satisfies ConstructRuntimeEvent,
              ...current,
            ].slice(0, 10)
          );
        });
    },
    [activeArtifact.id, activeConstruct.id, repository, runtime?.status]
  );

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
    setRuntimeLoadTarget(settings.constructModelId || artifact.baseModel);
    setRuntimeSmokeStatus("idle");
    setRuntimeSmokeMessage(
      "Load the current model, stream a short reply, and inspect the runtime contract."
    );
    setHandoffNotice(null);
    setPreflightResult(null);
    setReadinessGateMessage(null);
    setConfirmedCautionTarget(null);
    setProbeResult(null);
    setRuntimeTimeline([]);
    repository
      .listConstructRuntimeEvents()
      .then((events) => {
        if (!isCurrent) {
          return;
        }
        if (events.length > 0) {
          setRuntimeTimeline(events.slice(0, 10));
          return;
        }
        void repository
          .recordConstructRuntimeEvent({
            type: "handoff",
            status: "info",
            title: "Construct session ready",
            detail: `Runtime target set to ${settings.constructModelId || artifact.baseModel}.`,
            constructId: construct.id,
            artifactId: artifact.id,
            modelId: settings.constructModelId || artifact.baseModel,
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
              detail: `Runtime target set to ${settings.constructModelId || artifact.baseModel}.`,
              timestamp: new Date().toISOString(),
              constructId: construct.id,
              artifactId: artifact.id,
              modelId: settings.constructModelId || artifact.baseModel,
              source: "frontend",
            },
          ]);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [artifact, construct, repository, settings.constructModelId]);

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
    const targetModel = modelOverride || settings.constructModelId || activeArtifact.baseModel;
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
    const targetModel = settings.constructModelId || runtimeLoadTarget || activeArtifact.baseModel;
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

  const loadCurrentRuntime = async (options?: { confirmCaution?: boolean }) => {
    const targetModel = settings.constructModelId || runtimeLoadTarget || activeArtifact.baseModel;
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
    addRuntimeTimelineEvent({
      type: "unload",
      status: "running",
      title: "Unload requested",
      detail: `Releasing ${shortModelId(runtime?.modelId || runtimeLoadTarget)} from Construct.`,
    });
    try {
      const runtimeStatus = await repository.unloadConstructRuntime();
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

  const sendMessage = async (presetText?: string, options?: { smokeTest?: boolean }) => {
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
            setRuntimeSmokeStatus("passed");
            setRuntimeSmokeMessage(
              `Smoke test passed on ${eventRuntime?.device || runtime?.device || settings.constructDevice}.`
            );
            addRuntimeTimelineEvent({
              type: "smoke",
              status: "passed",
              title: "Smoke test passed",
              detail: `Reply streamed with ${event.totalTokens} tokens on ${
                eventRuntime?.device || runtime?.device || settings.constructDevice
              }.`,
            });
          }
          return;
        }
        if (options?.smokeTest) {
          setRuntimeSmokeStatus("failed");
          setRuntimeSmokeMessage(event.message);
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
    setIsRuntimeBusy(true);
    setRuntimeSmokeStatus("loading");
    setRuntimeSmokeMessage("Loading the current model into the Construct runtime.");
    setError(null);
    addRuntimeTimelineEvent({
      type: "smoke",
      status: "running",
      title: "Smoke test started",
      detail: "Construct will load the model and stream a short verification reply.",
    });
    try {
      await loadCurrentRuntime();
      setIsRuntimeBusy(false);
      await sendMessage(
        "Runtime smoke test: reply with one short sentence from The Foundry.",
        { smokeTest: true }
      );
    } catch (runtimeError: unknown) {
      setRuntimeSmokeStatus("failed");
      setRuntimeLoadPhase("failed");
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
  const readinessBlocksLoad = readinessSummary?.status === "blocked";
  const currentReadinessTarget = preflightResult?.modelId || runtimeLoadTarget;
  const readinessNeedsConfirmation =
    readinessSummary?.requiresConfirmation === true &&
    confirmedCautionTarget !== currentReadinessTarget;
  const loadButtonDisabled =
    isRuntimeBusy || isPreflightingRuntime || isSending || readinessBlocksLoad || readinessNeedsConfirmation;
  const smokeButtonDisabled =
    isRuntimeBusy || isSending || isPreflightingRuntime || readinessBlocksLoad || readinessNeedsConfirmation;
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
                <span className="status-badge">{runtime?.status || runtimeMode}</span>
                <span className="status-badge">{runtime?.loaded ? "loaded" : "not loaded"}</span>
                <span className="status-badge">{runtime?.device || settings.constructDevice}</span>
              </div>
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
              </div>
              {loadEvent.failureReason && (
                <p className="runtime-load-failure">
                  Load failed: {loadEvent.failureReason}
                </p>
              )}
              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  disabled={isPreflightingRuntime || isRuntimeBusy || isSending}
                  onClick={() => void runRuntimePreflight()}
                  type="button"
                >
                  <i className="fas fa-clipboard-check" aria-hidden="true" />
                  {isPreflightingRuntime ? "Checking" : "Preflight"}
                </button>
                <button
                  className="button-secondary button-compact"
                  disabled={isRuntimeBusy}
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
                  disabled={isRuntimeBusy}
                  onClick={unloadRuntime}
                  type="button"
                >
                  <i className="fas fa-power-off" aria-hidden="true" />
                  Unload
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
              <span>{runtime?.modelId || settings.constructModelId}</span>
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
            <h2>Load Sequence</h2>
            <div className="runtime-timeline-list" aria-label="Construct runtime event timeline">
              {runtimeTimeline.map((event) => (
                <div
                  className={`runtime-timeline-event is-${event.status} event-${event.type}`}
                  key={event.id}
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
                    <p>{event.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

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
