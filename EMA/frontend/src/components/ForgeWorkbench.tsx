import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StartForgeRequest } from "../contracts/foundryApi";
import {
  ACADEMY_ACTION_IDS,
  findAcademyAction,
} from "../domain/academyRegistry";
import {
  AcademyAction,
  Artifact,
  Construct,
  ConstructChatResponse,
  ForgeLocalTrainerPreflightResult,
  FoundryLoopFocus,
  ForgeRun,
  ForgePurpose,
  ForgeRuntime,
  ForgeRuntimeMode,
  ForgeSmokeProofResult,
  ForgeTrainingContract,
  ForgeWorkerState,
  MaterialSource,
  ModelArchiveEntry,
  ModelSearchResult,
  resolveDefaultBaseModel,
  SectionSummary,
  TrainingMethod,
  Workshop,
} from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { WorkspaceSettings } from "./SettingsOverlay";
import {
  AcademyActionTooltip,
  ConceptTooltip,
  LearningCard,
  TrainingMetricExplainer,
} from "./LearningComponents";
import BaseModelSelector from "./BaseModelSelector";
import LoopFocusCallout from "./LoopFocusCallout";

const FORGE_WORKER_POLL_MS = 3000;

type ForgeDetailTab = "events" | "contract" | "trial" | "metrics";
type ForgeLoopFocusTarget = "contract" | "queue";

const forgeLoopFocusTarget = (
  focus?: FoundryLoopFocus | null
): ForgeLoopFocusTarget | null => {
  if (!focus || focus.section !== "forge") {
    return null;
  }
  return focus.targetLabel === "Forge Queue" ? "queue" : "contract";
};

