import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StartForgeRequest } from "../contracts/foundryApi";
import {
  AcademyAction,
  Artifact,
  Construct,
  ForgeRun,
  ForgePurpose,
  ForgeRuntime,
  ForgeRuntimeMode,
  ForgeTrainingContract,
  ForgeWorkerState,
  MaterialSource,
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

const FORGE_WORKER_POLL_MS = 3000;

type ForgeDetailTab = "events" | "contract" | "trial" | "metrics";

const inferForgePurpose = (material?: MaterialSource): ForgePurpose => {
  if (!material) {
    return "training";
  }
  const marker = `${material.name} ${material.sourceUri}`.toLowerCase();
  return marker.includes("trial") || marker.includes("-trials-") ? "evaluation" : "training";
};

interface ForgeWorkbenchProps {
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  summary: SectionSummary;
  workshop: Workshop;
  forgePreset?: StartForgeRequest | null;
  academyAction?: AcademyAction;
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onOpenAcademy: () => void;
}

const ForgeWorkbench: React.FC<ForgeWorkbenchProps> = ({
  repository,
  settings,
  summary,
  workshop,
  forgePreset,
  academyAction,
  onConstructLoaded,
  onOpenAcademy,
}) => {
  const [materials, setMaterials] = useState<MaterialSource[]>([]);
  const [forgeRuns, setForgeRuns] = useState<ForgeRun[]>([]);
  const [workerStates, setWorkerStates] = useState<Record<string, ForgeWorkerState>>({});
  const [draft, setDraft] = useState<StartForgeRequest>({
    materialSetId: "",
    baseModel: settings.modelName,
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
  const [isReconcilingForgeDetail, setIsReconcilingForgeDetail] = useState(false);
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
            baseModel: settings.modelName,
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
    forgePreset,
    settings.epochs,
    settings.learningRate,
    settings.loadIn4Bit,
    settings.modelName,
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

  const selectedForgeRun = useMemo(
    () => forgeRuns.find((run) => run.id === selectedForgeDetailId) || null,
    [forgeRuns, selectedForgeDetailId]
  );

  const selectedForgeWorkerState = selectedForgeDetailId
    ? workerStates[selectedForgeDetailId]
    : undefined;
  const selectedEvaluationReport = selectedForgeWorkerState?.metrics.evaluationReport;

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
      setStatusText(`${artifact.name} loaded into ${construct.name}.`);
      onConstructLoaded(construct, artifact);
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

      <div className="forge-layout">
        <form className="forge-panel panel-glass" onSubmit={startForge}>
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
          <input
            id="forge-base-model"
            type="text"
            value={draft.baseModel}
            onChange={(event) => updateDraft("baseModel", event.target.value)}
            required
          />

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="forge-method">
                Method
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
            <span>Load base model in 4-bit</span>
          </label>

          <button
            className="button-primary"
            type="submit"
            disabled={isStarting || !draft.materialSetId}
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
          </div>

          <ConceptTooltip label="Why an adapter boundary?" title="Forge Runtime">
            The Forge screen creates a training contract first. The simulator can
            advance it today, while the local trainer adapter will later execute
            the same contract with LoRA or QLoRA workers.
          </ConceptTooltip>
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
            </article>
          ) : (
            <p className="empty-state">No training-ready JSONL Material selected.</p>
          )}

          <ConceptTooltip label="What is QLoRA?" title="QLoRA">
            QLoRA loads the base model in a quantized form while training small adapter
            weights. It lowers memory pressure so more builders can fine-tune locally.
          </ConceptTooltip>
          <TrainingMetricExplainer />
        </div>
      </div>

      <section className="assembly-runs panel-glass" aria-label="Forge queue">
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
      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="Why this Forge lesson?" />
      </div>
    </section>
  );
};

export default ForgeWorkbench;
