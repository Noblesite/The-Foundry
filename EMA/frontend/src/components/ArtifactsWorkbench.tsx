import React, { useEffect, useMemo, useState } from "react";
import {
  AcademyAction,
  Artifact,
  Construct,
  ModelArchiveEntry,
  ModelDownloadJob,
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
  archiveEntries: ModelArchiveEntry[];
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onArchiveEntriesChanged: (entries: ModelArchiveEntry[]) => void;
  onBaseModelSelected: (modelId: string) => void;
  onOpenConstructWithModel: (modelId: string, label?: string) => void;
  onOpenAcademy: () => void;
}

const isActiveDownloadJob = (job: ModelDownloadJob) =>
  job.status === "queued" || job.status === "running";

const mergeDownloadJobs = (
  currentJobs: ModelDownloadJob[],
  incomingJobs: ModelDownloadJob[]
) => {
  const jobsById = new Map(currentJobs.map((job) => [job.id, job]));
  incomingJobs.forEach((job) => jobsById.set(job.id, job));
  return Array.from(jobsById.values()).sort((left, right) =>
    (right.updatedAt || right.createdAt || right.id).localeCompare(
      left.updatedAt || left.createdAt || left.id
    )
  );
};

const ArtifactsWorkbench: React.FC<ArtifactsWorkbenchProps> = ({
  activeArtifactId,
  repository,
  summary,
  workshop,
  academyAction,
  archiveEntries,
  onConstructLoaded,
  onArchiveEntriesChanged,
  onBaseModelSelected,
  onOpenConstructWithModel,
  onOpenAcademy,
}) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [downloadJobs, setDownloadJobs] = useState<ModelDownloadJob[]>([]);
  const [modelResults, setModelResults] = useState<ModelSearchResult[]>([]);
  const [modelQuery, setModelQuery] = useState("tiny-gpt2");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState(activeArtifactId);
  const [isLoadingConstruct, setIsLoadingConstruct] = useState(false);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [isRegisteringModel, setIsRegisteringModel] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isEvictingArchiveEntry, setIsEvictingArchiveEntry] = useState(false);
  const [selectedInventoryEntryId, setSelectedInventoryEntryId] = useState("");
  const [defaultBaseModelTarget, setDefaultBaseModelTarget] = useState("");
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
          onArchiveEntriesChanged(entries);
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
  }, [onArchiveEntriesChanged, repository]);

  useEffect(() => {
    let isCurrent = true;

    repository
      .listModelDownloadJobs()
      .then((jobs) => {
        if (isCurrent) {
          setDownloadJobs(jobs);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Archive jobs.");
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

  const selectedArchiveEntry = useMemo(
    () => {
      if (!selectedModel) {
        return undefined;
      }
      const matches = archiveEntries.filter((entry) => entry.repoId === selectedModel.repoId);
      if (selectedModel.revision) {
        return matches.find((entry) => entry.revision === selectedModel.revision);
      }
      return (
        matches.find((entry) => entry.status === "cached" || entry.status === "ready") ||
        matches[0]
      );
    },
    [archiveEntries, selectedModel]
  );

  const registeredModelIds = useMemo(
    () => new Set(archiveEntries.map((entry) => entry.repoId)),
    [archiveEntries]
  );

  const archiveInventoryEntries = useMemo(
    () =>
      [...archiveEntries].sort((left, right) =>
        (right.updatedAt || right.createdAt || right.repoId).localeCompare(
          left.updatedAt || left.createdAt || left.repoId
        )
      ),
    [archiveEntries]
  );

  const selectedInventoryEntry = useMemo(
    () =>
      archiveInventoryEntries.find((entry) => entry.id === selectedInventoryEntryId) ||
      archiveInventoryEntries.find(
        (entry) => entry.status === "cached" || entry.status === "ready"
      ) ||
      archiveInventoryEntries[0],
    [archiveInventoryEntries, selectedInventoryEntryId]
  );

  const activeDownloadJobs = useMemo(
    () => downloadJobs.filter(isActiveDownloadJob),
    [downloadJobs]
  );

  useEffect(() => {
    if (!selectedInventoryEntryId && selectedInventoryEntry?.id) {
      setSelectedInventoryEntryId(selectedInventoryEntry.id);
    }
  }, [selectedInventoryEntry, selectedInventoryEntryId]);

  useEffect(() => {
    if (activeDownloadJobs.length === 0) {
      return undefined;
    }

    let isCurrent = true;

    const pollDownloadJobs = async () => {
      try {
        const updatedJobs = await Promise.all(
          activeDownloadJobs.map((job) => repository.getModelDownloadJob(job.id))
        );

        if (!isCurrent) {
          return;
        }

        setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, updatedJobs));

        const completedEntries = updatedJobs
          .map((job) => job.archiveEntry)
          .filter((entry): entry is ModelArchiveEntry => Boolean(entry));

        if (completedEntries.length > 0) {
          const entriesByKey = new Map(
            archiveEntries.map((entry) => [`${entry.repoId}:${entry.revision}`, entry])
          );
          completedEntries.forEach((entry) =>
            entriesByKey.set(`${entry.repoId}:${entry.revision}`, entry)
          );
          onArchiveEntriesChanged(Array.from(entriesByKey.values()));
        }
      } catch (pollError: unknown) {
        if (isCurrent) {
          setError(pollError instanceof Error ? pollError.message : "Could not refresh Archive jobs.");
        }
      }
    };

    const timer = window.setInterval(() => {
      void pollDownloadJobs();
    }, 1200);
    void pollDownloadJobs();

    return () => {
      isCurrent = false;
      window.clearInterval(timer);
    };
  }, [activeDownloadJobs, archiveEntries, onArchiveEntriesChanged, repository]);

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

  const formatLocalBytes = (bytes: number) => (bytes > 0 ? formatBytes(bytes) : "0 MB");

  const formatJobTimestamp = (job: ModelDownloadJob) => {
    const timestamp = job.updatedAt || job.createdAt;
    if (!timestamp) {
      return "Just now";
    }
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  const formatArchiveTimestamp = (timestamp?: string | null) => {
    if (!timestamp) {
      return "Never";
    }
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  const archiveTarget = (entry: ModelArchiveEntry) => entry.localPath || entry.repoId;

  const upsertArchiveEntry = (entry: ModelArchiveEntry) => {
    const withoutDuplicate = archiveEntries.filter(
      (candidate) => !(candidate.repoId === entry.repoId && candidate.revision === entry.revision)
    );
    onArchiveEntriesChanged([entry, ...withoutDuplicate]);
    setSelectedInventoryEntryId(entry.id);
  };

  const findCachedEntryForJob = (job: ModelDownloadJob) =>
    job.archiveEntry?.localPath
      ? job.archiveEntry
      : archiveEntries.find(
          (entry) =>
            entry.repoId === job.repoId &&
            entry.revision === job.revision &&
            Boolean(entry.localPath)
        );

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
      const nextEntries = (() => {
        const withoutDuplicate = archiveEntries.filter(
          (entry) =>
            !(
              entry.repoId === result.archiveEntry.repoId &&
              entry.revision === result.archiveEntry.revision
            )
        );
        return [result.archiveEntry, ...withoutDuplicate];
      })();
      onArchiveEntriesChanged(nextEntries);
      setSelectedInventoryEntryId(result.archiveEntry.id);
      onBaseModelSelected(result.archiveEntry.repoId);
      setDefaultBaseModelTarget(result.archiveEntry.repoId);
      setStatusText(`${result.archiveEntry.repoId} registered as the active base model.`);
    } catch (registerError: unknown) {
      setError(registerError instanceof Error ? registerError.message : "Could not register model.");
    } finally {
      setIsRegisteringModel(false);
    }
  };

  const downloadSelectedModel = async () => {
    if (!selectedModel) {
      return;
    }

    setIsDownloadingModel(true);
    setStatusText(null);
    setError(null);

    try {
      const job = await repository.startModelDownloadJob({
        repoId: selectedModel.repoId,
        revision: selectedModel.revision,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [job]));
      setStatusText(`${job.repoId} added to Archive Jobs.`);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download model.");
    } finally {
      setIsDownloadingModel(false);
    }
  };

  const retryDownloadJob = async (job: ModelDownloadJob) => {
    setStatusText(null);
    setError(null);

    try {
      const nextJob = await repository.startModelDownloadJob({
        repoId: job.repoId,
        revision: job.revision,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [nextJob]));
      setStatusText(`${nextJob.repoId} queued again for Archive download.`);
    } catch (retryError: unknown) {
      setError(retryError instanceof Error ? retryError.message : "Could not retry Archive job.");
    }
  };

  const cancelDownloadJob = async (job: ModelDownloadJob) => {
    setStatusText(null);
    setError(null);

    try {
      const canceledJob = await repository.cancelModelDownloadJob(job.id);
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [canceledJob]));
      setStatusText(`${canceledJob.repoId} Archive job canceled.`);
    } catch (cancelError: unknown) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel Archive job.");
    }
  };

  const openDownloadJobInConstruct = (job: ModelDownloadJob) => {
    const cachedEntry = findCachedEntryForJob(job);
    if (!cachedEntry?.localPath) {
      return;
    }
    setStatusText(null);
    setError(null);
    onOpenConstructWithModel(cachedEntry.localPath, cachedEntry.repoId);
    setStatusText(`${cachedEntry.repoId} handed off to Construct for preflight.`);
  };

  const openArchiveEntryInConstruct = (entry: ModelArchiveEntry) => {
    if (!entry.localPath) {
      return;
    }
    setStatusText(null);
    setError(null);
    onOpenConstructWithModel(entry.localPath, entry.repoId);
    setStatusText(`${entry.repoId} handed off to Construct for preflight.`);
  };

  const selectArchiveEntryAsDefault = (entry: ModelArchiveEntry) => {
    const target = archiveTarget(entry);
    onBaseModelSelected(target);
    setDefaultBaseModelTarget(target);
    setStatusText(`${target} selected as the default base model for Forge and Construct.`);
  };

  const refreshArchiveEntryCache = async (entry: ModelArchiveEntry) => {
    setStatusText(null);
    setError(null);

    try {
      const job = await repository.startModelDownloadJob({
        repoId: entry.repoId,
        revision: entry.revision,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [job]));
      setStatusText(`${job.repoId} added to Archive Jobs for cache refresh.`);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not refresh cache.");
    }
  };

  const evictArchiveEntry = async (entry: ModelArchiveEntry) => {
    setIsEvictingArchiveEntry(true);
    setStatusText(null);
    setError(null);

    try {
      const result = await repository.evictArchiveModel({
        repoId: entry.repoId,
        revision: entry.revision,
      });
      upsertArchiveEntry(result.archiveEntry);
      setStatusText(`${result.archiveEntry.repoId} cache pointer evicted from Archive.`);
    } catch (evictError: unknown) {
      setError(evictError instanceof Error ? evictError.message : "Could not evict Archive cache.");
    } finally {
      setIsEvictingArchiveEntry(false);
    }
  };

  const openCachedModelInConstruct = () => {
    if (!selectedArchiveEntry?.localPath) {
      return;
    }
    setStatusText(null);
    setError(null);
    onOpenConstructWithModel(selectedArchiveEntry.localPath, selectedArchiveEntry.repoId);
    setStatusText(`${selectedArchiveEntry.repoId} handed off to Construct for preflight.`);
  };

  const selectModelForRuntime = () => {
    if (!selectedModel) {
      return;
    }
    const modelTarget = selectedArchiveEntry?.localPath || selectedModel.repoId;
    onBaseModelSelected(modelTarget);
    setDefaultBaseModelTarget(modelTarget);
    setStatusText(`${modelTarget} selected for Forge and Construct defaults.`);
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
                <div className="model-cache-state">
                  <span className={`status-badge cache-${selectedArchiveEntry?.status || "remote"}`}>
                    {selectedArchiveEntry?.status || "remote"}
                  </span>
                  <code>{selectedArchiveEntry?.localPath || "Not cached locally yet."}</code>
                </div>
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
                    <dt>Local</dt>
                    <dd>{formatBytes(selectedArchiveEntry?.sizeOnDiskBytes || 0)}</dd>
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
                  <button
                    className="button-secondary"
                    disabled={isDownloadingModel}
                    onClick={() => void downloadSelectedModel()}
                    type="button"
                  >
                    <i className="fas fa-download" aria-hidden="true" />
                    {isDownloadingModel
                      ? "Queueing"
                      : selectedArchiveEntry?.status === "cached"
                      ? "Refresh Cache"
                      : "Download to Archive"}
                  </button>
                  <button
                    className="button-secondary"
                    disabled={!selectedArchiveEntry?.localPath}
                    onClick={openCachedModelInConstruct}
                    type="button"
                  >
                    <i className="fas fa-play" aria-hidden="true" />
                    Open in Construct
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

        <section className="archive-jobs-panel" aria-label="Archive download jobs">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Download jobs</p>
              <h3>Archive Jobs</h3>
            </div>
            <span className="status-badge">
              {activeDownloadJobs.length > 0
                ? `${activeDownloadJobs.length} active`
                : `${downloadJobs.length} jobs`}
            </span>
          </div>

          {downloadJobs.length === 0 ? (
            <p className="empty-state">Queued downloads will appear here for retry, cancel, and Construct handoff.</p>
          ) : (
            <div className="archive-job-list">
              {downloadJobs.slice(0, 5).map((job) => {
                const cachedEntry = findCachedEntryForJob(job);
                return (
                  <article className="archive-job-row" key={job.id}>
                    <div className="archive-job-main">
                      <div>
                        <strong>{job.repoId}</strong>
                        <span>{job.revision || "default revision"}</span>
                      </div>
                      <div className="archive-job-meta">
                        <span className={`status-badge cache-${job.status}`}>{job.status}</span>
                        <span>{job.phase}</span>
                        <span>{formatJobTimestamp(job)}</span>
                      </div>
                      <p>{job.error || job.detail}</p>
                      <div className="archive-job-progress" aria-label={`${job.progress}% complete`}>
                        <span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                      </div>
                    </div>
                    <div className="archive-job-actions">
                      {isActiveDownloadJob(job) && (
                        <button
                          className="button-secondary button-compact"
                          disabled={job.cancelRequested}
                          onClick={() => void cancelDownloadJob(job)}
                          type="button"
                        >
                          <i className="fas fa-ban" aria-hidden="true" />
                          {job.cancelRequested ? "Canceling" : "Cancel"}
                        </button>
                      )}
                      {(job.status === "failed" || job.status === "canceled") && (
                        <button
                          className="button-secondary button-compact"
                          onClick={() => void retryDownloadJob(job)}
                          type="button"
                        >
                          <i className="fas fa-rotate-right" aria-hidden="true" />
                          Retry
                        </button>
                      )}
                      {job.status === "completed" && (
                        <button
                          className="button-primary button-compact"
                          disabled={!cachedEntry?.localPath}
                          onClick={() => openDownloadJobInConstruct(job)}
                          type="button"
                        >
                          <i className="fas fa-play" aria-hidden="true" />
                          Open in Construct
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="archive-inventory-panel" aria-label="Model Archive inventory">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Local inventory</p>
              <h3>Archive Detail</h3>
            </div>
            <span className="status-badge">
              {archiveInventoryEntries.filter((entry) => entry.localPath).length} cached
            </span>
          </div>

          {archiveInventoryEntries.length === 0 ? (
            <p className="empty-state">Register or download a base model to build your local Archive inventory.</p>
          ) : (
            <div className="archive-inventory-grid">
              <div className="archive-entry-list" aria-label="Registered Archive models">
                {archiveInventoryEntries.map((entry) => (
                  <button
                    className={`archive-entry-row ${
                      selectedInventoryEntry?.id === entry.id ? "is-active" : ""
                    }`}
                    key={entry.id}
                    onClick={() => setSelectedInventoryEntryId(entry.id)}
                    type="button"
                  >
                    <div>
                      <strong>{entry.repoId}</strong>
                      <span>{entry.revision || "default revision"}</span>
                    </div>
                    <div className="archive-entry-meta">
                      <span className={`status-badge cache-${entry.status}`}>{entry.status}</span>
                      <span>{formatLocalBytes(entry.sizeOnDiskBytes)}</span>
                    </div>
                  </button>
                ))}
              </div>

              <aside className="archive-detail-drawer" aria-label="Archive model detail">
                {selectedInventoryEntry ? (
                  <>
                    <div className="archive-detail-title">
                      <div>
                        <p className="panel-kicker">Cached base model</p>
                        <h3>{selectedInventoryEntry.repoId}</h3>
                      </div>
                      <span className={`status-badge cache-${selectedInventoryEntry.status}`}>
                        {selectedInventoryEntry.status}
                      </span>
                    </div>

                    <div className="archive-path-readout">
                      <span>Local path</span>
                      <code>{selectedInventoryEntry.localPath || "Not cached locally."}</code>
                    </div>

                    <dl className="archive-detail-stats">
                      <div>
                        <dt>Disk</dt>
                        <dd>{formatLocalBytes(selectedInventoryEntry.sizeOnDiskBytes)}</dd>
                      </div>
                      <div>
                        <dt>Runtime fit</dt>
                        <dd>{selectedInventoryEntry.localPath ? "ready" : "remote"}</dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{formatArchiveTimestamp(selectedInventoryEntry.lastUsedAt)}</dd>
                      </div>
                      <div>
                        <dt>Checked</dt>
                        <dd>{formatArchiveTimestamp(selectedInventoryEntry.lastCheckedAt)}</dd>
                      </div>
                      <div>
                        <dt>Library</dt>
                        <dd>{selectedInventoryEntry.libraryName || "unknown"}</dd>
                      </div>
                      <div>
                        <dt>Params</dt>
                        <dd>
                          {selectedInventoryEntry.parameterCount
                            ? `${(selectedInventoryEntry.parameterCount / 1_000_000).toFixed(1)}M`
                            : "Unknown"}
                        </dd>
                      </div>
                    </dl>

                    <div className="archive-detail-actions">
                      <button
                        className="button-primary"
                        disabled={!selectedInventoryEntry.localPath}
                        onClick={() => openArchiveEntryInConstruct(selectedInventoryEntry)}
                        type="button"
                      >
                        <i className="fas fa-play" aria-hidden="true" />
                        Open in Construct
                      </button>
                      <button
                        className="button-secondary"
                        onClick={() => selectArchiveEntryAsDefault(selectedInventoryEntry)}
                        type="button"
                      >
                        <i className="fas fa-thumbtack" aria-hidden="true" />
                        {defaultBaseModelTarget === archiveTarget(selectedInventoryEntry)
                          ? "Default Selected"
                          : "Set Default Base"}
                      </button>
                      <button
                        className="button-secondary"
                        onClick={() => void refreshArchiveEntryCache(selectedInventoryEntry)}
                        type="button"
                      >
                        <i className="fas fa-download" aria-hidden="true" />
                        Refresh Cache
                      </button>
                      <button
                        className="button-secondary"
                        disabled={!selectedInventoryEntry.localPath || isEvictingArchiveEntry}
                        onClick={() => void evictArchiveEntry(selectedInventoryEntry)}
                        type="button"
                      >
                        <i className="fas fa-box-open" aria-hidden="true" />
                        {isEvictingArchiveEntry ? "Evicting" : "Evict Cache"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">Select an Archive entry to inspect its runtime fit.</p>
                )}
              </aside>
            </div>
          )}
        </section>
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
