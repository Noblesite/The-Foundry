import axios from "axios";

// TODO: Move frontend timeout into a shared Foundry runtime config.
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000", // Fallback to localhost
  timeout: 240000, // Optional: Set a timeout
});

// Optional: Add interceptors for logging, authentication, etc.
apiClient.interceptors.request.use((config) => {
  console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("[API Error]", error);
    return Promise.reject(error);
  }
);

export default apiClient;
