export type FoundryDataSourceMode = "mock" | "construct-api" | "api";

export interface FoundryDataSourceInfo {
  mode: FoundryDataSourceMode;
  label: string;
  badge: string;
  detail: string;
  liveConstruct: boolean;
  liveCatalog: boolean;
}

const dataSourceInfo: Record<FoundryDataSourceMode, FoundryDataSourceInfo> = {
  mock: {
    mode: "mock",
    label: "Mock",
    badge: "Offline",
    detail: "All Foundry workbenches use local mock data.",
    liveConstruct: false,
    liveCatalog: false,
  },
  "construct-api": {
    mode: "construct-api",
    label: "Construct API",
    badge: "Hybrid",
    detail: "Construct runtime, chat, Archive model calls, and timeline events use FastAPI.",
    liveConstruct: true,
    liveCatalog: false,
  },
  api: {
    mode: "api",
    label: "Full API",
    badge: "Live",
    detail: "All Foundry workbenches hydrate from FastAPI.",
    liveConstruct: true,
    liveCatalog: true,
  },
};

export const normalizeFoundryDataSourceMode = (
  value?: string
): FoundryDataSourceMode => {
  if (value === "api" || value === "construct-api") {
    return value;
  }
  return "mock";
};

export const getFoundryDataSourceInfo = (
  value?: string
): FoundryDataSourceInfo => dataSourceInfo[normalizeFoundryDataSourceMode(value)];

export const activeFoundryDataSource = getFoundryDataSourceInfo(
  import.meta.env.VITE_FOUNDRY_DATA_SOURCE
);
