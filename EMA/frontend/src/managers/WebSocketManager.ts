export class WebSocketManager {
    private static instance: WebSocketManager;
    private ws: WebSocket | null = null;
    private readonly chatEndpoint: string = "ws://localhost:8000/chat";
    private reconnectAttempts: number = 0;
    private readonly maxReconnectAttempts: number = 5;
    private isConnected: boolean = false;
  
    private constructor() {
      this.connect();
    }
  
    public static getInstance(): WebSocketManager {
      if (!WebSocketManager.instance) {
        WebSocketManager.instance = new WebSocketManager();
      }
      return WebSocketManager.instance;
    }
  
    private connect(): void {
      if (this.ws || this.isConnected) return;
  
      console.log("🔌 Establishing WebSocket connection...");
      this.ws = new WebSocket(this.chatEndpoint);
  
      this.ws.onopen = () => {
        console.log("✅ WebSocket connected.");
        this.isConnected = true;
        this.reconnectAttempts = 0;
      };
  
      this.ws.onmessage = (event) => {
        console.log("📩 WebSocket message received:", event.data);
      };
  
      this.ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
      };
  
      this.ws.onclose = () => {
        console.warn("⚠️ WebSocket closed.");
        this.ws = null;
        this.isConnected = false;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(5000, (2 ** this.reconnectAttempts) * 1000);
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), delay);
        } else {
          console.error("❌ Max WebSocket reconnect attempts reached.");
        }
      };
    }
  
    public disconnect(): void {
      if (this.ws) {
        console.log("🔌 Closing WebSocket connection...");
        this.ws.close();
        this.ws = null;
        this.isConnected = false;
      }
    }
  
    public async sendMessage(
      message: string,
      onTokenReceived: (token: string) => void
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject("WebSocket is not connected.");
          return;
        }
  
        this.ws.onmessage = (event) => {
          onTokenReceived(event.data);
        };
  
        this.ws.send(message);
        resolve();
      });
    }
  }