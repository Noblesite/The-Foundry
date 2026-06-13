import React, { useEffect, useMemo, useState } from "react";
import AcademyWorkbench from "./components/AcademyWorkbench";
import ArtifactsWorkbench from "./components/ArtifactsWorkbench";
import ConstructWorkbench from "./components/ConstructWorkbench";
import Dashboard from "./components/Dashboard";
import ForgeWorkbench from "./components/ForgeWorkbench";
import FoundryLogo from "./components/FoundryLogo";
import { LearningCard, LayerVisualizer, TokenPreview } from "./components/LearningComponents";
import MaterialsWorkbench from "./components/MaterialsWorkbench";
import Metrics from "./components/Metrics";
import SettingsPanel, { WorkspaceSettings } from "./components/SettingsOverlay";
import TrialsWorkbench from "./components/TrialsWorkbench";
import WorkshopCreateModal from "./components/WorkshopCreateModal";
import WorkshopSwitcher from "./components/WorkshopSwitcher";
import { CreateWorkshopRequest, StartForgeRequest } from "./contracts/foundryApi";
import {
  ACADEMY_ACTION_IDS,
  defaultAcademyActions,
  findAcademyAction,
} from "./domain/academyRegistry";
import {
  Artifact,
  Construct,
  ConstructRuntime,
  NavigationSection,
  RuntimeMetric,
  Workshop,
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
import "./App.css";

const loadWorkspaceSettings = (): WorkspaceSettings => {
  const savedSettings = window.localStorage.getItem("foundry.workspaceSettings");
  if (!savedSettings) {
    return defaultWorkspaceSettings;
  }

  try {
    return { ...defaultWorkspaceSettings, ...JSON.parse(savedSettings) };
  } catch {
    return defaultWorkspaceSettings;
  }
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const deriveRuntimeMetrics = (
  baselineMetrics: RuntimeMetric[],
  runtime: ConstructRuntime | null,
  contextWindow: number
): RuntimeMetric[] => {
  const diagnostics = runtime?.diagnostics || {};
  const memory = diagnostics.memory as
    | { percentUsed?: number; totalGb?: number; availableGb?: number }
    | undefined;
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
          ? "Accelerator is available for local model inference."
          : "No GPU/MPS accelerator is reported by the runtime.",
      };
    }

    if (metric.id === "gpu-memory") {
      return {
        ...metric,
        value: isLoaded ? 42 : isMps || isCuda ? 10 : 0,
        state: isLoaded ? "active" : "idle",
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
  const [settings, setSettings] = useState<WorkspaceSettings>(loadWorkspaceSettings);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isWorkshopModalOpen, setIsWorkshopModalOpen] = useState(false);
  const [isCreatingWorkshop, setIsCreatingWorkshop] = useState(false);
  const [forgePreset, setForgePreset] = useState<StartForgeRequest | null>(null);
  const [academyFocusConceptId, setAcademyFocusConceptId] = useState<string | null>(null);
  const [constructRuntime, setConstructRuntime] = useState<ConstructRuntime | null>(null);
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
    ])
      .then(([bootstrap, savedWorkshops, runtime]) => {
        if (isCurrent) {
          setFoundryData(bootstrap);
          setWorkshops(savedWorkshops.length ? savedWorkshops : [bootstrap.dashboard.workshop]);
          setConstructRuntime(runtime);
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

  const refreshFoundryData = async () => {
    const [bootstrap, savedWorkshops] = await Promise.all([
      loadFoundryBootstrap(repository),
      repository.listWorkshops(),
    ]);
    setFoundryData(bootstrap);
    setWorkshops(savedWorkshops.length ? savedWorkshops : [bootstrap.dashboard.workshop]);
    return bootstrap;
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

  const handleSelectWorkshop = (workshop: Workshop) => {
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
    setActiveSection("construct");
  };

  const refreshConstructRuntime = () => {
    repository
      .getConstructRuntime()
      .then(setConstructRuntime)
      .catch((error: unknown) => console.error("[Construct Runtime]", error));
  };

  const handleOpenForgePreset = (preset: StartForgeRequest) => {
    setForgePreset(preset);
    setActiveSection("forge");
  };

  const handleBaseModelSelected = (modelId: string) => {
    persistSettings({
      ...settings,
      modelName: modelId,
      constructModelId: modelId,
    });
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

  const activeArtifact = useMemo(
    () => ({
      ...mockDashboardSummary.currentArtifact,
      ...foundryData.dashboard.currentArtifact,
      baseModel: foundryData.dashboard.currentArtifact.baseModel || settings.modelName,
      name: foundryData.dashboard.currentArtifact.name || `${settings.characterVoice} Model`,
      trainingMethod: foundryData.dashboard.currentArtifact.trainingMethod || settings.trainingMethod,
    }),
    [
      foundryData.dashboard.currentArtifact,
      settings.characterVoice,
      settings.modelName,
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

  const activeNavLabel = useMemo(
    () => navigationItems.find((item) => item.id === activeSection)?.label ?? "Workshop",
    [activeSection, navigationItems]
  );

  const renderMain = () => {
    if (activeSection === "settings") {
      return <SettingsPanel settings={settings} onSave={persistSettings} />;
    }

    if (activeSection === "construct") {
      return (
        <ConstructWorkbench
          artifact={activeArtifact}
          construct={activeConstruct}
          repository={repository}
          settings={settings}
        />
      );
    }

    if (activeSection === "workshop") {
      return (
        <Dashboard
          summary={dashboardSummary}
          onCreateWorkshop={openWorkshopModal}
          onRunConstruct={() => setActiveSection("construct")}
          onViewQueue={() => setActiveSection("forge")}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.dashboardResumeLesson)}
          onResumeLesson={() => handleOpenAcademyAction(ACADEMY_ACTION_IDS.dashboardResumeLesson)}
        />
      );
    }

    if (activeSection === "materials") {
      return (
        <MaterialsWorkbench
          repository={repository}
          summary={foundryData.sectionSummaries.materials}
          workshop={dashboardSummary.workshop}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.materialsOpenAssemblyLine)}
          onOpenAcademy={() =>
            handleOpenAcademyAction(ACADEMY_ACTION_IDS.materialsOpenAssemblyLine)
          }
        />
      );
    }

    if (activeSection === "forge") {
      return (
        <ForgeWorkbench
          repository={repository}
          settings={settings}
          summary={foundryData.sectionSummaries.forge}
          workshop={dashboardSummary.workshop}
          forgePreset={forgePreset}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.forgeOpenTraining)}
          onConstructLoaded={handleConstructLoaded}
          onOpenAcademy={() => handleOpenAcademyAction(ACADEMY_ACTION_IDS.forgeOpenTraining)}
        />
      );
    }

    if (activeSection === "artifacts") {
      return (
        <ArtifactsWorkbench
          activeArtifactId={dashboardSummary.workshop.activeArtifactId}
          repository={repository}
          summary={foundryData.sectionSummaries.artifacts}
          workshop={dashboardSummary.workshop}
          academyAction={getAcademyAction(ACADEMY_ACTION_IDS.artifactsOpenPromotion)}
          onConstructLoaded={handleConstructLoaded}
          onBaseModelSelected={handleBaseModelSelected}
          onRuntimeLoaded={refreshConstructRuntime}
          onOpenAcademy={() =>
            handleOpenAcademyAction(ACADEMY_ACTION_IDS.artifactsOpenPromotion)
          }
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
    <div className="foundry-shell">
      <aside className="foundry-sidebar">
        <div className="sidebar-brand">
          <FoundryLogo variant="horizontal" />
        </div>

        <nav className="foundry-nav" aria-label="The Foundry navigation">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              className={`foundry-nav-button ${activeSection === item.id ? "is-active" : ""}`}
              onClick={() => {
                if (item.id === "academy") {
                  setAcademyFocusConceptId(null);
                }
                setActiveSection(item.id);
              }}
              aria-current={activeSection === item.id ? "page" : undefined}
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
          <div>
            <p className="section-eyebrow">{activeNavLabel}</p>
            <h1>Build Intelligence. Understand Everything.</h1>
          </div>
          <button className="button-primary" onClick={openWorkshopModal}>
            <i className="fas fa-plus" aria-hidden="true" />
            New Workshop
          </button>
        </header>
        {renderMain()}
      </main>

      <aside className="foundry-inspector">
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
        <LayerVisualizer />
        <TokenPreview text={`${settings.characterVoice} is ready to roll!`} />
      </aside>

      <WorkshopCreateModal
        isOpen={isWorkshopModalOpen}
        isSaving={isCreatingWorkshop}
        settings={settings}
        onClose={closeWorkshopModal}
        onCreate={handleCreateWorkshop}
      />
      {createError && <div className="toast-error" role="status">{createError}</div>}
    </div>
  );
};

export default App;
