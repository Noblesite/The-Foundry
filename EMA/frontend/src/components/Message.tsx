import React from "react";

interface MessageProps {
  sender: "user" | "bot" | "typing";
  text: string;
}

const Message: React.FC<MessageProps> = ({ sender, text }) => {
  const isTyping = sender === "typing";

  return (
    <div
      className={`flex ${
        sender === "user" ? "justify-end" : "justify-start"
      } my-2`}
    >
      {isTyping ? (
        // Typing Indicator Animation
        <div className="flex items-center space-x-2 px-4 py-2">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></span>
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-400"></span>
        </div>
      ) : (
        // Message Bubble
        <div
          className={`max-w-md px-4 py-2 rounded-lg ${
            sender === "user"
              ? "bg-accent text-white rounded-br-none"
              : "bg-transparent text-gray-200"
          }`}
          style={{
            boxShadow: sender === "user" ? "0 2px 6px rgba(0, 0, 0, 0.2)" : "none",
          }}
        >
          <p className="break-words">{text}</p>
        </div>
      )}
    </div>
  );
};

export default Message;