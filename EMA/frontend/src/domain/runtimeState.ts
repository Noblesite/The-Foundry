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

export const formatRuntimeMemory = (memory: RuntimeMemorySnapshot): string => {
  if (memory.percentUsed === undefined) {
    return "n/a";
  }
  const available = memory.availableGb !== undefined ? `${memory.availableGb} GB free` : "available unknown";
  return `${Math.round(memory.percentUsed)}% used, ${available}`;
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