const formatBytes = (bytes: number) => {
  if (!bytes) {
    return "0 MB";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const inferForgePurpose = (material?: MaterialSource): ForgePurpose => {
  if (!material) {
    return "training";
  }
  const marker = `${material.name} ${material.sourceUri}`.toLowerCase();
  return marker.includes("trial") || marker.includes("-trials-") ? "evaluation" : "training";
};

interface MaterialTrainingReadiness {
  status: string;
  forgeReady: boolean;
  defaultTrainingSafe: boolean;
  rowCount: number;
  qualityPassedRows: number;
  qualityBlockedRows: number;
  deterministicRows: number;
  fallbackRows: number;
  generatorModels: string[];
  recommendation: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArrayFromUnknown = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const numberFromUnknown = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const materialTrainingReadiness = (
  material?: MaterialSource
): MaterialTrainingReadiness | null => {
  const exportMetadata = isRecord(material?.metadata?.export) ? material.metadata.export : null;
  const trainingReadiness = isRecord(exportMetadata?.trainingReadiness)
    ? exportMetadata.trainingReadiness
    : null;
  if (!trainingReadiness) {
    return null;
  }
  return {
    status: typeof trainingReadiness.status === "string" ? trainingReadiness.status : "unknown",
    forgeReady: trainingReadiness.forgeReady === true,
    defaultTrainingSafe: trainingReadiness.defaultTrainingSafe === true,
    rowCount: numberFromUnknown(trainingReadiness.rowCount),
    qualityPassedRows: numberFromUnknown(trainingReadiness.qualityPassedRows),
    qualityBlockedRows: numberFromUnknown(trainingReadiness.qualityBlockedRows),
    deterministicRows: numberFromUnknown(trainingReadiness.deterministicRows),
    fallbackRows: numberFromUnknown(trainingReadiness.fallbackRows),
    generatorModels: stringArrayFromUnknown(trainingReadiness.generatorModels),
    recommendation:
      typeof trainingReadiness.recommendation === "string"
        ? trainingReadiness.recommendation
        : "Review dataset readiness before creating a Forge.",
  };
};

interface ForgeWorkbenchProps {
  academyActions: AcademyAction[];
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  summary: SectionSummary;
  workshop: Workshop;
  archiveEntries?: ModelArchiveEntry[];
  forgePreset?: StartForgeRequest | null;
  academyAction?: AcademyAction;
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onSearchBaseModels?: (query: string) => Promise<ModelSearchResult[]>;
  onOpenAcademy: () => void;
  onOpenAcademyAction: (actionId: string) => void;
  onLoopEvidenceRefresh?: () => void;
  loopFocus?: FoundryLoopFocus | null;
}

const ForgeWorkbench: React.FC<ForgeWorkbenchProps> = ({
  academyActions,
  repository,
  settings,
  summary,
  workshop,
  archiveEntries = [],
  forgePreset,
  academyAction,
  onConstructLoaded,
  onSearchBaseModels,
  onOpenAcademy,
  onOpenAcademyAction,
  onLoopEvidenceRefresh,
  loopFocus,
}) => {
  const defaultBaseModel = resolveDefaultBaseModel(settings);
  const [materials, setMaterials] = useState<MaterialSource[]>([]);
  const [forgeRuns, setForgeRuns] = useState<ForgeRun[]>([]);
  const [workerStates, setWorkerStates] = useState<Record<string, ForgeWorkerState>>({});
  const [draft, setDraft] = useState<StartForgeRequest>({
    materialSetId: "",
    baseModel: defaultBaseModel,
    method: settings.trainingMethod,
    purpose: "training",
    epochs: settings.epochs,
    learningRate: settings.learningRate,
    loadIn4Bit: settings.loadIn4Bit,
  });
  const [isStarting, setIsStarting] = useState(false);
  const [advancingRunId, setAdvancingRunId] = useState<string | null>(null);
  const [autoCompletingRunId, setAutoCompletingRunId] = useState<string | null>(null);
  const [loadingConstructRunId, setLoadingConstructRunId] = useState<string | null>(null);
  const [isRefreshingWorkers, setIsRefreshingWorkers] = useState(false);
  const [isConfiguringRuntime, setIsConfiguringRuntime] = useState(false);
  const [selectedForgeDetailId, setSelectedForgeDetailId] = useState<string | null>(null);
  const [selectedForgeContract, setSelectedForgeContract] =
    useState<ForgeTrainingContract | null>(null);
  const [forgeDetailTab, setForgeDetailTab] = useState<ForgeDetailTab>("events");
  const [isLoadingForgeDetail, setIsLoadingForgeDetail] = useState(false);
  const forgeFocusTarget = useMemo(() => forgeLoopFocusTarget(loopFocus), [loopFocus]);
  const forgeContractRef = useRef<HTMLFormElement | null>(null);
  const forgeQueueRef = useRef<HTMLElement | null>(null);
  const [isReconcilingForgeDetail, setIsReconcilingForgeDetail] = useState(false);

  useEffect(() => {
    if (!forgeFocusTarget || loopFocus?.section !== "forge") {
      return undefined;
    }

    const target =
      forgeFocusTarget === "queue" ? forgeQueueRef.current : forgeContractRef.current;
    const timeoutId = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [forgeFocusTarget, loopFocus?.requestedAt, loopFocus?.section]);
  const [localTrainingRunId, setLocalTrainingRunId] = useState<string | null>(null);
  const [localPreflightRunId, setLocalPreflightRunId] = useState<string | null>(null);
  const [localTrainerPreflights, setLocalTrainerPreflights] = useState<
    Record<string, ForgeLocalTrainerPreflightResult>
  >({});
  const [smokeProofResult, setSmokeProofResult] = useState<ForgeSmokeProofResult | null>(null);
  const [smokeConstructResponse, setSmokeConstructResponse] =
    useState<ConstructChatResponse | null>(null);
  const [smokeProofMode, setSmokeProofMode] = useState<"preflight" | "training" | null>(null);
  const [forgeDetailError, setForgeDetailError] = useState<string | null>(null);
  const [forgeRuntime, setForgeRuntime] = useState<ForgeRuntime | null>(null);
  const [runtimeModeDraft, setRuntimeModeDraft] = useState<ForgeRuntimeMode>("simulated");
  const [lastWorkerSync, setLastWorkerSync] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshForgeQueue = useCallback(
    async ({ silent = true }: { silent?: boolean } = {}) => {
      if (!silent) {
        setIsRefreshingWorkers(true);
        setError(null);
      }

      try {
        const runs = await repository.listForgeRuns(workshop.id);
        const workerStateEntries = await Promise.all(
          runs.map(async (run) => {
            try {
              const state = await repository.getForgeWorkerState(run.id);
              return [run.id, state] as const;
            } catch {
              return run.workerState ? ([run.id, run.workerState] as const) : null;
            }
          })
        );

        setForgeRuns(runs);
        setWorkerStates((current) => {
          const next = { ...current };
          workerStateEntries.forEach((entry) => {
            if (entry) {
              next[entry[0]] = entry[1];
            }
          });
          return next;
        });
        setLastWorkerSync(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      } catch (refreshError: unknown) {
        if (!silent) {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not refresh Forge worker events."
          );
        }
      } finally {
        if (!silent) {
          setIsRefreshingWorkers(false);
        }
      }
    },
    [repository, workshop.id]
  );

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterials(workshop.id),
      repository.listForgeRuns(workshop.id),
      repository.getForgeRuntime(),
    ])
      .then(([sources, runs, runtime]) => {
        if (!isCurrent) {
          return;
        }

        const jsonlMaterials = sources.filter((source) => source.kind === "jsonl");
        setMaterials(sources);
        setForgeRuns(runs);
        const seededStates = runs.reduce<Record<string, ForgeWorkerState>>((states, run) => {
          if (run.workerState) {
            states[run.id] = run.workerState;
          }
          return states;
        }, {});
        setWorkerStates(seededStates);
        setForgeRuntime(runtime);
        setRuntimeModeDraft(runtime.mode);
        setDraft((current) => {
          if (forgePreset) {
            return forgePreset;
          }
          const materialSetId = current.materialSetId || jsonlMaterials[0]?.id || "";
          const material = jsonlMaterials.find((source) => source.id === materialSetId);
          return {
            ...current,
            baseModel: defaultBaseModel,
            method: settings.trainingMethod,
            learningRate: settings.learningRate,
            loadIn4Bit: settings.loadIn4Bit,
            epochs: settings.epochs,
            materialSetId,
            purpose: current.materialSetId ? current.purpose : inferForgePurpose(material),
          };
        });
        runs.forEach((run) => {
          repository
            .getForgeWorkerState(run.id)
            .then((state) => {
              if (isCurrent) {
                setWorkerStates((current) => ({ ...current, [run.id]: state }));
              }
            })
            .catch(() => {
              // Older Forge rows may not have worker files yet.
            });
        });
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Forge data.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    repository,
    defaultBaseModel,
    forgePreset,
    settings.epochs,
    settings.learningRate,
    settings.loadIn4Bit,
    settings.trainingMethod,
    workshop.id,
  ]);

  useEffect(() => {
    if (!forgePreset) {
      return;
    }
    setDraft(forgePreset);
    setStatusText(
      forgePreset.purpose === "evaluation"
        ? "Evaluation preset loaded from Trials."
        : "Training preset loaded from Trials."
    );
    setError(null);
  }, [forgePreset]);

  const jsonlMaterials = useMemo(
    () => materials.filter((source) => source.kind === "jsonl"),
    [materials]
  );

  const hasActiveForgeRuns = useMemo(
    () => forgeRuns.some((run) => run.status === "queued" || run.status === "running"),
    [forgeRuns]
  );

  const selectedMaterial = useMemo(
    () => jsonlMaterials.find((source) => source.id === draft.materialSetId),
    [draft.materialSetId, jsonlMaterials]
  );
  const selectedTrainingReadiness = useMemo(
    () => materialTrainingReadiness(selectedMaterial),
    [selectedMaterial]
  );
  const selectedMaterialForgeBlocked = selectedTrainingReadiness?.forgeReady === false;
  const forgeNextAction = useMemo(() => {
    if (!forgeFocusTarget) {
      return undefined;
    }
    if (forgeFocusTarget === "queue") {
      if (forgeRuns.length === 0) {
        return "Create a Forge contract first; queued and running jobs will appear here.";
      }
      return hasActiveForgeRuns
        ? "Monitor the active Forge job and reconcile worker state when it finishes."
        : "Inspect completed Forge jobs and load their Artifacts into Construct when ready.";
    }
    if (jsonlMaterials.length === 0) {
      return "Export an approved JSONL Material from Materials before starting a Forge.";
    }
    if (!draft.materialSetId) {
      return "Select an exported JSONL Material for the Forge contract.";
    }
    if (!selectedMaterial) {
      return "Choose a valid JSONL Material from the available exported Materials.";
    }
    if (selectedTrainingReadiness?.forgeReady === false) {
      return "Select a Forge-ready JSONL Material or return to Materials to fix the QA export.";
    }
    if (selectedTrainingReadiness?.defaultTrainingSafe === false) {
      return "This JSONL Material is Forge-ready with caution. Review blocked or override rows before real training.";
    }
    return "Review method, base model, and proof settings, then queue the Forge.";
  }, [
    draft.materialSetId,
    forgeFocusTarget,
    forgeRuns.length,
    hasActiveForgeRuns,
    jsonlMaterials.length,
    selectedMaterial,
    selectedTrainingReadiness,
  ]);
  const trainingMethodAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.forgeTrainingMethod
  );
  const adapterBoundaryAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.forgeAdapterBoundary
  );
  const proofModeAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.forgeProofMode
  );

  const selectedForgeRun = useMemo(
    () => forgeRuns.find((run) => run.id === selectedForgeDetailId) || null,
    [forgeRuns, selectedForgeDetailId]
  );

  const selectedForgeWorkerState = selectedForgeDetailId
    ? workerStates[selectedForgeDetailId]
    : undefined;
  const selectedEvaluationReport = selectedForgeWorkerState?.metrics.evaluationReport;
  const selectedLocalTrainerPreflight = selectedForgeDetailId
    ? localTrainerPreflights[selectedForgeDetailId]
    : undefined;
  const canRunSelectedLocalTrainer =
    Boolean(selectedForgeRun) &&
    selectedForgeRun?.purpose === "training" &&
    selectedForgeRun?.status !== "completed" &&
    selectedForgeRun?.status !== "failed" &&
    forgeRuntime?.mode === "local" &&
    Boolean(forgeRuntime.ready) &&
    Boolean(selectedLocalTrainerPreflight?.ok);

  useEffect(() => {
    if (!hasActiveForgeRuns) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshForgeQueue();
    }, FORGE_WORKER_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasActiveForgeRuns, refreshForgeQueue]);

  const updateDraft = <K extends keyof StartForgeRequest>(
    key: K,
    value: StartForgeRequest[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateMaterialSelection = (materialSetId: string) => {
    const material = jsonlMaterials.find((source) => source.id === materialSetId);
    setDraft((current) => ({
      ...current,
      materialSetId,
      purpose: inferForgePurpose(material),
    }));
  };

  const configureRuntime = async () => {
    setIsConfiguringRuntime(true);
    setError(null);
    setStatusText(null);

    try {
      const runtime = await repository.configureForgeRuntime({
        mode: runtimeModeDraft,
        worker: runtimeModeDraft === "local" ? "local-process" : undefined,
      });
      setForgeRuntime(runtime);
      setStatusText(`Forge runtime set to ${runtime.mode}: ${runtime.status}.`);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not configure Forge runtime.");
    } finally {
      setIsConfiguringRuntime(false);
    }
  };

  const runForgeSmokeProof = async (runTraining: boolean) => {
    setError(null);
    setStatusText(null);
    setSmokeConstructResponse(null);
    setSmokeProofMode(runTraining ? "training" : "preflight");

    try {
      const result = await repository.runForgeSmokeProof({ runTraining });
      setSmokeProofResult(result);
      setMaterials((current) => [
        result.material,
        ...current.filter((material) => material.id !== result.material.id),
      ]);
      setForgeRuns((current) => [
        result.forgeRun,
        ...current.filter((run) => run.id !== result.forgeRun.id),
      ]);
      setWorkerStates((current) => ({
        ...current,
        [result.forgeRun.id]: result.workerState,
      }));
      setLocalTrainerPreflights((current) => ({
        ...current,
        [result.forgeRun.id]: result.preflight,
      }));
      setForgeRuntime(result.preflight.runtime);
      setRuntimeModeDraft(result.preflight.runtime.mode);

      let constructResponse: ConstructChatResponse | null = null;
      if (result.ranTraining) {
        const artifact =
          result.artifact ||
          (result.forgeRun.artifactId
            ? (await repository.listArtifacts(result.workshop.id)).find(
                (item) => item.id === result.forgeRun.artifactId
              ) || null
            : null);
        if (!artifact) {
          throw new Error("Tiny Forge proof completed, but Artifact metadata was not found.");
        }
        const construct = await repository.loadArtifactIntoConstruct(result.workshop.id, {
          artifactId: artifact.id,
        });
        onConstructLoaded(construct, artifact);
        constructResponse = await repository.chatWithConstruct(construct.id, {
          conversationId: `smoke-${result.forgeRun.id}`,
          message: "In one sentence, what did this tiny Forge proof validate?",
          includeLibraryContext: false,
          maxNewTokens: 48,
          temperature: 0.2,
        });
        setSmokeConstructResponse(constructResponse);
      }
      setStatusText(
        result.ranTraining
          ? `Tiny Forge proof completed and loaded into ${constructResponse?.construct.name || "Construct"}.`
          : result.preflight.ok
            ? "Tiny Forge proof preflight passed."
            : "Tiny Forge proof is blocked. Review the failed checks."
      );
      onLoopEvidenceRefresh?.();
    } catch (proofError: unknown) {
      setError(proofError instanceof Error ? proofError.message : "Could not run Tiny Forge proof.");
    } finally {
      setSmokeProofMode(null);
    }
  };

  const loadForgeDetail = async (
    forgeRun: ForgeRun,
    {
      resetTab = true,
      initialTab,
    }: { resetTab?: boolean; initialTab?: ForgeDetailTab } = {}
  ) => {
    setSelectedForgeDetailId(forgeRun.id);
    if (initialTab) {
      setForgeDetailTab(initialTab);
    } else if (resetTab) {
      setForgeDetailTab("events");
    }
    setSelectedForgeContract(forgeRun.trainingContract || null);
    setForgeDetailError(null);
    setIsLoadingForgeDetail(true);

    try {
      const [contract, workerState] = await Promise.all([
        repository.getForgeContract(forgeRun.id).catch(() => forgeRun.trainingContract || null),
        repository.getForgeWorkerState(forgeRun.id),
      ]);

      setSelectedForgeContract(contract);
      setWorkerStates((current) => ({ ...current, [forgeRun.id]: workerState }));
      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch (detailError: unknown) {
      setForgeDetailError(
        detailError instanceof Error ? detailError.message : "Could not load Forge detail."
      );
    } finally {
      setIsLoadingForgeDetail(false);
    }
  };

  const refreshForgeDetail = async () => {
    if (!selectedForgeRun) {
      return;
    }
    await loadForgeDetail(selectedForgeRun, { resetTab: false });
  };

  const reconcileForgeDetail = async () => {
    if (!selectedForgeRun) {
      return;
    }
    setForgeDetailError(null);
    setIsReconcilingForgeDetail(true);

    try {
      const state = await repository.reconcileForgeWorkerState(selectedForgeRun.id);
      setSelectedForgeContract(state.contract);
      setWorkerStates((current) => ({
        ...current,
        [selectedForgeRun.id]: {
          events: state.events,
          metrics: state.metrics,
        },
      }));
      if (state.forgeRun) {
        setForgeRuns((current) =>
          current.map((run) => (run.id === state.forgeRun?.id ? state.forgeRun : run))
        );
      }
      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch (reconcileError: unknown) {
      setForgeDetailError(
        reconcileError instanceof Error
          ? reconcileError.message
          : "Could not reconcile Forge worker state."
      );
    } finally {
      setIsReconcilingForgeDetail(false);
    }
  };

  const preflightLocalForgeWorker = async () => {
    if (!selectedForgeRun) {
      return;
    }
    setForgeDetailError(null);
    setError(null);
    setStatusText(null);
    setLocalPreflightRunId(selectedForgeRun.id);

    try {
      const preflight = await repository.preflightLocalForgeWorker(selectedForgeRun.id);
      setSelectedForgeContract(preflight.contract);
      setLocalTrainerPreflights((current) => ({
        ...current,
        [selectedForgeRun.id]: preflight,
      }));
      setStatusText(
        preflight.ok
          ? "Local trainer preflight passed."
          : "Local trainer preflight found blocked checks."
      );
    } catch (preflightError: unknown) {
      setForgeDetailError(
        preflightError instanceof Error
          ? preflightError.message
          : "Could not preflight local Forge trainer."
      );
    } finally {
      setLocalPreflightRunId(null);
    }
  };

  const runLocalForgeWorker = async () => {
    if (!selectedForgeRun) {
      return;
    }
    if (!selectedLocalTrainerPreflight?.ok) {
      setForgeDetailError("Run and pass local trainer preflight before starting training.");
      return;
    }
    setForgeDetailError(null);
    setError(null);
    setStatusText(null);
    setLocalTrainingRunId(selectedForgeRun.id);

    try {
      const state = await repository.runLocalForgeWorker(selectedForgeRun.id);
      setSelectedForgeContract(state.contract);
      setWorkerStates((current) => ({
        ...current,
        [selectedForgeRun.id]: {
          events: state.events,
          metrics: state.metrics,
        },
      }));
      if (state.forgeRun) {
        setForgeRuns((current) =>
          current.map((run) => (run.id === state.forgeRun?.id ? state.forgeRun : run))
        );
      }
      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setStatusText(
        state.forgeRun?.artifactId
          ? `${state.forgeRun.label} completed. Artifact ${state.forgeRun.artifactId} is ready.`
          : "Local trainer completed worker execution."
      );
      onLoopEvidenceRefresh?.();
    } catch (workerError: unknown) {
      setForgeDetailError(
        workerError instanceof Error ? workerError.message : "Could not run local Forge trainer."
      );
    } finally {
      setLocalTrainingRunId(null);
    }
  };

  const closeForgeDetail = () => {
    setSelectedForgeDetailId(null);
    setSelectedForgeContract(null);
    setForgeDetailError(null);
  };

  const startForge = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsStarting(true);
    setError(null);
    setStatusText(null);

    try {
      if (selectedMaterialForgeBlocked) {
        throw new Error("Selected JSONL Material is not Forge-ready. Fix the QA export before queueing.");
      }
      const forgeRun = await repository.startForge(workshop.id, draft);
      setForgeRuns((current) => [forgeRun, ...current.filter((run) => run.id !== forgeRun.id)]);
      if (forgeRun.workerState) {
        setWorkerStates((current) => ({ ...current, [forgeRun.id]: forgeRun.workerState! }));
      }
      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setStatusText(
        `${forgeRun.label} queued with ${selectedMaterial?.qaPairCount ?? 0} ${
          draft.purpose === "evaluation" ? "evaluation" : "training"
        } rows.`
      );
      onLoopEvidenceRefresh?.();
    } catch (startError: unknown) {
      setError(startError instanceof Error ? startError.message : "Could not start Forge.");
    } finally {
      setIsStarting(false);
    }
  };

  const advanceSimulation = async (forgeRunId: string) => {
    setAdvancingRunId(forgeRunId);
    setError(null);
    setStatusText(null);

    try {
      const forgeRun = await repository.advanceForgeSimulation(forgeRunId);
      setForgeRuns((current) =>
        current.map((run) => (run.id === forgeRun.id ? forgeRun : run))
      );
      if (forgeRun.workerState) {
        setWorkerStates((current) => ({ ...current, [forgeRun.id]: forgeRun.workerState! }));
      }
      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setStatusText(
        forgeRun.artifactId
          ? `${forgeRun.label} completed. Artifact ${forgeRun.artifactId} is ready.`
          : `${forgeRun.label} is ${forgeRun.status} at ${forgeRun.progress}%.`
      );
      onLoopEvidenceRefresh?.();
    } catch (advanceError: unknown) {
      setError(
        advanceError instanceof Error ? advanceError.message : "Could not advance Forge simulation."
      );
    } finally {
      setAdvancingRunId(null);
    }
  };

  const runSimulationToCompletion = async (forgeRunId: string) => {
    setAutoCompletingRunId(forgeRunId);
    setError(null);
    setStatusText(null);

    try {
      let latestRun = forgeRuns.find((run) => run.id === forgeRunId) || null;
      for (let step = 0; step < 12; step += 1) {
        if (latestRun?.status === "completed" || latestRun?.status === "failed") {
          break;
        }

        latestRun = await repository.advanceForgeSimulation(forgeRunId);
        setForgeRuns((current) =>
          current.map((run) => (run.id === latestRun?.id ? latestRun : run))
        );
        if (latestRun.workerState) {
          setWorkerStates((current) => ({ ...current, [latestRun!.id]: latestRun!.workerState! }));
        }
      }

      if (!latestRun) {
        throw new Error("Forge job was not found.");
      }

      setLastWorkerSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setStatusText(
        latestRun.artifactId
          ? `${latestRun.label} completed. Artifact ${latestRun.artifactId} is ready.`
          : `${latestRun.label} stopped at ${latestRun.progress}%.`
      );
      onLoopEvidenceRefresh?.();
    } catch (completeError: unknown) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Could not run Forge simulation to completion."
      );
    } finally {
      setAutoCompletingRunId(null);
    }
  };

  const loadForgeArtifactIntoConstruct = async (forgeRun: ForgeRun) => {
    if (forgeRun.purpose === "evaluation") {
      setError("Evaluation Forges produce metrics, not Artifacts. Queue a training Forge to create a Construct.");
      return;
    }

    let handoffRun = forgeRun;
    if (!handoffRun.artifactId && handoffRun.status === "completed") {
      try {
        const state = await repository.reconcileForgeWorkerState(handoffRun.id);
        if (state.forgeRun) {
          handoffRun = state.forgeRun;
          setForgeRuns((current) =>
            current.map((run) => (run.id === handoffRun.id ? handoffRun : run))
          );
          setSelectedForgeContract(state.contract);
          setWorkerStates((current) => ({
            ...current,
            [handoffRun.id]: {
              events: state.events,
              metrics: state.metrics,
            },
          }));
        }
      } catch {
        // The explicit error below gives the operator a clearer next action.
      }
    }

    if (!handoffRun.artifactId) {
      setError("Complete this Forge before loading a Construct.");
      return;
    }

    setLoadingConstructRunId(handoffRun.id);
    setError(null);
    setStatusText(null);

    try {
      const artifacts = await repository.listArtifacts(workshop.id);
      const artifact = artifacts.find((item) => item.id === handoffRun.artifactId);
      if (!artifact) {
        throw new Error("Artifact metadata was not found for this Forge.");
      }

      const construct = await repository.loadArtifactIntoConstruct(workshop.id, {
        artifactId: artifact.id,
      });
      setStatusText(
        artifact.readiness?.artifactKind === "lora-adapter"
          ? `${artifact.name} loaded into ${construct.name}. Construct runtime will apply the adapter during local load.`
          : `${artifact.name} loaded into ${construct.name}.`
      );
      onConstructLoaded(construct, artifact);
      onLoopEvidenceRefresh?.();
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Construct.");
    } finally {
      setLoadingConstructRunId(null);
    }
  };

  return (
    <section className="forge-workbench" aria-label="Forge workbench">
      <div className="workbench-hero panel-glass">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="status-badge is-forging">{workshop.name}</div>
      </div>

      <LoopFocusCallout focus={loopFocus} nextAction={forgeNextAction} section="forge" />

      <div className="forge-layout">
        <form
          className={`forge-panel panel-glass ${forgeFocusTarget === "contract" ? "is-loop-focused" : ""}`}
          onSubmit={startForge}
          ref={forgeContractRef}
        >
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Forge contract</p>
              <h2>Queue a Forge</h2>
            </div>
          </div>

          <label className="field-label" htmlFor="forge-material">
            Material
          </label>
          <select
            id="forge-material"
            value={draft.materialSetId}
            onChange={(event) => updateMaterialSelection(event.target.value)}
            required
          >
            <option value="">Select exported JSONL Material</option>
            {jsonlMaterials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name} / {material.qaPairCount.toLocaleString()} rows
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="forge-purpose">
            Purpose
          </label>
          <div className="segmented-control" id="forge-purpose" role="group" aria-label="Forge purpose">
            {(["training", "evaluation"] as ForgePurpose[]).map((purpose) => (
              <button
                className={draft.purpose === purpose ? "is-active" : ""}
                key={purpose}
                onClick={() => updateDraft("purpose", purpose)}
                type="button"
              >
                {purpose === "training" ? "Train Artifact" : "Run Evaluation"}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="forge-base-model">
            Base model
          </label>
          <BaseModelSelector
            id="forge-base-model"
            value={draft.baseModel}
            defaultBaseModel={defaultBaseModel}
            settings={settings}
            archiveEntries={archiveEntries}
            onChange={(modelId) => updateDraft("baseModel", modelId)}
            onSearchBaseModels={onSearchBaseModels}
          />

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="forge-method">
                Method
                <AcademyActionTooltip action={trainingMethodAcademyAction} label="?" />
              </label>
              <select
                id="forge-method"
                value={draft.method}
                onChange={(event) => updateDraft("method", event.target.value as TrainingMethod)}
              >
                <option value="QLoRA">QLoRA</option>
                <option value="LoRA">LoRA</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="forge-epochs">
                Epochs
              </label>
              <input
                id="forge-epochs"
                type="number"
                min={1}
                max={20}
                value={draft.epochs}
                onChange={(event) => updateDraft("epochs", Number(event.target.value))}
              />
            </div>
          </div>

          <label className="field-label" htmlFor="forge-learning-rate">
            Learning rate
          </label>
          <input
            id="forge-learning-rate"
            type="text"
            value={draft.learningRate}
            onChange={(event) => updateDraft("learningRate", event.target.value)}
            required
          />

          <label className="toggle-row" htmlFor="forge-load-4bit">
            <input
              id="forge-load-4bit"
              type="checkbox"
              checked={draft.loadIn4Bit}
              onChange={(event) => updateDraft("loadIn4Bit", event.target.checked)}
            />
            <span>
              Load base model in 4-bit
              <AcademyActionTooltip action={trainingMethodAcademyAction} label="?" />
            </span>
          </label>

          <button
            className="button-primary"
            type="submit"
            disabled={isStarting || !draft.materialSetId || selectedMaterialForgeBlocked}
          >
            <i className="fas fa-fire-flame-curved" aria-hidden="true" />
            {isStarting
              ? "Queueing"
              : draft.purpose === "evaluation"
                ? "Queue Evaluation"
                : "Queue Forge"}
          </button>

          {jsonlMaterials.length === 0 && (
            <p className="save-state">
              Export QA pairs or reviewed Trials first, then JSONL Materials will appear here.
            </p>
          )}
          {statusText && <p className="save-state success-state">{statusText}</p>}
          {error && <p className="save-state error-state">{error}</p>}
        </form>

        <div className="forge-panel panel-glass">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Forge Runtime</p>
              <h2>Trainer Adapter</h2>
            </div>
            <AcademyActionTooltip
              action={adapterBoundaryAcademyAction}
              label="Why adapter boundary?"
            />
          </div>

          <div className="construct-runtime-card">
            <strong>{forgeRuntime?.mode || "simulated"}</strong>
            <span title={forgeRuntime?.detail}>
              {forgeRuntime?.detail || "Loading Forge runtime status..."}
            </span>
            <div className="runtime-control-grid">
              <span className="status-badge">{forgeRuntime?.status || "checking"}</span>
              <span className="status-badge">{forgeRuntime?.ready ? "ready" : "not ready"}</span>
              <span className="status-badge">{forgeRuntime?.worker || "worker pending"}</span>
            </div>
            <div className="runtime-action-row">
              <select
                aria-label="Forge runtime mode"
                value={runtimeModeDraft}
                onChange={(event) => setRuntimeModeDraft(event.target.value as ForgeRuntimeMode)}
              >
                <option value="simulated">Simulator</option>
                <option value="local">Local trainer</option>
              </select>
              <button
                className="button-secondary"
                type="button"
                onClick={configureRuntime}
                disabled={isConfiguringRuntime}
              >
                <i className="fas fa-sliders" aria-hidden="true" />
                {isConfiguringRuntime ? "Configuring" : "Configure"}
              </button>
            </div>
            <div className="runtime-action-row">
              <button
                className="button-secondary"
                type="button"
                onClick={() => void runForgeSmokeProof(false)}
                disabled={smokeProofMode !== null}
              >
                <i className="fas fa-list-check" aria-hidden="true" />
                {smokeProofMode === "preflight" ? "Checking" : "Preflight Tiny Proof"}
              </button>
              <button
                className="button-primary"
                type="button"
                onClick={() => void runForgeSmokeProof(true)}
                disabled={smokeProofMode !== null}
              >
                <i className="fas fa-flask-vial" aria-hidden="true" />
                {smokeProofMode === "training" ? "Training" : "Run Tiny Forge Proof"}
              </button>
              <AcademyActionTooltip
                action={proofModeAcademyAction}
                label="Why tiny proof?"
              />
            </div>
          </div>

          {smokeProofResult && (
            <article className={`forge-smoke-card readiness-${smokeProofResult.preflight.status}`}>
              <div className="runtime-readiness-header">
                <div>
                  <p className="panel-kicker">Tiny Forge Proof</p>
                  <strong>
                    {smokeProofResult.ranTraining
                      ? "Training completed"
                      : smokeProofResult.preflight.title}
                  </strong>
                  <span>
                    {smokeProofResult.forgeRun.id} / {smokeProofResult.material.sourceUri}
                  </span>
                </div>
                <span className={`status-badge readiness-${smokeProofResult.preflight.status}`}>
                  {smokeProofResult.preflight.status}
                </span>
              </div>
              <div className="runtime-preflight-stats">
                <div>
                  <span>Model</span>
                  <strong>{smokeProofResult.preflight.model.baseModel}</strong>
                </div>
                <div>
                  <span>Rows</span>
                  <strong>
                    {Number(smokeProofResult.preflight.validation.rowCount || 0).toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span>Loss</span>
                  <strong>{smokeProofResult.workerState.metrics.loss ?? "n/a"}</strong>
                </div>
                <div>
                  <span>Artifact</span>
                  <strong>{smokeProofResult.artifact?.id || smokeProofResult.forgeRun.artifactId || "pending"}</strong>
                </div>
              </div>
              <p className="runtime-readiness-gate">
                {smokeProofResult.ranTraining
                  ? `Adapter saved at ${smokeProofResult.workerState.metrics.adapterPath || "runtime output"}.`
                  : smokeProofResult.preflight.nextAction}
              </p>
              {smokeProofResult.preflight.proofMode?.note && (
                <p className="forge-proof-note">{smokeProofResult.preflight.proofMode.note}</p>
              )}
              {smokeProofResult.blocked.length > 0 && (
                <div className="forge-proof-checks" aria-label="Blocked proof checks">
                  {smokeProofResult.blocked.map((check) => (
                    <div key={check.id}>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {smokeConstructResponse && (
                <div className="forge-smoke-response">
                  <span>{smokeConstructResponse.construct.name}</span>
                  <p>{smokeConstructResponse.message.text}</p>
                </div>
              )}
            </article>
          )}

          <AcademyActionTooltip
            action={adapterBoundaryAcademyAction}
            label="Why an adapter boundary?"
          />
        </div>

        <div className="forge-panel panel-glass">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Selected Material</p>
              <h2>Dataset Readiness</h2>
            </div>
          </div>

          {selectedMaterial ? (
            <article className="forge-material-card">
              <strong>{selectedMaterial.name}</strong>
              <span>{selectedMaterial.sourceUri}</span>
              <div className="material-meta">
                <span>{selectedMaterial.qaPairCount.toLocaleString()} QA</span>
                <span>{selectedMaterial.chunkCount.toLocaleString()} rows</span>
                <span>{selectedMaterial.status}</span>
                <span>{inferForgePurpose(selectedMaterial)}</span>
              </div>
              {selectedTrainingReadiness ? (
                <div
                  className={`forge-material-readiness readiness-${selectedTrainingReadiness.status}`}
                  aria-label="Selected Material training readiness"
                >
                  <div className="runtime-readiness-header">
                    <div>
                      <span>Training readiness</span>
                      <strong>
                        {selectedTrainingReadiness.defaultTrainingSafe
                          ? "Default training safe"
                          : selectedTrainingReadiness.forgeReady
                            ? "Forge-ready with caution"
                            : "Blocked for Forge"}
                      </strong>
                    </div>
                    <span className={`status-badge readiness-${selectedTrainingReadiness.status}`}>
                      {selectedTrainingReadiness.status}
                    </span>
                  </div>
                  <div className="runtime-preflight-stats">
                    <div>
                      <span>Rows</span>
                      <strong>{selectedTrainingReadiness.rowCount.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Passed</span>
                      <strong>{selectedTrainingReadiness.qualityPassedRows.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>Blocked</span>
                      <strong>{selectedTrainingReadiness.qualityBlockedRows.toLocaleString()}</strong>
                    </div>
                  </div>
                  <p>{selectedTrainingReadiness.recommendation}</p>
                  {(selectedTrainingReadiness.deterministicRows > 0 ||
                    selectedTrainingReadiness.fallbackRows > 0) && (
                    <p>
                      Deterministic or fallback rows are present. Keep them for smoke tests,
                      not production fine-tuning.
                    </p>
                  )}
                  {selectedTrainingReadiness.generatorModels.length > 0 && (
                    <span className="forge-readiness-models">
                      Generated by {selectedTrainingReadiness.generatorModels.join(", ")}
                    </span>
                  )}
                </div>
              ) : (
                <div className="forge-material-readiness readiness-caution">
                  <strong>Readiness metadata unavailable</strong>
                  <p>
                    Older JSONL Materials can still be used, but exporting again from Materials
                    will attach QA quality and source-reference readiness.
                  </p>
                </div>
              )}
            </article>
          ) : (
            <p className="empty-state">No training-ready JSONL Material selected.</p>
          )}

          <ConceptTooltip label="What is QLoRA?" title="QLoRA">
            QLoRA loads the base model in a quantized form while training small adapter
            weights. It lowers memory pressure so more builders can fine-tune locally.
          </ConceptTooltip>
          <AcademyActionTooltip action={trainingMethodAcademyAction} label="LoRA vs QLoRA" />
          <TrainingMetricExplainer />
        </div>
      </div>

      <section
        className={`assembly-runs panel-glass ${forgeFocusTarget === "queue" ? "is-loop-focused" : ""}`}
        aria-label="Forge queue"
        ref={forgeQueueRef}
      >
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Forge Queue</p>
            <h2>Training Jobs</h2>
          </div>
          <div className="forge-queue-actions">
            <span className={`status-badge ${hasActiveForgeRuns ? "is-forging" : ""}`}>
              {hasActiveForgeRuns ? "live monitor" : "idle"}
            </span>
            {lastWorkerSync && <span className="worker-sync-stamp">synced {lastWorkerSync}</span>}
            <span className="status-badge">{forgeRuns.length} jobs</span>
            <button
              className="button-secondary button-compact"
              type="button"
              onClick={() => void refreshForgeQueue({ silent: false })}
              disabled={isRefreshingWorkers}
            >
              <i className="fas fa-rotate" aria-hidden="true" />
              {isRefreshingWorkers ? "Syncing" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="assembly-run-list">
          {forgeRuns.length === 0 ? (
            <p className="empty-state">No Forge jobs queued yet.</p>
          ) : (
            forgeRuns.map((run) => {
              const workerState = workerStates[run.id];
              const metrics = workerState?.metrics;
              return (
                <article className="assembly-run-row forge-run-row" key={run.id}>
                  <div>
                    <strong>{run.label}</strong>
                    <span>{run.status} / {run.progress}%</span>
                    <div
                      className="forge-progress-track"
                      aria-label={`${run.label} progress`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={run.progress}
                      role="progressbar"
                    >
                      <span style={{ width: `${run.progress}%` }} />
                    </div>
                  </div>
                  <div className="material-meta">
                    <span>{run.method}</span>
                    <span>{run.purpose}</span>
                    {run.epoch && <span>Epoch {run.epoch.current} / {run.epoch.total}</span>}
                    {metrics && <span>{metrics.datasetRows.toLocaleString()} rows</span>}
                    {metrics?.lastEvent && (
                      <span>{metrics.lastEvent.split("_").join(" ")}</span>
                    )}
                    {run.materialSetId && <span>{run.materialSetId}</span>}
                    {run.artifactId && <span>Artifact {run.artifactId}</span>}
                    {run.trainingContract && (
                      <span title={run.trainingContract.outputDir}>
                        {run.trainingContract.contractVersion}
                      </span>
                    )}
                    <button
                      className="button-secondary button-compact"
                      type="button"
                      onClick={() => void loadForgeDetail(run)}
                    >
                      <i className="fas fa-magnifying-glass-chart" aria-hidden="true" />
                      Inspect
                    </button>
                    <button
                      className="button-secondary button-compact"
                      type="button"
                      disabled={
                        advancingRunId === run.id ||
                        autoCompletingRunId === run.id ||
                        run.status === "completed" ||
                        run.status === "failed"
                      }
                      onClick={() => advanceSimulation(run.id)}
                    >
                      <i className="fas fa-forward-step" aria-hidden="true" />
                      {advancingRunId === run.id ? "Advancing" : "Run Step"}
                    </button>
                    <button
                      className="button-secondary button-compact"
                      type="button"
                      disabled={
                        advancingRunId === run.id ||
                        autoCompletingRunId === run.id ||
                        run.status === "completed" ||
                        run.status === "failed"
                      }
                      onClick={() => void runSimulationToCompletion(run.id)}
                    >
                      <i className="fas fa-gauge-high" aria-hidden="true" />
                      {autoCompletingRunId === run.id ? "Running" : "Run to Complete"}
                    </button>
                    {run.status === "completed" && run.purpose === "evaluation" && (
                      <button
                        className="button-primary button-compact"
                        type="button"
                        onClick={() => void loadForgeDetail(run, { initialTab: "trial" })}
                      >
                        <i className="fas fa-scale-balanced" aria-hidden="true" />
                        View Trial Report
                      </button>
                    )}
                    {run.status === "completed" && run.purpose !== "evaluation" && (
                      <button
                        className="button-primary button-compact"
                        type="button"
                        disabled={loadingConstructRunId === run.id}
                        onClick={() => void loadForgeArtifactIntoConstruct(run)}
                      >
                        <i className="fas fa-play" aria-hidden="true" />
                        {loadingConstructRunId === run.id
                          ? "Loading"
                          : run.artifactId
                            ? "Load Construct"
                            : "Prepare Construct"}
                      </button>
                    )}
                  </div>
                  <div className="forge-event-log" aria-label={`${run.label} worker events`}>
                    {(workerState?.events || []).slice(-4).map((event) => (
                      <div className="forge-event-row" key={event.id}>
                        <span>{event.type.split("_").join(" ")}</span>
                        <p>{event.message}</p>
                      </div>
                    ))}
                    {!workerState?.events?.length && (
                      <p className="empty-state">
                        Worker events will appear after this Forge writes a contract.
                      </p>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {selectedForgeRun && (
        <div className="forge-detail-backdrop" role="presentation" onClick={closeForgeDetail}>
          <aside
            className="forge-detail-drawer panel-glass"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedForgeRun.label} Forge detail`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="forge-detail-header">
              <div>
                <p className="panel-kicker">Worker Detail</p>
                <h2>{selectedForgeRun.label}</h2>
                <span>
                  {selectedForgeRun.status} / {selectedForgeRun.progress}% / {selectedForgeRun.id}
                </span>
              </div>
              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  type="button"
                  onClick={() => void refreshForgeDetail()}
                  disabled={isLoadingForgeDetail}
                >
                  <i className="fas fa-rotate" aria-hidden="true" />
                  {isLoadingForgeDetail ? "Syncing" : "Sync"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  onClick={() => void reconcileForgeDetail()}
                  disabled={isReconcilingForgeDetail}
                >
                  <i className="fas fa-screwdriver-wrench" aria-hidden="true" />
                  {isReconcilingForgeDetail ? "Reconciling" : "Reconcile"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  onClick={() => void preflightLocalForgeWorker()}
                  disabled={localPreflightRunId === selectedForgeRun.id}
                  title="Check whether this Forge can run the local LoRA trainer"
                >
                  <i className="fas fa-list-check" aria-hidden="true" />
                  {localPreflightRunId === selectedForgeRun.id ? "Checking" : "Preflight Local"}
                </button>
                <button
                  className="button-primary button-compact"
                  type="button"
                  onClick={() => void runLocalForgeWorker()}
                  disabled={!canRunSelectedLocalTrainer || localTrainingRunId === selectedForgeRun.id}
                  title={
                    canRunSelectedLocalTrainer
                      ? "Run the local LoRA trainer from this Forge contract"
                      : "Pass local trainer preflight before running this Forge"
                  }
                >
                  <i className="fas fa-microchip" aria-hidden="true" />
                  {localTrainingRunId === selectedForgeRun.id ? "Training" : "Run Local Trainer"}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={closeForgeDetail}
                  aria-label="Close Forge detail"
                  title="Close"
                >
                  <i className="fas fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="forge-detail-tabs" role="tablist" aria-label="Forge detail views">
              {(["events", "contract", "trial", "metrics"] as ForgeDetailTab[]).map((tab) => (
                <button
                  key={tab}
                  className={forgeDetailTab === tab ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={forgeDetailTab === tab}
                  onClick={() => setForgeDetailTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {forgeDetailError && <p className="save-state error-state">{forgeDetailError}</p>}

            {selectedLocalTrainerPreflight && (
              <article
                className={`forge-preflight-card readiness-${selectedLocalTrainerPreflight.status}`}
              >
                <div className="runtime-readiness-header">
                  <div>
                    <p className="panel-kicker">Local Trainer Preflight</p>
                    <strong>{selectedLocalTrainerPreflight.title}</strong>
                    <span>{selectedLocalTrainerPreflight.summary}</span>
                  </div>
                  <span className={`status-badge readiness-${selectedLocalTrainerPreflight.status}`}>
                    {selectedLocalTrainerPreflight.status}
                  </span>
                </div>
                <div className="runtime-preflight-stats">
                  <div>
                    <span>Estimated</span>
                    <strong>
                      {formatBytes(selectedLocalTrainerPreflight.memory.estimatedLoadBytes)}
                    </strong>
                  </div>
                  <div>
                    <span>Available</span>
                    <strong>{formatBytes(selectedLocalTrainerPreflight.memory.availableBytes)}</strong>
                  </div>
                  <div>
                    <span>Rows</span>
                    <strong>
                      {Number(selectedLocalTrainerPreflight.validation.rowCount || 0).toLocaleString()}
                      {" / "}
                      {selectedLocalTrainerPreflight.limits.maxRows}
                    </strong>
                  </div>
                  <div>
                    <span>Model</span>
                    <strong>{selectedLocalTrainerPreflight.model.cached ? "cached" : "missing"}</strong>
                  </div>
                </div>
                <div className="runtime-preflight-checks">
                  {selectedLocalTrainerPreflight.checks.map((check) => (
                    <div className={`preflight-check is-${check.status}`} key={check.id}>
                      <strong>{check.label}</strong>
                      <span>{check.status}</span>
                      <p>{check.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="runtime-readiness-gate">{selectedLocalTrainerPreflight.nextAction}</p>
              </article>
            )}

            <div className="forge-detail-body">
              {forgeDetailTab === "events" && (
                <div className="forge-timeline">
                  {(selectedForgeWorkerState?.events || []).length === 0 ? (
                    <div className="forge-detail-empty">
                      <p className="empty-state">
                        No worker events have been written for this Forge yet.
                      </p>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        onClick={() => void reconcileForgeDetail()}
                        disabled={isReconcilingForgeDetail}
                      >
                        <i className="fas fa-screwdriver-wrench" aria-hidden="true" />
                        {isReconcilingForgeDetail ? "Reconciling" : "Reconcile worker files"}
                      </button>
                    </div>
                  ) : (
                    selectedForgeWorkerState?.events.map((event) => (
                      <article className="forge-timeline-event" key={event.id}>
                        <div>
                          <span>{event.type.split("_").join(" ")}</span>
                          <time dateTime={event.timestamp}>
                            {new Date(event.timestamp).toLocaleString()}
                          </time>
                        </div>
                        <p>{event.message}</p>
                        <div className="material-meta">
                          {typeof event.progress === "number" && <span>{event.progress}%</span>}
                          {event.epoch && (
                            <span>
                              Epoch {event.epoch.current} / {event.epoch.total}
                            </span>
                          )}
                          <span>{event.id}</span>
                        </div>
                        {event.data && (
                          <pre className="forge-json-block">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        )}
                      </article>
                    ))
                  )}
                </div>
              )}

              {forgeDetailTab === "contract" && (
                <pre className="forge-json-block is-large">
                  {selectedForgeContract
                    ? JSON.stringify(selectedForgeContract, null, 2)
                    : "Forge contract has not been written yet."}
                </pre>
              )}

              {forgeDetailTab === "trial" && (
                <div className="trial-report">
                  {selectedEvaluationReport ? (
                    <>
                      <section className="trial-report-hero">
                        <div>
                          <p className="panel-kicker">Trial Report</p>
                          <h3>{selectedEvaluationReport.passRate}% pass rate</h3>
                          <span>{selectedEvaluationReport.rowCount.toLocaleString()} evaluation rows</span>
                        </div>
                        <div className="trial-report-counts" aria-label="Trial report counts">
                          <span className="verdict-pass">{selectedEvaluationReport.passCount} pass</span>
                          <span className="verdict-needs-work">
                            {selectedEvaluationReport.needsWorkCount} needs work
                          </span>
                          <span className="verdict-fail">{selectedEvaluationReport.failCount} fail</span>
                        </div>
                      </section>

                      <section className="trial-rubric-grid" aria-label="Evaluation rubric">
                        {selectedEvaluationReport.rubric.map((item) => (
                          <article className="trial-rubric-card" key={item.label}>
                            <div>
                              <strong>{item.label}</strong>
                              <span>{item.score}%</span>
                            </div>
                            <div className="forge-progress-track" aria-hidden="true">
                              <span style={{ width: `${item.score}%` }} />
                            </div>
                            <p>{item.explanation}</p>
                          </article>
                        ))}
                      </section>

                      <section className="trial-sample-list" aria-label="Evaluation samples">
                        <div className="panel-heading">
                          <div>
                            <p className="panel-kicker">Samples</p>
                            <h3>Model Checks</h3>
                          </div>
                        </div>
                        {selectedEvaluationReport.samples.map((sample, index) => (
                          <article className="trial-sample-card" key={`${sample.instruction}-${index}`}>
                            <div className="trial-sample-header">
                              <strong>Sample {index + 1}</strong>
                              <span className={`verdict-${sample.verdict}`}>{sample.verdict}</span>
                            </div>
                            <dl>
                              <div>
                                <dt>Prompt</dt>
                                <dd>{sample.instruction}</dd>
                              </div>
                              <div>
                                <dt>Expected</dt>
                                <dd>{sample.expected}</dd>
                              </div>
                              <div>
                                <dt>Observed</dt>
                                <dd>{sample.observed}</dd>
                              </div>
                            </dl>
                            <p>{sample.note}</p>
                          </article>
                        ))}
                      </section>

                      <section className="trial-recommendations" aria-label="Trial recommendations">
                        <p className="panel-kicker">Next Moves</p>
                        {selectedEvaluationReport.recommendations.map((recommendation) => (
                          <div className="forge-event-row" key={recommendation}>
                            <span>recommendation</span>
                            <p>{recommendation}</p>
                          </div>
                        ))}
                      </section>
                    </>
                  ) : selectedForgeRun.purpose === "evaluation" ? (
                    <div className="forge-detail-empty">
                      <p className="empty-state">
                        Complete or reconcile this evaluation Forge to generate a Trial Report.
                      </p>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        onClick={() => void reconcileForgeDetail()}
                        disabled={isReconcilingForgeDetail}
                      >
                        <i className="fas fa-screwdriver-wrench" aria-hidden="true" />
                        {isReconcilingForgeDetail ? "Reconciling" : "Reconcile report"}
                      </button>
                    </div>
                  ) : (
                    <p className="empty-state">Training Forges create Artifacts; evaluation Forges create Trial Reports.</p>
                  )}
                </div>
              )}

              {forgeDetailTab === "metrics" && (
                <pre className="forge-json-block is-large">
                  {selectedForgeWorkerState?.metrics
                    ? JSON.stringify(selectedForgeWorkerState.metrics, null, 2)
                    : "Forge metrics have not been written yet."}
                </pre>
              )}
            </div>
          </aside>
        </div>
      )}

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={academyAction}
        onAction={onOpenAcademy}
      />
      <LearningCard
        title="Choose the adapter strategy"
        body="LoRA and QLoRA both train compact adapters, but QLoRA lowers memory pressure by keeping the base model quantized during training."
        academyAction={trainingMethodAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.forgeTrainingMethod)}
      />
      <LearningCard
        title="The Forge contract is the boundary"
        body="Simulator runs, tiny proof runs, and the real trainer all use the same contract so the handoff from JSONL Material to Artifact stays inspectable."
        academyAction={adapterBoundaryAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.forgeAdapterBoundary)}
      />
      <LearningCard
        title="Tiny proof keeps training honest"
        body="Tiny proof validates the local LoRA path with a cached small model and tiny Material before anyone spends time on a longer Forge."
        academyAction={proofModeAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.forgeProofMode)}
      />
      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="Why this Forge lesson?" />
      </div>
    </section>
  );
};

export default ForgeWorkbench;
