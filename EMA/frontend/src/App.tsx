import React, { useCallback, useEffect, useMemo, useState } from "react";
import AcademyWorkbench from "./components/AcademyWorkbench";
import ArtifactsWorkbench from "./components/ArtifactsWorkbench";
import ConstructWorkbench from "./components/ConstructWorkbench";
import Dashboard from "./components/Dashboard";
import ForgeWorkbench from "./components/ForgeWorkbench";
import FoundryLogo from "./components/FoundryLogo";
import HeaderWorkshopMenu from "./components/HeaderWorkshopMenu";
import { LearningCard, LayerVisualizer, TokenPreview } from "./components/LearningComponents";
import MaterialsWorkbench from "./components/MaterialsWorkbench";
import Metrics from "./components/Metrics";
import SettingsPanel, { WorkspaceSettings } from "./components/SettingsOverlay";
import TrialsWorkbench from "./components/TrialsWorkbench";
import WorkshopCreateModal from "./components/WorkshopCreateModal";
import WorkshopDeleteModal from "./components/WorkshopDeleteModal";
import WorkshopSwitcher from "./components/WorkshopSwitcher";
import { CreateWorkshopRequest, StartForgeRequest } from "./contracts/foundryApi";
import {
  ACADEMY_ACTION_IDS,
  defaultAcademyActions,
  findAcademyAction,
} from "./domain/academyRegistry";
import {
  ArtifactEvidenceAction,
  ArtifactEvidenceSummary,
  buildArtifactEvidenceSummary,
} from "./domain/artifactEvidence";
import {
  ArchiveModelHandoff,
  Artifact,
  Construct,
  ConstructModelHandoff,
  ConstructRuntime,
  FoundryLoopFocus,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  ModelDownloadJob,
  NavigationSection,
  RuntimeMetric,
  Workshop,
  resolveDefaultBaseModel,
} from "./domain/foundry";
import {
  defaultWorkspaceSettings,
  foundryNavigationItems,
  foundrySectionSummaries,
  mockDashboardSummary,
} from "./mocks/foundryMockData";
import {
  FoundryBootstrap,
  getFoundryRepository,
  loadFoundryBootstrap,
} from "./services/foundryRepository";
import {
  ModelPreparationActivity,
  SystemReadinessModelAction,
} from "./domain/systemReadiness";
import { getRuntimeMemory } from "./domain/runtimeState";
import "./App.css";

