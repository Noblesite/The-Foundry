import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Artifact,
  Construct,
  ConstructMessage,
  ConstructRuntime,
  ConstructRuntimeProbeResult,
  Trial,
  TrialVerdict,
} from "../domain/foundry";
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

interface ConstructWorkbenchProps {
  artifact: Artifact;
  construct: Construct;
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  onRuntimeChanged?: (runtime: ConstructRuntime) => void;
}

const ConstructWorkbench: React.FC<ConstructWorkbenchProps> = ({
  artifact,
  construct,
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
  const [isProbingRuntime, setIsProbingRuntime] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [lastInspection, setLastInspection] = useState<ResponseInspection | null>(null);
  const [trialVerdict, setTrialVerdict] = useState<TrialVerdict | null>(null);
  const [savedTrial, setSavedTrial] = useState<Trial | null>(null);
  const [isSavingTrial, setIsSavingTrial] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    setProbeResult(null);
  }, [artifact, construct, settings.constructModelId]);

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

  const configureRuntime = async () => {
    setIsRuntimeBusy(true);
    setRuntimeLoadPhase("configuring");
    setRuntimeLoadTarget(settings.constructModelId || activeArtifact.baseModel);
    setError(null);
    try {
      const runtimeStatus = await repository.configureConstructRuntime({
        mode: settings.constructRuntimeMode,
        modelId: settings.constructModelId || activeArtifact.baseModel,
        device: settings.constructDevice,
      });
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
      setRuntimeLoadPhase("ready");
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not configure runtime.");
      setRuntimeLoadPhase("failed");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const loadRuntime = async () => {
    const targetModel = settings.constructModelId || activeArtifact.baseModel;
    setIsRuntimeBusy(true);
    setRuntimeLoadPhase("configuring");
    setRuntimeLoadTarget(targetModel);
    setError(null);
    try {
      const configured = await repository.configureConstructRuntime({
        mode: "transformers",
        modelId: targetModel,
        device: settings.constructDevice,
      });
      setRuntime(configured);
      setRuntimeMode(configured.mode);
      setRuntimeDetail(configured.detail);
      setRuntimeLoadPhase("loading");
      const runtimeStatus = await repository.loadConstructRuntime({
        modelId: targetModel,
      });
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
      setRuntimeLoadPhase("ready");
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not load runtime.");
      setRuntimeLoadPhase("failed");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const unloadRuntime = async () => {
    setIsRuntimeBusy(true);
    setRuntimeLoadPhase("idle");
    setError(null);
    try {
      const runtimeStatus = await repository.unloadConstructRuntime();
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
      onRuntimeChanged?.(runtimeStatus);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not unload runtime.");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const probeRuntime = async () => {
    setIsProbingRuntime(true);
    setError(null);
    setProbeResult(null);
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
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not probe runtime.");
    } finally {
      setIsProbingRuntime(false);
    }
  };

  const sendMessage = async (presetText?: string) => {
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
          return;
        }
        setError(event.message);
      });
    } catch (chatError: unknown) {
      setError(chatError instanceof Error ? chatError.message : "Could not talk to Construct.");
    } finally {
      setIsSending(false);
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

  const runtimeDiagnostics = runtime?.diagnostics || {};
  const runtimeMemory = runtimeDiagnostics.memory as
    | { totalGb?: number; availableGb?: number; percentUsed?: number }
    | undefined;
  const runtimePhaseLabel = {
    idle: "Idle",
    configuring: "Configuring",
    loading: "Loading",
    ready: "Ready",
    failed: "Failed",
  }[runtimeLoadPhase];

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
                  <span>MPS</span>
                  <strong>{runtimeDiagnostics.mpsAvailable ? "yes" : "no"}</strong>
                </div>
              </div>
              <div className="runtime-action-row">
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
                  disabled={isRuntimeBusy}
                  onClick={loadRuntime}
                  type="button"
                >
                  <i className="fas fa-download" aria-hidden="true" />
                  {isRuntimeBusy ? runtimePhaseLabel : "Load Current Model"}
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
              <span>Library</span>
              <strong>{includeLibraryContext ? "included" : "off"}</strong>
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
