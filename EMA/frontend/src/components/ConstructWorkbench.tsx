import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Artifact, Construct, ConstructMessage, ConstructRuntime } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { LearningCard, TrainingMetricExplainer } from "./LearningComponents";
import { WorkspaceSettings } from "./SettingsOverlay";

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

  const sendMessage = async () => {
    const messageText = input.trim();
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
    setIsSending(true);
    setError(null);

    try {
      const assistantMessageId = `assistant-${Date.now()}`;
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
                onKeyDown={(event) => event.key === "Enter" && sendMessage()}
                placeholder={`Test ${activeArtifact.name}...`}
                type="text"
                value={input}
              />
              <button
                aria-label="Send message"
                className="send-button"
                disabled={isSending}
                onClick={sendMessage}
                title="Send message"
              >
                <i className="fas fa-paper-plane" aria-hidden="true" />
              </button>
            </div>
            {error && <p className="save-state error-state">{error}</p>}
          </div>
        </div>
        <aside className="construct-learning">
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
