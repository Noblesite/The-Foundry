import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Artifact,
  Construct,
  ConstructMessage,
  ConstructRuntime,
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

interface ConstructWorkbenchProps {
  artifact: Artifact;
  construct: Construct;
  repository: FoundryRepository;
  settings: WorkspaceSettings;
}

const ConstructWorkbench: React.FC<ConstructWorkbenchProps> = ({
  artifact,
  construct,
  repository,
  settings,
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
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
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
  }, [artifact, construct]);

  useEffect(() => {
    let isCurrent = true;

    repository
      .getConstructRuntime()
      .then((runtimeStatus) => {
        if (isCurrent) {
          setRuntime(runtimeStatus);
          setRuntimeMode(runtimeStatus.mode);
          setRuntimeDetail(runtimeStatus.detail);
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
  }, [repository]);

  const configureRuntime = async () => {
    setIsRuntimeBusy(true);
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
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not configure runtime.");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const loadRuntime = async () => {
    setIsRuntimeBusy(true);
    setError(null);
    try {
      const runtimeStatus = await repository.loadConstructRuntime({
        modelId: settings.constructModelId || activeArtifact.baseModel,
      });
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not load runtime.");
    } finally {
      setIsRuntimeBusy(false);
    }
  };

  const unloadRuntime = async () => {
    setIsRuntimeBusy(true);
    setError(null);
    try {
      const runtimeStatus = await repository.unloadConstructRuntime();
      setRuntime(runtimeStatus);
      setRuntimeMode(runtimeStatus.mode);
      setRuntimeDetail(runtimeStatus.detail);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not unload runtime.");
    } finally {
      setIsRuntimeBusy(false);
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
            setRuntime((current) => ({
              mode: event.runtime?.mode === "transformers" ? "transformers" : "simulated",
              status: event.runtime?.status || current?.status || "fallback",
              detail: event.runtime?.detail || current?.detail || "",
              modelId: event.runtime?.modelId || current?.modelId || activeArtifact.baseModel,
              device: event.runtime?.device || current?.device || "none",
              loaded: event.runtime?.loaded ?? current?.loaded ?? false,
            }));
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
              <strong>{activeArtifact.version}</strong>
              <span>{activeArtifact.adapterPath || "No adapter path registered."}</span>
              <div className="runtime-control-grid">
                <span className="status-badge">{runtime?.status || runtimeMode}</span>
                <span className="status-badge">{runtime?.loaded ? "loaded" : "not loaded"}</span>
                <span className="status-badge">{runtime?.device || settings.constructDevice}</span>
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
                  Load
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
