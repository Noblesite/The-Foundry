import React, { useEffect, useMemo, useState } from "react";
import ArtifactsWorkbench from "./components/ArtifactsWorkbench";
import ConstructWorkbench from "./components/ConstructWorkbench";
import Dashboard from "./components/Dashboard";
import ForgeWorkbench from "./components/ForgeWorkbench";
import FoundryLogo from "./components/FoundryLogo";
import { LearningCard, LayerVisualizer, TokenPreview } from "./components/LearningComponents";
import MaterialsWorkbench from "./components/MaterialsWorkbench";
import Metrics from "./components/Metrics";
import SettingsPanel, { WorkspaceSettings } from "./components/SettingsOverlay";
import WorkshopCreateModal from "./components/WorkshopCreateModal";
import WorkshopSwitcher from "./components/WorkshopSwitcher";
import { CreateWorkshopRequest } from "./contracts/foundryApi";
import { Artifact, Construct, NavigationSection, Workshop } from "./domain/foundry";
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

const App: React.FC = () => {
  const repository = useMemo(() => getFoundryRepository(), []);
  const [activeSection, setActiveSection] = useState<NavigationSection>("workshop");
  const [settings, setSettings] = useState<WorkspaceSettings>(loadWorkspaceSettings);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isWorkshopModalOpen, setIsWorkshopModalOpen] = useState(false);
  const [isCreatingWorkshop, setIsCreatingWorkshop] = useState(false);
  const [workshops, setWorkshops] = useState<Workshop[]>([mockDashboardSummary.workshop]);
  const [foundryData, setFoundryData] = useState<FoundryBootstrap>({
    dashboard: mockDashboardSummary,
    navigationItems: [],
    sectionSummaries: foundrySectionSummaries,
    uiCatalog: [],
  });

  useEffect(() => {
    let isCurrent = true;

    Promise.all([loadFoundryBootstrap(repository), repository.listWorkshops()])
      .then(([bootstrap, savedWorkshops]) => {
        if (isCurrent) {
          setFoundryData(bootstrap);
          setWorkshops(savedWorkshops.length ? savedWorkshops : [bootstrap.dashboard.workshop]);
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
          onResumeLesson={() => setActiveSection("academy")}
        />
      );
    }

    if (activeSection === "materials") {
      return (
        <MaterialsWorkbench
          repository={repository}
          summary={foundryData.sectionSummaries.materials}
          workshop={dashboardSummary.workshop}
          onOpenAcademy={() => setActiveSection("academy")}
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
          onOpenAcademy={() => setActiveSection("academy")}
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
          onConstructLoaded={handleConstructLoaded}
          onOpenAcademy={() => setActiveSection("academy")}
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
          onAction={() => setActiveSection("academy")}
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
              onClick={() => setActiveSection(item.id)}
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
          metrics={foundryData.dashboard.runtimeMetrics}
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
