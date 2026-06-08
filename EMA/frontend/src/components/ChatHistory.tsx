import React, { useEffect, useMemo, useState } from "react";
import { MessageManager } from "../managers/MessageManager";
import { WorkspaceSettings } from "./SettingsOverlay";

type SidebarSection = "threads" | "workspace";

interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
}

interface ChatHistoryProps {
  activeSection: SidebarSection;
  selectedConversationId: string;
  settings: WorkspaceSettings;
  onSelectConversation: (id: string) => void;
  onOpenSettings: () => void;
}

const fallbackConversations: Conversation[] = [
  {
    id: "new",
    title: "New Construct session",
    lastMessage: "Start a fresh inference test.",
    updatedAt: new Date().toISOString(),
  },
];

const pipelineSteps = [
  {
    icon: "fa-database",
    label: "Collect",
    description: "CSV, websites, PDFs, transcripts",
  },
  {
    icon: "fa-wand-magic-sparkles",
    label: "Generate QA",
    description: "Structured examples for training",
  },
  {
    icon: "fa-layer-group",
    label: "Train adapter",
    description: "LoRA or QLoRA subject tuning",
  },
  {
    icon: "fa-comment-dots",
    label: "Chat",
    description: "Stream tokens from the tuned persona",
  },
];

const ChatHistory: React.FC<ChatHistoryProps> = ({
  activeSection,
  selectedConversationId,
  settings,
  onSelectConversation,
  onOpenSettings,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>(fallbackConversations);
  const [loading, setLoading] = useState(false);
  const messageManager = useMemo(() => new MessageManager(), []);

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        setConversations(data);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    }
  };

  const handleSaveConversation = async (id: string) => {
    setLoading(true);
    try {
      const message = await messageManager.saveConversation(id);
      console.log("Conversation saved:", message);
    } catch (error) {
      console.error("Failed to save conversation:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadConversation = async (id: string) => {
    setLoading(true);
    try {
      const message = await messageManager.loadConversation(id);
      console.log("Conversation loaded:", message);
      onSelectConversation(id);
    } catch (error) {
      console.error("Failed to load conversation:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetConversations = async () => {
    setLoading(true);
    try {
      const message = await messageManager.resetConversation();
      console.log("Conversations reset:", message);
      setConversations(fallbackConversations);
    } catch (error) {
      console.error("Failed to reset conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  if (activeSection === "workspace") {
    return (
      <section className="workspace-panel" aria-label="Workspace">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Workshop</p>
            <h2>{settings.subjectMatter}</h2>
          </div>
          <button className="icon-button" onClick={onOpenSettings} title="Open settings" aria-label="Open settings">
            <i className="fas fa-sliders" aria-hidden="true" />
          </button>
        </div>

        <div className="persona-summary">
          <p className="summary-label">Target voice</p>
          <p className="summary-value">{settings.characterVoice}</p>
        </div>

        <div className="workspace-paths">
          <div>
            <span>Materials</span>
            <code>{settings.sourceDirectory}</code>
          </div>
          <div>
            <span>QA output</span>
            <code>{settings.outputDirectory}</code>
          </div>
        </div>

        <div className="pipeline-list">
          {pipelineSteps.map((step) => (
            <div className="pipeline-step" key={step.label}>
              <i className={`fas ${step.icon}`} aria-hidden="true" />
              <div>
                <p>{step.label}</p>
                <span>{step.description}</span>
              </div>
            </div>
          ))}
        </div>

        <button className="primary-action" onClick={onOpenSettings}>
          <i className="fas fa-gear" aria-hidden="true" />
          Configure Assembly Line
        </button>
      </section>
    );
  }

  return (
    <section className="threads-panel" aria-label="Threads">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Memory</p>
          <h2>Threads</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => onSelectConversation("new")}
          disabled={loading}
          title="New thread"
          aria-label="New thread"
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
      </div>

      <div className="thread-list">
        {conversations.map((conversation) => (
          <article
            key={conversation.id}
            className={`thread-item ${conversation.id === selectedConversationId ? "is-active" : ""}`}
            onClick={() => handleLoadConversation(conversation.id)}
          >
            <div className="thread-row">
              <h3>{conversation.title || "Untitled Conversation"}</h3>
              <button
                className="thread-action"
                disabled={loading}
                title="Save thread"
                aria-label={`Save ${conversation.title || "thread"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleSaveConversation(conversation.id);
                }}
              >
                <i className="fas fa-bookmark" aria-hidden="true" />
              </button>
            </div>
            <p>{conversation.lastMessage || "No messages yet"}</p>
            <time>{new Date(conversation.updatedAt).toLocaleString()}</time>
          </article>
        ))}
      </div>

      <footer className="sidebar-footer">
        <button className="secondary-action" onClick={handleResetConversations} disabled={loading}>
          <i className="fas fa-rotate-left" aria-hidden="true" />
          Reset
        </button>
      </footer>
    </section>
  );
};

export default ChatHistory;
