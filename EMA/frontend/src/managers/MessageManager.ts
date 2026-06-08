import apiClient from "./axiosConfig";

export class MessageManager {
  private chatEndpoint: string;
  private queryEndpoint: string;

  constructor(chatEndpoint = "/chat/", queryEndpoint = "/query/") {
    this.chatEndpoint = chatEndpoint;
    this.queryEndpoint = queryEndpoint;
  }

  async sendMessage(message: string): Promise<string> {
    try {
      const response = await apiClient.post(this.chatEndpoint, { text: message });
      return response.data.llm_response;
    } catch (error) {
      console.error("Error sending message:", error);
      return "Oops! Something went wrong. Please try again.";
    }
  }

  async sendQuery(query: string): Promise<string> {
    try {
      const response = await apiClient.post(this.queryEndpoint, { query });
      return response.data.llm_response;
    } catch (error) {
      console.error("Error sending query:", error);
      return "Oops! Something went wrong. Please try again.";
    }
  }

  async saveConversation(conversationId: string): Promise<string> {
    try {
      const response = await apiClient.post("/conversation/save", { conversation_id: conversationId });
      return response.data.message;
    } catch (error) {
      console.error("Error saving conversation:", error);
      return "Failed to save the conversation.";
    }
  }

  async resetConversation(): Promise<string> {
    try {
      const response = await apiClient.post("/conversation/reset");
      return response.data.message;
    } catch (error) {
      console.error("Error resetting conversation:", error);
      return "Failed to reset the conversation.";
    }
  }

  async loadConversation(conversationId: string): Promise<string> {
    try {
      const response = await apiClient.post("/conversation/load", { conversation_id: conversationId });
      if (response.data.status === "success") {
        return response.data.message; // Success message
      } else {
        return response.data.message; // Error message (e.g., not found)
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
      return "Failed to load the conversation.";
    }
  }
}