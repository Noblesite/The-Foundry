import React, { useMemo, useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WebSocketManager } from "../managers/WebSocketManager";

interface Message {
  id: number;
  sender: "user" | "bot";
  text: string;
  isLoading?: boolean;
}

interface ChatProps {
  subjectMatter: string;
  characterVoice: string;
  selectedConversationId: string;
}

const Chat: React.FC<ChatProps> = ({
  subjectMatter,
  characterVoice,
  selectedConversationId,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const wsManager = useMemo(() => WebSocketManager.getInstance(), []);

  useEffect(() => {
    return () => {
      console.log("Chat component unmounting: closing WebSocket.");
      wsManager.disconnect();
    };
  }, [wsManager]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now(), sender: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const botMessageId = Date.now() + 1;
    
    setMessages((prev) => [
      ...prev,
      { id: botMessageId, sender: "bot", text: "Processing...", isLoading: true },
    ]);

    await wsManager.sendMessage(input, (token) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMessageId
            ? { ...msg, text: msg.isLoading ? token : msg.text + token, isLoading: false }
            : msg
        )
      );
    });
  };

  return (
    <div className="chat-surface">
      <div className="chat-header">
        <div>
          <p className="panel-kicker">Construct</p>
          <h1>{characterVoice} Construct</h1>
        </div>
        <div className="chat-context-pills">
          <span title="Subject matter">
            <i className="fas fa-book-open" aria-hidden="true" />
            {subjectMatter}
          </span>
          <span title="Thread">
            <i className="fas fa-comments" aria-hidden="true" />
            {selectedConversationId === "new" ? "New Construct" : selectedConversationId}
          </span>
        </div>
      </div>

      <div className="message-stream">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message-bubble ${msg.sender === "user" ? "user-bubble" : "bot-bubble prose llm-response"}`}
          >
            {msg.sender === "bot" ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
            ) : (
              msg.text
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          placeholder={`Talk to ${characterVoice}...`}
          className="composer-input"
        />
        <button
          onClick={handleSendMessage}
          className="send-button"
          title="Send message"
          aria-label="Send message"
        >
          <i className="fas fa-paper-plane" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default Chat;
