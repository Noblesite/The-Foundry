import type { ConstructRuntime } from "./foundry";

export interface RuntimeMemorySnapshot {
  percentUsed?: number;
  totalGb?: number;
  availableGb?: number;
}

export interface LoadedModelSnapshot {
  modelId?: string;
  device?: string;
  loaded?: boolean;
  cacheSize?: number;
}

export interface RuntimeLoadEventSnapshot {
  status?: string;
  modelId?: string;
  device?: string;
  durationSeconds?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  failureReason?: string | null;
}

export const getRuntimeMemory = (runtime?: ConstructRuntime | null): RuntimeMemorySnapshot => {
  const memory = runtime?.diagnostics?.memory;
  return memory && typeof memory === "object" ? (memory as RuntimeMemorySnapshot) : {};
};

export const getLoadedModelSnapshot = (
  runtime?: ConstructRuntime | null
): LoadedModelSnapshot => {
  const loadedModel = runtime?.diagnostics?.loadedModel;
  if (loadedModel && typeof loadedModel === "object") {
    return loadedModel as LoadedModelSnapshot;
  }
  return {
    modelId: runtime?.modelId,
    device: runtime?.device,
    loaded: runtime?.loaded,
  };
};

export const getRuntimeLoadEvent = (
  runtime?: ConstructRuntime | null
): RuntimeLoadEventSnapshot => {
  const loadEvent = runtime?.diagnostics?.loadEvent;
  return loadEvent && typeof loadEvent === "object"
    ? (loadEvent as RuntimeLoadEventSnapshot)
    : {};
};

export const formatRuntimeMemory = (memory: RuntimeMemorySnapshot): string => {
  if (memory.percentUsed === undefined) {
    return "n/a";
  }
  const available = memory.availableGb !== undefined ? `${memory.availableGb} GB free` : "available unknown";
  return `${Math.round(memory.percentUsed)}% used, ${available}`;
};

export const formatLoadDuration = (durationSeconds?: number | null): string => {
  if (durationSeconds === undefined || durationSeconds === null) {
    return "n/a";
  }
  if (durationSeconds < 1) {
    return `${Math.round(durationSeconds * 1000)} ms`;
  }
  return `${durationSeconds.toFixed(durationSeconds >= 10 ? 1 : 2)} s`;
};

export const formatRuntimeTimestamp = (value?: string | null): string => {
  if (!value) {
    return "not recorded";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const shortModelId = (modelId?: string): string => {
  if (!modelId) {
    return "No model loaded";
  }
  const normalized = modelId.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2 && !normalized.startsWith("/") && !normalized.startsWith("runtime/")) {
    return parts.slice(-2).join("/");
  }
  return parts[parts.length - 1] || modelId;
};
