import type {
  ConstructRuntime,
  FoundryRuntimeStatus,
  WorkspaceSettings,
} from "./foundry";
import { activeFoundryDataSource } from "./dataSourceMode";

export type SystemReadinessState = "ready" | "caution" | "blocked";

export interface SystemReadinessStep {
  id: string;
  label: string;
  state: SystemReadinessState;
  detail: string;
}

export interface SystemReadinessSummary {
  state: SystemReadinessState;
  title: string;
  detail: string;
  steps: SystemReadinessStep[];
}

const hasValue = (value?: string | null) => Boolean(value?.trim());

const deriveOverallState = (steps: SystemReadinessStep[]): SystemReadinessState => {
  if (steps.some((step) => step.state === "blocked")) {
    return "blocked";
  }
  if (steps.some((step) => step.state === "caution")) {
    return "caution";
  }
  return "ready";
};

export const buildSystemReadinessSummary = (
  settings: WorkspaceSettings,
  status?: FoundryRuntimeStatus | null,
  runtime?: ConstructRuntime | null
): SystemReadinessSummary => {
  const liveApiRequired = activeFoundryDataSource.liveConstruct || activeFoundryDataSource.liveCatalog;
  const apiReachable = Boolean(status?.api.reachable);
  const selectedModel = settings.constructModelId || settings.modelName;
  const runtimeLoaded = Boolean(status?.construct.modelLoaded || runtime?.loaded);
  const runtimeModelId = status?.construct.modelId || runtime?.modelId || selectedModel;
  const modelLooksLocal =
    hasValue(runtimeModelId) &&
    (runtimeModelId.startsWith("runtime/") ||
      runtimeModelId.startsWith("/") ||
      runtimeLoaded);

  const steps: SystemReadinessStep[] = [
    {
      id: "backend",
      label: "Backend online",
      state: liveApiRequired ? (apiReachable ? "ready" : "blocked") : "ready",
      detail: liveApiRequired
        ? status?.api.detail || "FastAPI has not answered yet."
        : "Mock mode can run without FastAPI.",
    },
    {
      id: "token",
      label: "Hugging Face token",
      state: hasValue(settings.huggingFaceToken) ? "ready" : "caution",
      detail: hasValue(settings.huggingFaceToken)
        ? "A token is saved locally for gated models and downloads."
        : "Optional for public models; required for gated/private models.",
    },
    {
      id: "model-selected",
      label: "Model selected",
      state: hasValue(selectedModel) ? "ready" : "blocked",
      detail: hasValue(selectedModel)
        ? selectedModel
        : "Choose a base or Construct model before loading inference.",
    },
    {
      id: "model-cached",
      label: "Model cached",
      state: modelLooksLocal ? "ready" : runtimeModelId ? "caution" : "blocked",
      detail: modelLooksLocal
        ? `${runtimeModelId} is loaded or points to local runtime storage.`
        : runtimeModelId
          ? `${runtimeModelId} may need to be downloaded before first load.`
          : "No model cache information is available yet.",
    },
    {
      id: "construct-loaded",
      label: "Construct runtime loaded",
      state: runtimeLoaded ? "ready" : status?.construct.reachable ? "caution" : "blocked",
      detail: runtimeLoaded
        ? `${runtimeModelId || "Construct runtime"} is ready for inference.`
        : status?.construct.detail || "Load a model before running local inference.",
    },
    {
      id: "forge-ready",
      label: "Forge runtime ready",
      state: status?.forge.ready ? "ready" : status?.forge.reachable ? "caution" : "blocked",
      detail: status?.forge.detail || "Forge status has not been reported yet.",
    },
  ];

  const state = deriveOverallState(steps);
  return {
    state,
    title:
      state === "ready"
        ? "System ready"
        : state === "caution"
          ? "Almost ready"
          : "Setup needed",
    detail:
      state === "ready"
        ? "The Foundry can run the current Construct and Forge workflow."
        : state === "caution"
          ? "The core loop can continue, but one or more setup items should be reviewed."
          : "Resolve the blocked setup items before testing the full local model flow.",
    steps,
  };
};