const loadWorkspaceSettings = (): WorkspaceSettings => {
  const savedSettings = window.localStorage.getItem("foundry.workspaceSettings");
  if (!savedSettings) {
    return defaultWorkspaceSettings;
  }

  try {
    const parsedSettings = JSON.parse(savedSettings) as Partial<WorkspaceSettings>;
    const migratedSettings = { ...defaultWorkspaceSettings, ...parsedSettings };
    return {
      ...migratedSettings,
      defaultBaseModel:
        parsedSettings.defaultBaseModel ||
        parsedSettings.modelName ||
        defaultWorkspaceSettings.defaultBaseModel,
    };
  } catch {
    return defaultWorkspaceSettings;
  }
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const wait = (durationMs: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

const RUNTIME_INSPECTOR_STORAGE_KEY = "foundry.runtimeInspector.open";

const loadRuntimeInspectorOpen = () => {
  const savedPreference = window.localStorage.getItem(RUNTIME_INSPECTOR_STORAGE_KEY);
  if (savedPreference !== null) {
    return savedPreference === "true";
  }
  return window.innerWidth >= 1280;
};

const isActiveModelDownloadJob = (job: ModelDownloadJob) =>
  job.status === "queued" || job.status === "running";

const modelDownloadJobToActivity = (job: ModelDownloadJob): ModelPreparationActivity => {
  if (job.status === "completed") {
    return {
      state: "ready",
      label: "Model cached",
      detail: job.detail,
      progress: 100,
      jobId: job.id,
    };
  }
  if (job.status === "failed") {
    return {
      state: "failed",
      label: "Download failed",
      detail: job.error || job.detail,
      progress: 100,
      jobId: job.id,
    };
  }
  if (job.status === "canceled") {
    return {
      state: "canceled",
      label: "Download canceled",
      detail: job.detail,
      progress: 100,
      jobId: job.id,
    };
  }
  return {
    state: job.phase === "cataloging" ? "handoff" : "downloading",
    label:
      job.phase === "queued"
        ? "Download queued"
        : job.phase === "inspecting"
          ? "Inspecting model"
          : job.phase === "cataloging"
            ? "Cataloging model"
            : "Downloading model",
    detail: job.detail,
    progress: job.progress,
    jobId: job.id,
  };
};

const deriveRuntimeMetrics = (
  baselineMetrics: RuntimeMetric[],
  runtime: ConstructRuntime | null,
  contextWindow: number
): RuntimeMetric[] => {
  const diagnostics = runtime?.diagnostics || {};
  const memory = getRuntimeMemory(runtime);
  const isLoaded = Boolean(runtime?.loaded);
  const isMps = runtime?.device === "mps" || diagnostics.mpsAvailable === true;
  const isCuda = runtime?.device === "cuda" || diagnostics.cudaAvailable === true;

  return baselineMetrics.map((metric) => {
    if (metric.id === "memory" && typeof memory?.percentUsed === "number") {
      return {
        ...metric,
        value: clampPercent(memory.percentUsed),
        state: memory.percentUsed > (metric.ideal || 80) ? "warning" : isLoaded ? "active" : "ready",
        description:
          memory.totalGb && memory.availableGb
            ? `${memory.availableGb}GB available of ${memory.totalGb}GB system memory.`
            : metric.description,
      };
    }

    if (metric.id === "gpu") {
      const acceleratorReady = isMps || isCuda;
      return {
        ...metric,
        value: isLoaded && acceleratorReady ? 36 : acceleratorReady ? 6 : 0,
        state: isLoaded && acceleratorReady ? "active" : "idle",
        description: acceleratorReady
          ? `${runtime?.device || "Accelerator"} is available for local model inference.`
          : "No GPU/MPS accelerator is reported by the runtime.",
      };
    }

    if (metric.id === "gpu-memory") {
      return {
        ...metric,
        value: isLoaded && typeof memory.percentUsed === "number"
          ? clampPercent(memory.percentUsed)
          : isLoaded
          ? 42
          : isMps || isCuda
          ? 10
          : 0,
        state: isLoaded ? "active" : "idle",
        description: isLoaded
          ? `Loaded model ${runtime?.modelId || "unknown"} on ${runtime?.device || "runtime device"}.`
          : metric.description,
      };
    }

    if (metric.id === "context") {
      return {
        ...metric,
        value: clampPercent(Math.min(18, (512 / Math.max(1, contextWindow)) * 100)),
        state: isLoaded ? "ready" : "idle",
      };
    }

    if (metric.id === "cpu") {
      return {
        ...metric,
        value: isLoaded ? Math.max(metric.value, 22) : metric.value,
        state: isLoaded ? "ready" : metric.state,
      };
    }

    return metric;
  });
};

const App: React.FC = () => {
  const repository = useMemo(() => getFoundryRepository(), []);
  const [activeSection, setActiveSection] = useState<NavigationSection>("workshop");
  const [loopFocus, setLoopFocus] = useState<FoundryLoopFocus | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings>(loadWorkspaceSettings);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [modelPreparationActivity, setModelPreparationActivity] =
    useState<ModelPreparationActivity>({
      state: "idle",
      label: "Idle",
      detail: "No model preparation is running.",
      progress: 0,
    });
  const [activeModelDownloadJobId, setActiveModelDownloadJobId] = useState<string | null>(null);
  const [isWorkshopModalOpen, setIsWorkshopModalOpen] = useState(false);
  const [isCreatingWorkshop, setIsCreatingWorkshop] = useState(false);
  const [workshopPendingDeletion, setWorkshopPendingDeletion] = useState<Workshop | null>(null);
  const [deleteWorkshopError, setDeleteWorkshopError] = useState<string | null>(null);
  const [isDeletingWorkshop, setIsDeletingWorkshop] = useState(false);
  const [forgePreset, setForgePreset] = useState<StartForgeRequest | null>(null);
  const [academyFocusConceptId, setAcademyFocusConceptId] = useState<string | null>(null);
  const [archiveHandoff, setArchiveHandoff] = useState<ArchiveModelHandoff | null>(null);
  const [materialsArchiveHandoff, setMaterialsArchiveHandoff] =
    useState<ArchiveModelHandoff | null>(null);
  const [constructHandoff, setConstructHandoff] = useState<ConstructModelHandoff | null>(null);
  const [constructRuntime, setConstructRuntime] = useState<ConstructRuntime | null>(null);
  const [foundryStatus, setFoundryStatus] = useState<FoundryRuntimeStatus | null>(null);
  const [archiveEntries, setArchiveEntries] = useState<ModelArchiveEntry[]>([]);
  const [activeArtifactEvidenceSummary, setActiveArtifactEvidenceSummary] =
    useState<ArtifactEvidenceSummary | null>(null);
  const [loopEvidenceRefreshCount, setLoopEvidenceRefreshCount] = useState(0);
  const [isRuntimeInspectorOpen, setIsRuntimeInspectorOpen] = useState(loadRuntimeInspectorOpen);
  const [workshops, setWorkshops] = useState<Workshop[]>([mockDashboardSummary.workshop]);
  const [foundryData, setFoundryData] = useState<FoundryBootstrap>({
    dashboard: mockDashboardSummary,
    academyActions: [],
    navigationItems: [],
    sectionSummaries: foundrySectionSummaries,
    uiCatalog: [],
  });

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      loadFoundryBootstrap(repository),
      repository.listWorkshops(),
      repository.getConstructRuntime(),
      repository.getFoundryStatus(),
      repository.listModelArchiveEntries(),
      repository.listModelDownloadJobs(),
    ])
      .then(([bootstrap, savedWorkshops, runtime, status, modelArchiveEntries, modelDownloadJobs]) => {
        if (isCurrent) {
          setFoundryData(bootstrap);
          setWorkshops(savedWorkshops.length ? savedWorkshops : [bootstrap.dashboard.workshop]);
          setConstructRuntime(runtime);
          setFoundryStatus(status);
          setArchiveEntries(modelArchiveEntries);
          const activeJob = modelDownloadJobs.find(isActiveModelDownloadJob) || modelDownloadJobs[0];
          if (activeJob) {
            setModelPreparationActivity(modelDownloadJobToActivity(activeJob));
            setActiveModelDownloadJobId(isActiveModelDownloadJob(activeJob) ? activeJob.id : null);
          }
        }
      })
      .catch((error: unknown) => {
        console.error("[Foundry Bootstrap]", error);
      });

    return () => {
      isCurrent = false;
    };
  }, [repository]);

  const persistSettings = (nextSettings: WorkspaceSettings) => {
    setSettings(nextSettings);
    window.localStorage.setItem("foundry.workspaceSettings", JSON.stringify(nextSettings));
  };

  const setRuntimeInspectorOpen = (isOpen: boolean) => {
    setIsRuntimeInspectorOpen(isOpen);
    window.localStorage.setItem(RUNTIME_INSPECTOR_STORAGE_KEY, String(isOpen));
  };

  const upsertArchiveEntry = useCallback((entry: ModelArchiveEntry) => {
    setArchiveEntries((current) => {
      const withoutDuplicate = current.filter(
        (candidate) =>
          !(candidate.repoId === entry.repoId && candidate.revision === entry.revision)
      );
      return [entry, ...withoutDuplicate];
    });
  }, []);

  const refreshDashboardLoopEvidence = useCallback(async (workshopId?: string) => {
    const targetWorkshopId = workshopId || foundryData.dashboard.workshop.id;
    setLoopEvidenceRefreshCount((current) => current + 1);
    try {
      const activeArtifactId = foundryData.dashboard.currentArtifact.id;
      const [loopEvidence, artifactEvidence] = await Promise.all([
        repository.getDashboardEvidence(targetWorkshopId),
        repository.getArtifactEvidence(activeArtifactId),
      ]);
      setFoundryData((current) => ({
        ...current,
        dashboard: {
          ...current.dashboard,
          loopEvidence:
            current.dashboard.workshop.id === targetWorkshopId
              ? loopEvidence
              : current.dashboard.loopEvidence,
        },
      }));
      if (foundryData.dashboard.workshop.id === targetWorkshopId) {
        setActiveArtifactEvidenceSummary(artifactEvidence);
      }
      return loopEvidence;
    } finally {
      setLoopEvidenceRefreshCount((current) => Math.max(0, current - 1));
    }
  }, [foundryData.dashboard.currentArtifact.id, foundryData.dashboard.workshop.id, repository]);

  const refreshFoundryData = async () => {
    const [bootstrap, savedWorkshops, status, modelArchiveEntries] = await Promise.all([
      loadFoundryBootstrap(repository),
      repository.listWorkshops(),
      repository.getFoundryStatus(),
      repository.listModelArchiveEntries(),
    ]);
    setFoundryData(bootstrap);
    setWorkshops(savedWorkshops.length ? savedWorkshops : [bootstrap.dashboard.workshop]);
    setFoundryStatus(status);
    setArchiveEntries(modelArchiveEntries);
    return bootstrap;
  };

  const refreshFoundryStatus = useCallback(async () => {
    const status = await repository.getFoundryStatus();
    setFoundryStatus(status);
    return status;
  }, [repository]);

  const handleConstructRuntimeChanged = useCallback((runtime: ConstructRuntime) => {
    setConstructRuntime(runtime);
    void refreshFoundryStatus();
  }, [refreshFoundryStatus]);

  const refreshActiveLoopEvidence = useCallback(() => {
    void refreshDashboardLoopEvidence().catch((error: unknown) => {
      console.error("[Foundry Dashboard Evidence]", error);
    });
  }, [refreshDashboardLoopEvidence]);

  useEffect(() => {
    if (activeSection !== "workshop") {
      return;
    }
    void refreshDashboardLoopEvidence().catch((error: unknown) => {
      console.error("[Foundry Dashboard Evidence]", error);
    });
  }, [activeSection, refreshDashboardLoopEvidence]);

  const handleArchiveEntriesChanged = useCallback((entries: ModelArchiveEntry[]) => {
    setArchiveEntries(entries);
  }, []);

  const updateModelPreparation = (activity: ModelPreparationActivity) => {
    setModelPreparationActivity(activity);
  };

  useEffect(() => {
    if (!activeModelDownloadJobId) {
      return undefined;
    }

    let isCurrent = true;

    const pollActiveDownloadJob = async () => {
      try {
        let job = await repository.getModelDownloadJob(activeModelDownloadJobId);
        while (isCurrent && isActiveModelDownloadJob(job)) {
          updateModelPreparation(modelDownloadJobToActivity(job));
          await wait(1200);
          job = await repository.getModelDownloadJob(activeModelDownloadJobId);
        }
        if (!isCurrent) {
          return;
        }
        updateModelPreparation(modelDownloadJobToActivity(job));
        if (job.archiveEntry) {
          upsertArchiveEntry(job.archiveEntry);
          const shouldReturnToMaterials =
            archiveHandoff?.source === "materials" &&
            archiveHandoff.purpose === "qa-generator" &&
            archiveHandoff.returnTo === "materials" &&
            job.repoId === archiveHandoff.modelId &&
            (!archiveHandoff.revision || job.revision === archiveHandoff.revision);

          if (shouldReturnToMaterials) {
            setMaterialsArchiveHandoff({
              ...archiveHandoff,
              revision: job.archiveEntry.revision,
              requestedAt: Date.now(),
            });
            setArchiveHandoff(null);
            setActiveSection("materials");
            setStatusToast(
              `${job.archiveEntry.repoId} cached. Returning to Materials for QA generator preflight.`
            );
          } else {
            setStatusToast(`${job.archiveEntry.repoId} cached in Archive.`);
          }
        }
        setActiveModelDownloadJobId(null);
      } catch (error: unknown) {
        if (!isCurrent) {
          return;
        }
        updateModelPreparation({
          state: "failed",
          label: "Download status unavailable",
          detail: error instanceof Error ? error.message : "Could not refresh model download job.",
          progress: 100,
          jobId: activeModelDownloadJobId,
        });
        setActiveModelDownloadJobId(null);
      }
    };

    void pollActiveDownloadJob();

    return () => {
      isCurrent = false;
    };
  }, [activeModelDownloadJobId, archiveHandoff, repository, upsertArchiveEntry]);

  const handleCancelPreparation = async () => {
    if (!activeModelDownloadJobId) {
      return;
    }
    try {
      const job = await repository.cancelModelDownloadJob(activeModelDownloadJobId);
      updateModelPreparation(modelDownloadJobToActivity(job));
      setActiveModelDownloadJobId(null);
      setStatusToast(`${job.repoId} download canceled.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not cancel model download.";
      updateModelPreparation({
        state: "failed",
        label: "Cancel failed",
        detail: message,
        progress: 100,
        jobId: activeModelDownloadJobId,
      });
      setCreateError(message);
    }
  };

  const handleClearMockArchiveState = async () => {
    const result = await repository.clearMockArchiveState();
    setArchiveEntries(result.archiveEntries);
    setActiveModelDownloadJobId(null);
    updateModelPreparation({
      state: "idle",
      label: "Idle",
      detail: "Mock Archive cache and jobs were cleared.",
      progress: 0,
    });
    setStatusToast("Mock Archive cache and jobs cleared.");
  };

  const handleTestHuggingFaceAuth = async (
    authSettings: Pick<WorkspaceSettings, "huggingFaceUsername" | "huggingFaceToken">
  ) =>
    repository.testHuggingFaceAuth({
      username: authSettings.huggingFaceUsername || undefined,
      token: authSettings.huggingFaceToken || undefined,
    });

  const handlePrepareModel = async (action: SystemReadinessModelAction) => {
    setCreateError(null);
    setStatusToast(null);

    if (action.type === "ready") {
      updateModelPreparation({
        state: "ready",
        label: "Model ready",
        detail: action.detail,
        progress: 100,
      });
      setStatusToast(action.detail);
      return;
    }

    if (action.type === "open-construct") {
      updateModelPreparation({
        state: "handoff",
        label: "Opening Construct",
        detail: action.detail,
        progress: 82,
      });
      handleOpenConstructWithModel(action.modelId, action.modelLabel);
      updateModelPreparation({
        state: "ready",
        label: "Construct handoff ready",
        detail: `${action.modelLabel || action.modelId} is queued for Construct preflight.`,
        progress: 100,
      });
      return;
    }

    if (action.type === "download-model") {
      try {
        updateModelPreparation({
          state: "downloading",
          label: "Starting download",
          detail: `${action.modelId} is being queued in the Archive.`,
          progress: 8,
        });
        const downloadJob = await repository.startModelDownloadJob({
          repoId: action.modelId,
          revision: action.revision,
          username: settings.huggingFaceUsername || undefined,
          token: settings.huggingFaceToken || undefined,
        });
        updateModelPreparation({
          state: "downloading",
          label: downloadJob.phase === "queued" ? "Download queued" : "Downloading model",
          detail: downloadJob.detail,
          progress: downloadJob.progress,
          jobId: downloadJob.id,
        });
        setActiveModelDownloadJobId(downloadJob.id);
        setStatusToast(`${downloadJob.repoId} download started.`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Could not download model.";
        updateModelPreparation({
          state: "failed",
          label: "Download failed",
          detail: message,
          progress: 100,
        });
        setCreateError(message);
        setActiveSection("artifacts");
      }
      return;
    }

    updateModelPreparation({
      state: "routing",
      label: "Opening Archive",
      detail:
        action.type === "select-model"
          ? "Choose a model in Archive to continue preparation."
          : `${action.modelId} needs Archive registration before download.`,
      progress: 20,
    });
    setActiveSection("artifacts");
    setStatusToast(
      action.type === "select-model"
        ? "Open Archive and choose a model to prepare."
        : `${action.modelId} needs to be registered in Archive.`
    );
  };

  const openWorkshopModal = () => {
    setCreateError(null);
    setIsWorkshopModalOpen(true);
  };

  const closeWorkshopModal = () => {
    if (!isCreatingWorkshop) {
      setIsWorkshopModalOpen(false);
    }
  };

  const handleCreateWorkshop = async (request: CreateWorkshopRequest) => {
    setIsCreatingWorkshop(true);
    setCreateError(null);

    try {
      const createdWorkshop = await repository.createWorkshop(request);
      const bootstrap = await refreshFoundryData();
      const dashboardWorkshop =
        bootstrap.dashboard.workshop.id === createdWorkshop.id
          ? bootstrap.dashboard.workshop
          : createdWorkshop;

      setFoundryData((current) => ({
        ...current,
        dashboard: {
          ...current.dashboard,
          workshop: dashboardWorkshop,
        },
      }));
      setWorkshops((current) => {
        const withoutDuplicate = current.filter((workshop) => workshop.id !== createdWorkshop.id);
        return [createdWorkshop, ...withoutDuplicate];
      });
      persistSettings({
        ...settings,
        subjectMatter: createdWorkshop.subject,
        characterVoice: createdWorkshop.voiceTarget,
      });
      setActiveSection("materials");
      setIsWorkshopModalOpen(false);
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "Could not create Workshop.");
    } finally {
      setIsCreatingWorkshop(false);
    }
  };

  const applyActiveWorkshop = (workshop: Workshop) => {
    setFoundryData((current) => ({
      ...current,
      dashboard: {
        ...current.dashboard,
        workshop,
      },
    }));
    persistSettings({
      ...settings,
      subjectMatter: workshop.subject,
      characterVoice: workshop.voiceTarget,
    });
    setActiveSection("workshop");
  };

  const handleSelectWorkshop = (workshop: Workshop) => {
    applyActiveWorkshop(workshop);
  };

  const handleRequestDeleteWorkshop = (workshop: Workshop) => {
    setDeleteWorkshopError(null);
    setWorkshopPendingDeletion(workshop);
  };

  const handleCloseDeleteWorkshop = () => {
    if (!isDeletingWorkshop) {
      setWorkshopPendingDeletion(null);
      setDeleteWorkshopError(null);
    }
  };

  const handleDeleteWorkshop = async (confirmationName: string) => {
    if (!workshopPendingDeletion) {
      return;
    }
    setIsDeletingWorkshop(true);
    setDeleteWorkshopError(null);

    try {
      const result = await repository.deleteWorkshop(workshopPendingDeletion.id, {
        confirmationName,
      });
      const remainingWorkshops = await repository.listWorkshops();
      setWorkshops(remainingWorkshops);

      const nextWorkshop =
        result.nextWorkshop ||
        remainingWorkshops.find((workshop) => workshop.id !== result.deletedWorkshopId) ||
        remainingWorkshops[0];

      if (nextWorkshop) {
        applyActiveWorkshop(nextWorkshop);
      }
      setStatusToast(
        `Deleted ${result.deletedWorkshopName}. ${result.deletedCounts.workshops || 1} Workshop removed.`
      );
      setWorkshopPendingDeletion(null);
    } catch (error: unknown) {
      setDeleteWorkshopError(
        error instanceof Error ? error.message : "Could not delete this Workshop."
      );
    } finally {
      setIsDeletingWorkshop(false);
    }
  };

  const handleConstructLoaded = (construct: Construct, artifact: Artifact) => {
    repository
      .getConstructRuntime()
      .then(setConstructRuntime)
      .catch((error: unknown) => console.error("[Construct Runtime]", error));
    setFoundryData((current) => ({
      ...current,
      dashboard: {
        ...current.dashboard,
        construct,
        currentArtifact: artifact,
        workshop: {
          ...current.dashboard.workshop,
          activeArtifactId: artifact.id,
          activeConstructId: construct.id,
          status: "ready",
        },
      },
    }));
    refreshActiveLoopEvidence();
    setActiveSection("construct");
  };

  const handleOpenForgePreset = (preset: StartForgeRequest) => {
    setForgePreset(preset);
    setActiveSection("forge");
  };

  const handleOpenArchiveWithModel = (modelId: string, label?: string) => {
    setArchiveHandoff({
      modelId,
      label,
      source: "materials",
      purpose: label === "QA Generator" ? "qa-generator" : "base-model",
      returnTo: label === "QA Generator" ? "materials" : undefined,
      requestedAt: Date.now(),
      preflightOnOpen: true,
    });
    setActiveSection("artifacts");
    setStatusToast(`${label || modelId} needs Archive cache before model-backed QA generation.`);
  };

  const handleArchiveDownloadJobStarted = (job: ModelDownloadJob) => {
    updateModelPreparation(modelDownloadJobToActivity(job));
    const isActiveJob = isActiveModelDownloadJob(job);
    setActiveModelDownloadJobId(isActiveJob ? job.id : null);
    if (!isActiveJob && job.archiveEntry) {
      upsertArchiveEntry(job.archiveEntry);
      const shouldReturnToMaterials =
        archiveHandoff?.source === "materials" &&
        archiveHandoff.purpose === "qa-generator" &&
        archiveHandoff.returnTo === "materials" &&
        job.repoId === archiveHandoff.modelId &&
        (!archiveHandoff.revision || job.revision === archiveHandoff.revision);

      if (shouldReturnToMaterials) {
        setMaterialsArchiveHandoff({
          ...archiveHandoff,
          revision: job.archiveEntry.revision,
          requestedAt: Date.now(),
        });
        setArchiveHandoff(null);
        setActiveSection("materials");
        setStatusToast(
          `${job.archiveEntry.repoId} cached. Returning to Materials for QA generator preflight.`
        );
        return;
      }
    }
    setStatusToast(`${job.repoId} added to Archive Jobs.`);
  };

  const handleReturnToMaterialsWithModel = (handoff: ArchiveModelHandoff) => {
    setMaterialsArchiveHandoff({
      ...handoff,
      returnTo: "materials",
      requestedAt: Date.now(),
    });
    setArchiveHandoff(null);
    setActiveSection("materials");
    setStatusToast(`${handoff.modelId} returned to Materials for QA generator preflight.`);
  };

  const handleBaseModelSelected = (modelId: string) => {
    persistSettings({
      ...settings,
      defaultBaseModel: modelId,
      modelName: modelId,
      constructModelId: modelId,
    });
  };

  const handleOpenConstructWithModel = (modelId: string, label?: string) => {
    persistSettings({
      ...settings,
      defaultBaseModel: modelId,
      modelName: modelId,
      constructModelId: modelId,
    });
    setConstructHandoff({
      modelId,
      label,
      source: "archive",
      requestedAt: Date.now(),
      preflightOnOpen: true,
    });
    setActiveSection("construct");
  };

  const handleOpenAcademy = (conceptId?: string) => {
    setAcademyFocusConceptId(conceptId ?? null);
    setActiveSection("academy");
  };

  const academyActions = foundryData.academyActions.length
    ? foundryData.academyActions
    : defaultAcademyActions;

  const getAcademyAction = (actionId: string) => findAcademyAction(academyActions, actionId);

  const handleOpenAcademyAction = (actionId: string) => {
    const action = getAcademyAction(actionId);
    handleOpenAcademy(action?.conceptId);
  };

  const navigationItems = foundryData.navigationItems.length
    ? foundryData.navigationItems
    : foundryNavigationItems;
  const defaultBaseModel = resolveDefaultBaseModel(settings);

  const activeArtifact = useMemo(
    () => ({
      ...mockDashboardSummary.currentArtifact,
      ...foundryData.dashboard.currentArtifact,
      baseModel: foundryData.dashboard.currentArtifact.baseModel || defaultBaseModel,
      name: foundryData.dashboard.currentArtifact.name || `${settings.characterVoice} Model`,
      trainingMethod: foundryData.dashboard.currentArtifact.trainingMethod || settings.trainingMethod,
    }),
    [
      foundryData.dashboard.currentArtifact,
      defaultBaseModel,
      settings.characterVoice,
      settings.trainingMethod,
    ]
  );

  const activeConstruct = useMemo(
    () => ({
      ...mockDashboardSummary.construct,
      ...foundryData.dashboard.construct,
      contextWindow: settings.contextWindow,
      maxNewTokens: settings.maxNewTokens,
      streamingEnabled: settings.enableStreaming,
      temperature: settings.temperature,
    }),
    [
      foundryData.dashboard.construct,
      settings.contextWindow,
      settings.enableStreaming,
      settings.maxNewTokens,
      settings.temperature,
    ]
  );

  const dashboardSummary = useMemo(
    () => ({
      ...mockDashboardSummary,
      ...foundryData.dashboard,
      workshop: foundryData.dashboard.workshop,
      currentArtifact: activeArtifact,
      construct: activeConstruct,
    }),
    [activeArtifact, activeConstruct, foundryData.dashboard]
  );
  const activeArtifactEvidence = useMemo<ArtifactEvidenceSummary>(
    () =>
      activeArtifactEvidenceSummary?.artifactId === activeArtifact.id
        ? activeArtifactEvidenceSummary
        : buildArtifactEvidenceSummary(activeArtifact, []),
    [activeArtifact, activeArtifactEvidenceSummary]
  );
  const isLoopEvidenceRefreshing = loopEvidenceRefreshCount > 0;

  const activeNavLabel = useMemo(
    () => navigationItems.find((item) => item.id === activeSection)?.label ?? "Workshop",
    [activeSection, navigationItems]
  );

  const handleOpenLoopFocus = useCallback((focus: FoundryLoopFocus) => {
    setLoopFocus(focus);
    setActiveSection(focus.section);
  }, []);

  const handleOpenTrialComparison = useCallback((targetPrompt?: string) => {
    setLoopFocus({
      id: "construct-prompt-comparison",
      section: "trials",
      stepLabel: "Construct -> Trial",
      title: "Compare prompt variants",
      detail:
        "Review repeated user prompts with different system prompts, Library context, runtime modes, or Artifacts.",
      actionLabel: "Review comparison",
      targetLabel: "Prompt comparison",
      targetPrompt,
      requestedAt: Date.now(),
    });
    refreshActiveLoopEvidence();
    setActiveSection("trials");
  }, [refreshActiveLoopEvidence]);

  const handleArtifactEvidenceAction = useCallback((action: ArtifactEvidenceAction) => {
    setLoopFocus({
      ...action.focus,
      requestedAt: Date.now(),
    });
    refreshActiveLoopEvidence();
    setActiveSection(action.destination);
  }, [refreshActiveLoopEvidence]);

  const handleClearLoopFocus = useCallback(() => {
    setLoopFocus(null);
  }, []);

  const renderMain = () => {
    if (activeSection === "settings") {
      return (
        <SettingsPanel
          settings={settings}
          sourceStatus={foundryStatus}
          runtime={constructRuntime}
          archiveEntries={archiveEntries}
          preparationActivity={modelPreparationActivity}
          onPrepareModel={handlePrepareModel}
          onCancelPreparation={handleCancelPreparation}
          onClearMockArchiveState={handleClearMockArchiveState}
          onTestHuggingFaceAuth={handleTestHuggingFaceAuth}
          onSave={persistSettings}
        />
      );
    }

    if (activeSection === "construct") {
      return (
        <ConstructWorkbench
          academyActions={academyActions}
          artifact={activeArtifact}
          construct={activeConstruct}
          handoff={constructHandoff}
          repository={repository}
          settings={settings}
          sourceStatus={foundryStatus}
          archiveEntries={archiveEntries}
          preparationActivity={modelPreparationActivity}
          onPrepareModel={handlePrepareModel}
          onCancelPreparation={handleCancelPreparation}
          onOpenAcademyAction={handleOpenAcademyAction}
          onRuntimeChanged={handleConstructRuntimeChanged}
          onLoopEvidenceRefresh={refreshActiveLoopEvidence}
          onOpenTrialComparison={handleOpenTrialComparison}
          onArtifactEvidenceAction={handleArtifactEvidenceAction}
          loopFocus={loopFocus}
        />
      );
    }

    if (activeSection === "workshop") {
      return (
        <Dashboard
          summary={dashboardSummary}
          artifactEvidence={activeArtifactEvidence}
          loopEvidence={dashboardSummary.loopEvidence ?? null}
          isLoopEvidenceRefreshing={isLoopEvidenceRefreshing}
          runtime={constructRuntime}
          onCreateWorkshop={openWorkshopModal}
          onRunConstruct={() => setActiveSection("construct")}
          onArtifactEvidenceAction={handleArtifactEvidenceAction}
          onViewQueue={() => setActiveSection("forge")}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.dashboardResumeLesson)}
          learningLoopAction={getAcademyAction(ACADEMY_ACTION_IDS.dashboardLearningLoop)}
          onResumeLesson={() => handleOpenAcademyAction(ACADEMY_ACTION_IDS.dashboardResumeLesson)}
          onOpenLearningLoop={() =>
            handleOpenAcademyAction(ACADEMY_ACTION_IDS.dashboardLearningLoop)
          }
          onOpenLoopStep={handleOpenLoopFocus}
        />
      );
    }

    if (activeSection === "materials") {
      return (
        <MaterialsWorkbench
          academyActions={academyActions}
          repository={repository}
          summary={foundryData.sectionSummaries.materials}
          workshop={dashboardSummary.workshop}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.materialsOpenAssemblyLine)}
          qaGeneratorArchiveHandoff={materialsArchiveHandoff}
          onOpenArchiveModel={handleOpenArchiveWithModel}
          onOpenAcademy={() =>
            handleOpenAcademyAction(ACADEMY_ACTION_IDS.materialsOpenAssemblyLine)
          }
          onOpenAcademyAction={handleOpenAcademyAction}
          onLoopEvidenceRefresh={refreshActiveLoopEvidence}
          loopFocus={loopFocus}
        />
      );
    }

    if (activeSection === "forge") {
      return (
        <ForgeWorkbench
          academyActions={academyActions}
          repository={repository}
          settings={settings}
          summary={foundryData.sectionSummaries.forge}
          workshop={dashboardSummary.workshop}
          forgePreset={forgePreset}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.forgeOpenTraining)}
          onConstructLoaded={handleConstructLoaded}
          onOpenAcademy={() => handleOpenAcademyAction(ACADEMY_ACTION_IDS.forgeOpenTraining)}
          onOpenAcademyAction={handleOpenAcademyAction}
          onLoopEvidenceRefresh={refreshActiveLoopEvidence}
          loopFocus={loopFocus}
        />
      );
    }

    if (activeSection === "artifacts") {
      return (
        <ArtifactsWorkbench
          activeArtifactId={dashboardSummary.workshop.activeArtifactId}
          academyActions={academyActions}
          defaultBaseModel={defaultBaseModel}
          repository={repository}
          summary={foundryData.sectionSummaries.artifacts}
          workshop={dashboardSummary.workshop}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.artifactsOpenPromotion)}
          archiveEntries={archiveEntries}
          handoff={archiveHandoff}
          settings={settings}
          onConstructLoaded={handleConstructLoaded}
          onArchiveEntriesChanged={handleArchiveEntriesChanged}
          onModelDownloadJobStarted={handleArchiveDownloadJobStarted}
          onBaseModelSelected={handleBaseModelSelected}
          onOpenConstructWithModel={handleOpenConstructWithModel}
          onArtifactEvidenceAction={handleArtifactEvidenceAction}
          onReturnToMaterialsWithModel={handleReturnToMaterialsWithModel}
          onOpenAcademy={() =>
            handleOpenAcademyAction(ACADEMY_ACTION_IDS.artifactsOpenPromotion)
          }
          onOpenAcademyAction={handleOpenAcademyAction}
          onLoopEvidenceRefresh={refreshActiveLoopEvidence}
          loopFocus={loopFocus}
        />
      );
    }

    if (activeSection === "academy") {
      return (
        <AcademyWorkbench
          repository={repository}
          focusConceptId={academyFocusConceptId}
          summary={foundryData.sectionSummaries.academy}
        />
      );
    }

    if (activeSection === "trials") {
      return (
        <TrialsWorkbench
          repository={repository}
          summary={foundryData.sectionSummaries.trials}
          workshop={dashboardSummary.workshop}
          academyActions={academyActions}
          onOpenAcademy={handleOpenAcademy}
          onOpenAcademyAction={handleOpenAcademyAction}
          onOpenForgePreset={handleOpenForgePreset}
          onLoopEvidenceRefresh={refreshActiveLoopEvidence}
          loopFocus={loopFocus}
          onClearLoopFocus={handleClearLoopFocus}
        />
      );
    }

    const summary = foundryData.sectionSummaries[activeSection];
    return (
      <section className="workbench-page" aria-label={summary.title}>
        <div className="workbench-hero panel-glass">
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="workbench-grid">
          {summary.stats.map((stat) => (
            <article className="stat-card panel-glass" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>
        <LearningCard
          title={summary.concept.title}
          body={summary.concept.body}
          actionLabel="Open Academy"
          onAction={() => handleOpenAcademy()}
        />
      </section>
    );
  };

  return (
    <div className={`foundry-shell ${isRuntimeInspectorOpen ? "inspector-open" : "inspector-collapsed"}`}>
      <aside className="foundry-sidebar">
        <div className="sidebar-brand">
          <FoundryLogo variant="horizontal" />
        </div>

        <nav className="foundry-nav" aria-label="The Foundry navigation">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              aria-label={`Open ${item.label}`}
              className={`foundry-nav-button ${activeSection === item.id ? "is-active" : ""}`}
              onClick={() => {
                if (item.id === "academy") {
                  setAcademyFocusConceptId(null);
                }
                setLoopFocus(null);
                setActiveSection(item.id);
              }}
              aria-current={activeSection === item.id ? "page" : undefined}
              type="button"
            >
              <i className={`fas ${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <WorkshopSwitcher
          activeWorkshopId={dashboardSummary.workshop.id}
          workshops={workshops}
          onCreateWorkshop={openWorkshopModal}
          onDeleteWorkshop={handleRequestDeleteWorkshop}
          onSelectWorkshop={handleSelectWorkshop}
        />

        <div className="operator-card panel-glass">
          <div className="operator-avatar">A</div>
          <div>
            <strong>Alexander</strong>
            <span>Engineer</span>
          </div>
        </div>
      </aside>

      <main className="foundry-main">
        <header className="foundry-topbar">
          <div className="foundry-topbar-title">
            <p className="section-eyebrow">{activeNavLabel}</p>
            <h1>Build Intelligence. Understand Everything.</h1>
          </div>
          <div className="foundry-topbar-actions">
            <HeaderWorkshopMenu
              activeWorkshop={dashboardSummary.workshop}
              workshops={workshops}
              onCreateWorkshop={openWorkshopModal}
              onDeleteWorkshop={handleRequestDeleteWorkshop}
              onSelectWorkshop={handleSelectWorkshop}
            />
            <button
              aria-expanded={isRuntimeInspectorOpen}
              aria-label="Toggle runtime metrics drawer"
              className="button-secondary button-compact runtime-drawer-toggle"
              onClick={() => setRuntimeInspectorOpen(!isRuntimeInspectorOpen)}
              type="button"
            >
              <i className="fas fa-gauge-high" aria-hidden="true" />
              Runtime Metrics
            </button>
          </div>
        </header>
        {renderMain()}
      </main>

      <aside className="foundry-inspector" aria-label="Runtime metrics drawer" aria-hidden={!isRuntimeInspectorOpen}>
        <div className="inspector-drawer-header">
          <div>
            <p className="panel-kicker">Runtime Drawer</p>
            <strong>Metrics and learning aids</strong>
          </div>
          <button
            aria-label="Close runtime metrics drawer"
            className="icon-button"
            onClick={() => setRuntimeInspectorOpen(false)}
            type="button"
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <Metrics
          contextWindow={settings.contextWindow}
          maxNewTokens={settings.maxNewTokens}
          metrics={deriveRuntimeMetrics(
            foundryData.dashboard.runtimeMetrics,
            constructRuntime,
            settings.contextWindow
          )}
          runtime={constructRuntime}
          trainingMethod={settings.trainingMethod}
        />
        <div className="inspector-learning-stack" aria-label="Contextual learning">
          <LayerVisualizer />
          <TokenPreview text={`${settings.characterVoice} is ready to roll!`} />
        </div>
      </aside>

      <WorkshopCreateModal
        isOpen={isWorkshopModalOpen}
        isSaving={isCreatingWorkshop}
        settings={settings}
        onClose={closeWorkshopModal}
        onCreate={handleCreateWorkshop}
      />
      <WorkshopDeleteModal
        error={deleteWorkshopError}
        isDeleting={isDeletingWorkshop}
        isOpen={Boolean(workshopPendingDeletion)}
        remainingWorkshopCount={workshops.length}
        workshop={workshopPendingDeletion}
        onCancel={handleCloseDeleteWorkshop}
        onConfirm={handleDeleteWorkshop}
      />
      {createError && <div className="toast-error" role="status">{createError}</div>}
      {statusToast && <div className="toast-status" role="status">{statusToast}</div>}
    </div>
  );
};

export default App;
