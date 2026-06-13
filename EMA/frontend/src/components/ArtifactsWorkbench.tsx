import React, { useEffect, useMemo, useState } from "react";
import {
  AcademyAction,
  Artifact,
  Construct,
  ModelArchiveEntry,
  ModelSearchResult,
  SectionSummary,
  Workshop,
} from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, ConceptTooltip, LearningCard } from "./LearningComponents";

interface ArtifactsWorkbenchProps {
  activeArtifactId: string;
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  academyAction?: AcademyAction;
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onBaseModelSelected: (modelId: string) => void;
  onOpenAcademy: () => void;
}

const ArtifactsWorkbench: React.FC<ArtifactsWorkbenchProps> = ({
  activeArtifactId,
  repository,
  summary,
  workshop,
  academyAction,
  onConstructLoaded,
  onBaseModelSelected,
  onOpenAcademy,
}) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [archiveEntries, setArchiveEntries] = useState<ModelArchiveEntry[]>([]);
  const [modelResults, setModelResults] = useState<ModelSearchResult[]>([]);
  const [modelQuery, setModelQuery] = useState("tiny-gpt2");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState(activeArtifactId);
  const [isLoadingConstruct, setIsLoadingConstruct] = useState(false);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [isRegisteringModel, setIsRegisteringModel] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    repository
      .listArtifacts(workshop.id)
      .then((items) => {
        if (!isCurrent) {
          return;
        }
        setArtifacts(items);
        setSelectedArtifactId((current) => current || activeArtifactId || items[0]?.id || "");
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Artifacts.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeArtifactId, repository, workshop.id]);

  useEffect(() => {
    let isCurrent = true;

    repository
      .listModelArchiveEntries()
      .then((entries) => {
        if (isCurrent) {
          setArchiveEntries(entries);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Model Archive.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository]);

  useEffect(() => {
    void searchModels();
    // Load an initial suggested model set once the repository is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId]
  );

  const selectedModel = useMemo(
    () => modelResults.find((model) => model.repoId === selectedModelId) || modelResults[0],
    [modelResults, selectedModelId]
  );

  const registeredModelIds = useMemo(
    () => new Set(archiveEntries.map((entry) => entry.repoId)),
    [archiveEntries]
  );

  const formatBytes = (bytes: number) => {
    if (!bytes) {
      return "Unknown";
    }
    const gb = bytes / 1024 ** 3;
    if (gb >= 1) {
      return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
    }
    const mb = bytes / 1024 ** 2;
    return `${Math.max(1, Math.round(mb))} MB`;
  };

  const searchModels = async () => {
    setIsSearchingModels(true);
    setError(null);

    try {
      const result = await repository.searchArchiveModels({
        query: modelQuery,
        pipelineTag: "text-generation",
        sort: "downloads",
        limit: 8,
      });
      setModelResults(result.models);
      setSelectedModelId((current) => current || result.models[0]?.repoId || "");
    } catch (searchError: unknown) {
      setError(searchError instanceof Error ? searchError.message : "Could not search Hugging Face models.");
    } finally {
      setIsSearchingModels(false);
    }
  };

  const registerSelectedModel = async () => {
    if (!selectedModel) {
      return;
    }

    setIsRegisteringModel(true);
    setStatusText(null);
    setError(null);

    try {
      const result = await repository.registerArchiveModel({ repoId: selectedModel.repoId });
      setArchiveEntries((current) => {
        const withoutDuplicate = current.filter((entry) => entry.id !== result.archiveEntry.id);
        return [result.archiveEntry, ...withoutDuplicate];
      });
      onBaseModelSelected(result.archiveEntry.repoId);
      setStatusText(`${result.archiveEntry.repoId} registered as the active base model.`);
    } catch (registerError: unknown) {
      setError(registerError instanceof Error ? registerError.message : "Could not register model.");
    } finally {
      setIsRegisteringModel(false);
    }
  };

  const selectModelForRuntime = () => {
    if (!selectedModel) {
      return;
    }
    onBaseModelSelected(selectedModel.repoId);
    setStatusText(`${selectedModel.repoId} selected for Forge and Construct defaults.`);
  };

  const loadIntoConstruct = async () => {
    if (!selectedArtifact) {
      return;
    }

    setIsLoadingConstruct(true);
    setStatusText(null);
    setError(null);

    try {
      const construct = await repository.loadArtifactIntoConstruct(workshop.id, {
        artifactId: selectedArtifact.id,
      });
      setStatusText(`${selectedArtifact.name} loaded into ${construct.name}.`);
      onConstructLoaded(construct, selectedArtifact);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Construct.");
    } finally {
      setIsLoadingConstruct(false);
    }
  };

  return (
    <section className="artifacts-workbench" aria-label="Artifacts workbench">
      <div className="workbench-hero panel-glass">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="status-badge is-forging">{workshop.name}</div>
      </div>

      <div className="artifact-layout">
        <section className="artifacts-catalog panel-glass" aria-label="Artifact catalog">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Models out</p>
              <h2>Artifact Catalog</h2>
            </div>
            <span className="status-badge">{artifacts.length} Artifacts</span>
          </div>

          <div className="artifact-list">
            {artifacts.length === 0 ? (
              <p className="empty-state">Complete a Forge to create an Artifact.</p>
            ) : (
              artifacts.map((artifact) => (
                <button
                  className={`artifact-row ${selectedArtifactId === artifact.id ? "is-active" : ""}`}
                  key={artifact.id}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                  type="button"
                >
                  <div>
                    <strong>{artifact.name}</strong>
                    <span>{artifact.baseModel}</span>
                  </div>
                  <div className="material-meta">
                    <span>{artifact.version}</span>
                    <span>{artifact.trainingMethod}</span>
                    <span>{artifact.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <aside className="artifact-detail panel-glass" aria-label="Artifact detail">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Construct handoff</p>
              <h2>Load Artifact</h2>
            </div>
          </div>

          {selectedArtifact ? (
            <article className="forge-material-card">
              <strong>{selectedArtifact.name}</strong>
              <span>{selectedArtifact.adapterPath || "No adapter path registered yet."}</span>
              <div className="material-meta">
                <span>{selectedArtifact.id}</span>
                {selectedArtifact.forgeRunId && <span>Forge {selectedArtifact.forgeRunId}</span>}
                <span>{selectedArtifact.trialScore}% trial</span>
              </div>
              <button
                className="button-primary"
                disabled={isLoadingConstruct}
                onClick={loadIntoConstruct}
                type="button"
              >
                <i className="fas fa-play" aria-hidden="true" />
                {isLoadingConstruct ? "Loading" : "Load into Construct"}
              </button>
            </article>
          ) : (
            <p className="empty-state">Select an Artifact to load into a Construct.</p>
          )}

          {statusText && <p className="save-state success-state">{statusText}</p>}
          {error && <p className="save-state error-state">{error}</p>}

          <ConceptTooltip label="Why load Artifacts?" title="Artifact to Construct">
            An Artifact is saved model output. A Construct is the runtime surface
            that loads that output so you can run inference and test behavior.
          </ConceptTooltip>
        </aside>
      </div>

      <section className="model-archive-panel panel-glass" aria-label="Base model archive">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Base models</p>
            <h2>Model Browser</h2>
          </div>
          <span className="status-badge">{archiveEntries.length} Registered</span>
        </div>

        <div className="model-search-row">
          <label>
            <span>Hugging Face search</span>
            <input
              onChange={(event) => setModelQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void searchModels();
                }
              }}
              value={modelQuery}
            />
          </label>
          <button
            className="button-secondary button-compact"
            disabled={isSearchingModels}
            onClick={() => void searchModels()}
            type="button"
          >
            <i className="fas fa-magnifying-glass" aria-hidden="true" />
            {isSearchingModels ? "Searching" : "Search"}
          </button>
        </div>

        <div className="model-browser-grid">
          <div className="model-result-list" aria-label="Model search results">
            {modelResults.length === 0 ? (
              <p className="empty-state">Search for a public text-generation model.</p>
            ) : (
              modelResults.map((model) => (
                <button
                  className={`model-result-row ${selectedModel?.repoId === model.repoId ? "is-active" : ""}`}
                  key={model.repoId}
                  onClick={() => setSelectedModelId(model.repoId)}
                  type="button"
                >
                  <div>
                    <strong>{model.repoId}</strong>
                    <span>{model.libraryName || "unknown"} · {model.pipelineTag || "model"}</span>
                  </div>
                  <div className="model-result-meta">
                    <span>{model.fitEstimate.status}</span>
                    <span>{formatBytes(model.fitEstimate.estimatedBytes || model.sizeBytes)}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          <aside className="model-detail-card">
            {selectedModel ? (
              <>
                <div>
                  <p className="panel-kicker">Memory fit</p>
                  <h3>{selectedModel.repoId}</h3>
                </div>
                <div className="model-fit-readout">
                  <span className={`status-badge fit-${selectedModel.fitEstimate.status}`}>
                    {selectedModel.fitEstimate.status}
                  </span>
                  <strong>{formatBytes(selectedModel.fitEstimate.estimatedBytes)}</strong>
                  <span>{selectedModel.fitEstimate.recommendedRuntime.toUpperCase()}</span>
                </div>
                <p>{selectedModel.fitEstimate.reason}</p>
                <dl className="model-stats">
                  <div>
                    <dt>Downloads</dt>
                    <dd>{selectedModel.downloads.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Likes</dt>
                    <dd>{selectedModel.likes.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Params</dt>
                    <dd>
                      {selectedModel.parameterCount
                        ? `${(selectedModel.parameterCount / 1_000_000).toFixed(1)}M`
                        : "Unknown"}
                    </dd>
                  </div>
                </dl>
                <div className="model-actions">
                  <button
                    className="button-primary"
                    disabled={isRegisteringModel}
                    onClick={() => void registerSelectedModel()}
                    type="button"
                  >
                    <i className="fas fa-box-archive" aria-hidden="true" />
                    {registeredModelIds.has(selectedModel.repoId)
                      ? "Refresh Archive"
                      : isRegisteringModel
                      ? "Registering"
                      : "Register Model"}
                  </button>
                  <button className="button-secondary" onClick={selectModelForRuntime} type="button">
                    <i className="fas fa-sliders" aria-hidden="true" />
                    Use for Runtime
                  </button>
                </div>
              </>
            ) : (
              <p className="empty-state">Select a model to inspect its fit estimate.</p>
            )}
          </aside>
        </div>
      </section>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={academyAction}
        onAction={onOpenAcademy}
      />
      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="What should I learn before promotion?" />
      </div>
    </section>
  );
};

export default ArtifactsWorkbench;
