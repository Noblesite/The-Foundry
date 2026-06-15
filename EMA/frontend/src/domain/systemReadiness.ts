import type {
  ConstructRuntime,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  WorkspaceSettings,
} from "./foundry";
import { resolveDefaultBaseModel } from "./foundry";
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
  modelAction: SystemReadinessModelAction;
}

export interface ModelPreparationActivity {
  state: "idle" | "routing" | "registering" | "downloading" | "handoff" | "ready" | "failed" | "canceled";
  label: string;
  detail: string;
  progress: number;
  jobId?: string;
}

export type SystemReadinessModelAction =
  | {
      type: "select-model";
      label: string;
      detail: string;
    }
  | {
      type: "open-archive";
      label: string;
      detail: string;
      modelId: string;
    }
  | {
      type: "download-model";
      label: string;
      detail: string;
      modelId: string;
      revision?: string;
    }
  | {
      type: "open-construct";
      label: string;
      detail: string;
      modelId: string;
      modelLabel?: string;
    }
  | {
      type: "ready";
      label: string;
      detail: string;
    };

const hasValue = (value?: string | null) => Boolean(value?.trim());

const normalizeModelRef = (value?: string | null) => (value || "").trim();

const findArchiveEntryForModel = (
  modelRef: string,
  archiveEntries: ModelArchiveEntry[]
): ModelArchiveEntry | undefined => {
  if (!modelRef) {
    return undefined;
  }
  return archiveEntries.find(
    (entry) =>
      entry.localPath === modelRef ||
      entry.repoId === modelRef ||
      (entry.localPath && modelRef.endsWith(entry.localPath)) ||
      (entry.localPath && entry.localPath.endsWith(modelRef))
  );
};

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
  runtime?: ConstructRuntime | null,
  archiveEntries: ModelArchiveEntry[] = []
): SystemReadinessSummary => {
  const liveApiRequired = activeFoundryDataSource.liveConstruct || activeFoundryDataSource.liveCatalog;
  const apiReachable = Boolean(status?.api.reachable);
  const selectedModel = normalizeModelRef(settings.constructModelId || resolveDefaultBaseModel(settings));
  const runtimeLoaded = Boolean(status?.construct.modelLoaded || runtime?.loaded);
  const runtimeModelId = normalizeModelRef(status?.construct.modelId || runtime?.modelId || selectedModel);
  const archiveEntry = findArchiveEntryForModel(runtimeModelId || selectedModel, archiveEntries);
  const modelLooksLocal = Boolean(
    runtimeLoaded ||
      archiveEntry?.status === "ready" ||
      (archiveEntry?.status === "cached" && archiveEntry.localPath) ||
      (runtimeModelId && (runtimeModelId.startsWith("runtime/") || runtimeModelId.startsWith("/")))
  );
  const archiveState = archiveEntry?.status || (hasValue(selectedModel) ? "remote" : "missing");
  const modelAction: SystemReadinessModelAction = !hasValue(selectedModel)
    ? {
        type: "select-model",
        label: "Choose Model",
        detail: "Select a base model in Archive before preparing local inference.",
      }
    : archiveEntry?.localPath && (archiveEntry.status === "cached" || archiveEntry.status === "ready")
      ? {
          type: "open-construct",
          label: "Open in Construct",
          detail: "The selected model is cached locally and can be handed to Construct.",
          modelId: archiveEntry.localPath,
          modelLabel: archiveEntry.repoId,
        }
      : archiveEntry && archiveEntry.status !== "failed"
        ? {
            type: "download-model",
            label: "Download Model",
            detail: "The model is registered in Archive but still needs a local cache.",
            modelId: archiveEntry.repoId,
            revision: archiveEntry.revision || undefined,
          }
        : {
            type: "open-archive",
            label: "Open Archive",
            detail: "Register this model in Archive before downloading or loading it.",
            modelId: selectedModel,
          };
  const archiveDetail = runtimeLoaded && !archiveEntry
    ? `${runtimeModelId || "Construct runtime"} is currently loaded, but it is not registered in the Archive yet.`
    : archiveEntry
    ? archiveEntry.status === "ready"
      ? `${archiveEntry.repoId} is load-ready at ${archiveEntry.localPath || "registered local storage"}.`
      : archiveEntry.status === "cached"
        ? `${archiveEntry.repoId} is cached at ${archiveEntry.localPath || "local Archive storage"}.`
        : archiveEntry.status === "failed"
          ? `${archiveEntry.repoId} failed its last Archive operation.`
          : `${archiveEntry.repoId} is registered but not downloaded yet.`
    : hasValue(selectedModel)
      ? `${selectedModel} is selected from Hugging Face or settings but is not registered in the Archive yet.`
      : "No model is selected yet.";

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
      label: "Archive state",
      state: modelLooksLocal
        ? "ready"
        : archiveState === "failed" || archiveState === "missing"
          ? "blocked"
          : "caution",
      detail: archiveDetail,
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
    modelAction: runtimeLoaded
      ? {
          type: "ready",
          label: "Model Ready",
          detail: "The current Construct runtime already has a model loaded.",
        }
      : modelAction,
  };
};
