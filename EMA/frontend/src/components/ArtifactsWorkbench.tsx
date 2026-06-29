import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AcademyAction,
  ArchiveModelHandoff,
  Artifact,
  Construct,
  FoundryLoopFocus,
  ModelArchiveEntry,
  ModelDownloadJob,
  ModelSearchResult,
  SectionSummary,
  Workshop,
  WorkspaceSettings,
} from "../domain/foundry";
import {
  getArtifactEvidenceAction,
  type ArtifactEvidenceAction,
  type ArtifactEvidenceSummary,
} from "../domain/artifactEvidence";
import {
  ACADEMY_ACTION_IDS,
  findAcademyAction,
} from "../domain/academyRegistry";
import { buildModelLiteracyProfile } from "../domain/modelLiteracy";
import { ArchiveModelPreflightDto } from "../contracts/foundryApi";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, LearningCard } from "./LearningComponents";
import LoopFocusCallout from "./LoopFocusCallout";
import ModelLiteracyCards from "./ModelLiteracyCards";

interface ArtifactsWorkbenchProps {
  activeArtifactId: string;
  academyActions: AcademyAction[];
  defaultBaseModel: string;
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  academyAction?: AcademyAction;
  archiveEntries: ModelArchiveEntry[];
  handoff?: ArchiveModelHandoff | null;
  settings: WorkspaceSettings;
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onArchiveEntriesChanged: (entries: ModelArchiveEntry[]) => void;
  onModelDownloadJobStarted?: (job: ModelDownloadJob) => void;
  onBaseModelSelected: (modelId: string) => void;
  onOpenConstructWithModel: (modelId: string, label?: string) => void;
  onArtifactEvidenceAction: (action: ArtifactEvidenceAction) => void;
  onReturnToMaterialsWithModel?: (handoff: ArchiveModelHandoff) => void;
  onOpenAcademy: () => void;
  onOpenAcademyAction: (actionId: string) => void;
  onLoopEvidenceRefresh?: () => void;
  loopFocus?: FoundryLoopFocus | null;
}

const isActiveDownloadJob = (job: ModelDownloadJob) =>
  job.status === "queued" || job.status === "running";

type ArtifactLoopFocusTarget = "catalog" | "detail";

const artifactLoopFocusTarget = (
  focus?: FoundryLoopFocus | null
): ArtifactLoopFocusTarget | null => {
  if (!focus || focus.section !== "artifacts") {
    return null;
  }
  return focus.targetLabel === "Artifact Catalog" ? "catalog" : "detail";
};

const artifactKindLabel = (kind?: string) => {
  if (kind === "lora-adapter") {
    return "LoRA adapter";
  }
  if (kind === "full-checkpoint") {
    return "Full checkpoint";
  }
  if (kind === "metadata-only") {
    return "Metadata-only";
  }
  if (kind === "unknown-output") {
    return "Unknown output";
  }
  return "Unclassified";
};

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
  academyActions,
  defaultBaseModel,
  repository,
  summary,
  workshop,
  academyAction,
  archiveEntries,
  handoff,
  settings,
  onConstructLoaded,
  onArchiveEntriesChanged,
  onModelDownloadJobStarted,
  onBaseModelSelected,
  onOpenConstructWithModel,
  onArtifactEvidenceAction,
  onReturnToMaterialsWithModel,
  onOpenAcademy,
  onOpenAcademyAction,
  onLoopEvidenceRefresh,
  loopFocus,
}) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactEvidenceSummaries, setArtifactEvidenceSummaries] = useState<
    ArtifactEvidenceSummary[]
  >([]);
  const [downloadJobs, setDownloadJobs] = useState<ModelDownloadJob[]>([]);
  const [modelResults, setModelResults] = useState<ModelSearchResult[]>([]);
  const [modelQuery, setModelQuery] = useState("tiny-gpt2");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState(activeArtifactId);
  const [isLoadingConstruct, setIsLoadingConstruct] = useState(false);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [isRegisteringModel, setIsRegisteringModel] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isPreflightingModel, setIsPreflightingModel] = useState(false);
  const [isEvictingArchiveEntry, setIsEvictingArchiveEntry] = useState(false);
  const [selectedInventoryEntryId, setSelectedInventoryEntryId] = useState("");
  const [modelPreflight, setModelPreflight] = useState<ArchiveModelPreflightDto | null>(null);
  const [allowPreflightOverride, setAllowPreflightOverride] = useState(false);
  const [defaultBaseModelTarget, setDefaultBaseModelTarget] = useState(defaultBaseModel);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artifactFocusTarget = useMemo(
    () => artifactLoopFocusTarget(loopFocus),
    [loopFocus]
  );
  const artifactCatalogRef = useRef<HTMLElement | null>(null);
  const artifactDetailRef = useRef<HTMLElement | null>(null);
  const huggingFaceAuth = useMemo(
    () => ({
      username: settings.huggingFaceUsername || undefined,
      token: settings.huggingFaceToken || undefined,
    }),
    [settings.huggingFaceToken, settings.huggingFaceUsername]
  );

  useEffect(() => {
    if (!artifactFocusTarget || loopFocus?.section !== "artifacts") {
      return undefined;
    }

    const target =
      artifactFocusTarget === "detail" ? artifactDetailRef.current : artifactCatalogRef.current;
    const timeoutId = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [artifactFocusTarget, loopFocus?.requestedAt, loopFocus?.section]);
  const huggingFaceAuthLabel = huggingFaceAuth.username
    ? `Using Hugging Face auth for ${huggingFaceAuth.username}`
    : "Using anonymous Hugging Face access";

  useEffect(() => {
    let isCurrent = true;

    Promise.all([repository.listArtifacts(workshop.id), repository.listArtifactEvidence(workshop.id)])
      .then(([items, evidenceSummaries]) => {
        if (!isCurrent) {
          return;
        }
        setArtifacts(items);
        setArtifactEvidenceSummaries(evidenceSummaries);
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

  useEffect(() => {
    setDefaultBaseModelTarget(defaultBaseModel);
  }, [defaultBaseModel]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId]
  );

  useEffect(() => {
    if (!selectedArtifact) {
      return undefined;
    }

    let isCurrent = true;
    repository
      .getArtifactEvidence(selectedArtifact.id)
      .then((evidence) => {
        if (!isCurrent) {
          return;
        }
        setArtifactEvidenceSummaries((current) => [
          evidence,
          ...current.filter((summary) => summary.artifactId !== evidence.artifactId),
        ]);
      })
      .catch(() => {
        // The Workshop-level evidence list remains the fallback for transient detail failures.
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, selectedArtifact]);

  const selectedArtifactReadiness = selectedArtifact?.readiness;
  const selectedArtifactEvidence = useMemo(
    () =>
      selectedArtifact
        ? artifactEvidenceSummaries.find((summary) => summary.artifactId === selectedArtifact.id) ||
          null
        : null,
    [artifactEvidenceSummaries, selectedArtifact]
  );
  const selectedArtifactEvidenceAction = useMemo(
    () =>
      selectedArtifact && selectedArtifactEvidence
        ? getArtifactEvidenceAction(selectedArtifact, selectedArtifactEvidence)
        : null,
    [selectedArtifact, selectedArtifactEvidence]
  );
  const artifactsNextAction = useMemo(() => {
    if (!artifactFocusTarget) {
      return undefined;
    }
    if (artifactFocusTarget === "catalog") {
      return artifacts.length === 0
        ? "Complete a Forge so the Artifact registry has a model output to inspect."
        : "Select the Artifact you want to verify, promote, or load into Construct.";
    }
    if (!selectedArtifact) {
      return "Select an Artifact from the catalog before loading it into Construct.";
    }
    if (selectedArtifactReadiness && !selectedArtifactReadiness.canLoad) {
      return selectedArtifactReadiness.message || "Resolve Artifact readiness blockers before loading.";
    }
    return "Load this Artifact into Construct and confirm adapter/runtime evidence before Trial.";
  }, [artifactFocusTarget, artifacts.length, selectedArtifact, selectedArtifactReadiness]);
  const artifactReadinessAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.artifactsReadiness
  );
  const promotionGateAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.artifactsPromotionGate
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
  const selectedModelLiteracyProfile = useMemo(
    () => {
      const inspectedModel = modelPreflight?.model || selectedModel;
      return buildModelLiteracyProfile({
        modelId: inspectedModel?.repoId || selectedArchiveEntry?.repoId || defaultBaseModel,
        libraryName: inspectedModel?.libraryName || selectedArchiveEntry?.libraryName,
        pipelineTag: inspectedModel?.pipelineTag || selectedArchiveEntry?.pipelineTag,
        tags: inspectedModel?.tags,
        parameterCount: inspectedModel?.parameterCount || selectedArchiveEntry?.parameterCount,
        contextWindow: settings.contextWindow,
        repositoryFiles: inspectedModel?.siblings,
        runtimeMode: "archive selection",
        cached:
          inspectedModel?.cached ||
          selectedArchiveEntry?.status === "cached" ||
          selectedArchiveEntry?.status === "ready",
        source: "archive",
      });
    },
    [defaultBaseModel, modelPreflight?.model, selectedArchiveEntry, selectedModel, settings.contextWindow]
  );
  const canReturnCachedModelToMaterials = Boolean(
    handoff?.source === "materials" &&
      handoff.purpose === "qa-generator" &&
      handoff.returnTo === "materials" &&
      selectedArchiveEntry?.localPath &&
      (selectedArchiveEntry.status === "cached" || selectedArchiveEntry.status === "ready")
  );

  const downloadGateState = useMemo(() => {
    if (!selectedModel) {
      return {
        allowed: false,
        blocked: true,
        message: "Select a model before queueing an Archive download.",
      };
    }
    if (!modelPreflight) {
      return {
        allowed: allowPreflightOverride,
        blocked: true,
        message: "Run model preflight before queueing the Archive download.",
      };
    }
    if (modelPreflight.canDownload) {
      return {
        allowed: true,
        blocked: false,
        message: modelPreflight.message,
      };
    }
    return {
      allowed: allowPreflightOverride,
      blocked: true,
      message: modelPreflight.message,
    };
  }, [allowPreflightOverride, modelPreflight, selectedModel]);

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

  const searchModels = async (queryOverride?: string) => {
    setIsSearchingModels(true);
    setError(null);
    setModelPreflight(null);
    setAllowPreflightOverride(false);

    try {
      const query = queryOverride ?? modelQuery;
      const result = await repository.searchArchiveModels({
        query,
        pipelineTag: "text-generation",
        sort: "downloads",
        limit: 8,
        ...huggingFaceAuth,
      });
      setModelResults(result.models);
      setSelectedModelId((current) =>
        queryOverride || current || result.models[0]?.repoId || ""
      );
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
      const result = await repository.registerArchiveModel({
        repoId: selectedModel.repoId,
        ...huggingFaceAuth,
      });
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
    if (!selectedModel || !downloadGateState.allowed) {
      return;
    }

    setIsDownloadingModel(true);
    setStatusText(null);
    setError(null);

    try {
      const job = await repository.startModelDownloadJob({
        repoId: selectedModel.repoId,
        revision: selectedModel.revision,
        ...huggingFaceAuth,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [job]));
      onModelDownloadJobStarted?.(job);
      setStatusText(`${job.repoId} added to Archive Jobs.`);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : "Could not download model.");
    } finally {
      setIsDownloadingModel(false);
    }
  };

  const preflightArchiveTarget = async (repoId?: string, revision?: string) => {
    if (!repoId) {
      return;
    }

    setIsPreflightingModel(true);
    setStatusText(null);
    setError(null);

    try {
      const result = await repository.preflightArchiveModel({
        repoId,
        revision,
        ...huggingFaceAuth,
      });
      setModelResults((current) => {
        const withoutDuplicate = current.filter(
          (model) =>
            !(model.repoId === result.model.repoId && model.revision === result.model.revision)
        );
        return [result.model, ...withoutDuplicate];
      });
      setSelectedModelId(result.model.repoId);
      setModelPreflight(result);
      setStatusText(result.message);
    } catch (preflightError: unknown) {
      setModelPreflight(null);
      setError(
        preflightError instanceof Error
          ? preflightError.message
          : "Could not preflight Hugging Face model."
      );
    } finally {
      setIsPreflightingModel(false);
    }
  };

  const preflightSelectedModel = async () => {
    await preflightArchiveTarget(selectedModel?.repoId, selectedModel?.revision);
  };

  useEffect(() => {
    if (!handoff) {
      return;
    }
    setModelQuery(handoff.modelId);
    setSelectedModelId(handoff.modelId);
    setModelPreflight(null);
    setAllowPreflightOverride(false);
    setStatusText(
      `${handoff.label || handoff.modelId} arrived from Materials. Archive will verify cache and download readiness.`
    );
    void (async () => {
      await searchModels(handoff.modelId);
      if (handoff.preflightOnOpen) {
        await preflightArchiveTarget(handoff.modelId, handoff.revision);
      }
    })();
    // Handoffs are one-shot route intents keyed by requestedAt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.requestedAt]);

  const retryDownloadJob = async (job: ModelDownloadJob) => {
    setStatusText(null);
    setError(null);

    try {
      const nextJob = await repository.startModelDownloadJob({
        repoId: job.repoId,
        revision: job.revision,
        ...huggingFaceAuth,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [nextJob]));
      onModelDownloadJobStarted?.(nextJob);
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
        ...huggingFaceAuth,
      });
      setDownloadJobs((currentJobs) => mergeDownloadJobs(currentJobs, [job]));
      onModelDownloadJobStarted?.(job);
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

  const returnCachedModelToMaterials = () => {
    if (!handoff || !selectedArchiveEntry?.localPath || !canReturnCachedModelToMaterials) {
      return;
    }
    setStatusText(`${selectedArchiveEntry.repoId} returned to Materials for QA generator preflight.`);
    onReturnToMaterialsWithModel?.({
      ...handoff,
      modelId: selectedArchiveEntry.repoId,
      revision: selectedArchiveEntry.revision,
      requestedAt: Date.now(),
    });
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
    if (selectedArtifact.readiness && !selectedArtifact.readiness.canLoad) {
      setError(selectedArtifact.readiness.message);
      return;
    }

    setIsLoadingConstruct(true);
    setStatusText(null);
    setError(null);

    try {
      const construct = await repository.loadArtifactIntoConstruct(workshop.id, {
        artifactId: selectedArtifact.id,
      });
      setStatusText(
        selectedArtifact.readiness?.artifactKind === "lora-adapter"
          ? `${selectedArtifact.name} loaded into ${construct.name}. Construct runtime will apply the adapter during local load.`
          : `${selectedArtifact.name} loaded into ${construct.name}.`
      );
      onConstructLoaded(construct, selectedArtifact);
      onLoopEvidenceRefresh?.();
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

      <LoopFocusCallout
        focus={loopFocus}
        nextAction={artifactsNextAction}
        section="artifacts"
      />

      <div className="artifact-layout">
        <section
          className={`artifacts-catalog panel-glass ${artifactFocusTarget === "catalog" ? "is-loop-focused" : ""}`}
          aria-label="Artifact catalog"
          ref={artifactCatalogRef}
        >
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
                    {artifact.readiness && (
                      <span className={`status-badge readiness-${artifact.readiness.status}`}>
                        {artifact.readiness.status}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <aside
          className={`artifact-detail panel-glass ${artifactFocusTarget === "detail" ? "is-loop-focused" : ""}`}
          aria-label="Artifact detail"
          ref={artifactDetailRef}
        >
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
              {selectedArtifactReadiness && (
                <div className={`runtime-readiness-card readiness-${selectedArtifactReadiness.status}`}>
                  <div className="runtime-readiness-header">
                    <div>
                      <strong>Artifact readiness</strong>
                      <span>{selectedArtifactReadiness.message}</span>
                    </div>
                    <div className="runtime-load-actions">
                      <span className={`status-badge readiness-${selectedArtifactReadiness.status}`}>
                        {selectedArtifactReadiness.status}
                      </span>
                      <AcademyActionTooltip
                        action={artifactReadinessAcademyAction}
                        label="What is readiness?"
                      />
                    </div>
                  </div>
                  <div className="runtime-readiness-items">
                    <div className="readiness-item is-pass">
                      <i className="fas fa-diagram-project" aria-hidden="true" />
                      <div>
                        <span>Artifact kind</span>
                        <strong>{artifactKindLabel(selectedArtifactReadiness.artifactKind)}</strong>
                      </div>
                    </div>
                    <div className={`readiness-item is-${selectedArtifactReadiness.canLoad ? "pass" : "fail"}`}>
                      <i
                        className={`fas ${selectedArtifactReadiness.canLoad ? "fa-check" : "fa-triangle-exclamation"}`}
                        aria-hidden="true"
                      />
                      <div>
                        <span>Construct load</span>
                        <strong>
                          {selectedArtifactReadiness.canLoad ? "Allowed" : "Blocked"}
                          <AcademyActionTooltip
                            action={promotionGateAcademyAction}
                            label="?"
                          />
                        </strong>
                      </div>
                    </div>
                    <div className="readiness-item is-pass">
                      <i className="fas fa-file-circle-check" aria-hidden="true" />
                      <div>
                        <span>Output files</span>
                        <strong>{selectedArtifactReadiness.presentFiles.length}</strong>
                      </div>
                    </div>
                    {selectedArtifactReadiness.compatibility && (
                      <div
                        className={`readiness-item is-${
                          selectedArtifactReadiness.compatibility.status === "mismatch" ? "fail" : "pass"
                        }`}
                      >
                        <i className="fas fa-link" aria-hidden="true" />
                        <div>
                          <span>Base compatibility</span>
                          <strong>{selectedArtifactReadiness.compatibility.status}</strong>
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedArtifactReadiness.compatibility && (
                    <p className="artifact-readiness-copy">
                      {selectedArtifactReadiness.compatibility.message}
                    </p>
                  )}
                  {selectedArtifactReadiness.trainerResult && (
                    <div className="artifact-trainer-summary">
                      <div>
                        <span>Device</span>
                        <strong>{selectedArtifactReadiness.trainerResult.device || "unknown"}</strong>
                      </div>
                      <div>
                        <span>Rows used</span>
                        <strong>{selectedArtifactReadiness.trainerResult.rowsUsed ?? "n/a"}</strong>
                      </div>
                      <div>
                        <span>Loss</span>
                        <strong>{selectedArtifactReadiness.trainerResult.loss ?? "n/a"}</strong>
                      </div>
                    </div>
                  )}
                  {selectedArtifactReadiness.presentFiles.length > 0 && (
                    <div className="runtime-readiness-warnings">
                      {(selectedArtifactReadiness.outputFiles || []).slice(0, 5).map((file) => (
                        <span key={file.path}>
                          {file.role}: {file.path}
                        </span>
                      ))}
                      {!selectedArtifactReadiness.outputFiles?.length && (
                        <span>{selectedArtifactReadiness.presentFiles.slice(0, 3).join(", ")}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selectedArtifactEvidence && (
                <div className={`artifact-evidence-card readiness-${selectedArtifactEvidence.status}`}>
                  <div className="runtime-readiness-header">
                    <div>
                      <p className="panel-kicker">Artifact evidence</p>
                      <strong>{selectedArtifactEvidence.title}</strong>
                      <span>{selectedArtifactEvidence.summary}</span>
                    </div>
                    <span className={`status-badge readiness-${selectedArtifactEvidence.status}`}>
                      {selectedArtifactEvidence.status}
                    </span>
                  </div>
                  <div className="artifact-evidence-stats">
                    <div>
                      <span>Total Trials</span>
                      <strong>{selectedArtifactEvidence.totalTrials}</strong>
                    </div>
                    <div>
                      <span>Pass</span>
                      <strong>{selectedArtifactEvidence.passTrials}</strong>
                    </div>
                    <div>
                      <span>Adapter-backed</span>
                      <strong>{selectedArtifactEvidence.adapterBackedPassTrials}</strong>
                    </div>
                    <div>
                      <span>Needs review</span>
                      <strong>{selectedArtifactEvidence.needsReviewTrials}</strong>
                    </div>
                  </div>
                  <p className="artifact-readiness-copy">{selectedArtifactEvidence.nextAction}</p>
                  {selectedArtifactEvidenceAction && (
                    <div className="artifact-evidence-actions">
                      <div className="artifact-evidence-route-preview">
                        <span>Route preview</span>
                        <strong>
                          {selectedArtifactEvidenceAction.routePreview.destination}
                          {" -> "}
                          {selectedArtifactEvidenceAction.routePreview.focus}
                        </strong>
                        <small>
                          Artifact {selectedArtifactEvidenceAction.routePreview.artifactId}
                          {selectedArtifactEvidenceAction.routePreview.filter
                            ? ` / Filter: ${selectedArtifactEvidenceAction.routePreview.filter}`
                            : ""}
                        </small>
                      </div>
                      <button
                        className="button-secondary button-compact"
                        onClick={() => onArtifactEvidenceAction(selectedArtifactEvidenceAction)}
                        type="button"
                      >
                        <i
                          className={`fas ${selectedArtifactEvidenceAction.icon}`}
                          aria-hidden="true"
                        />
                        {selectedArtifactEvidenceAction.label}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                className="button-primary"
                disabled={
                  isLoadingConstruct ||
                  (selectedArtifactReadiness ? !selectedArtifactReadiness.canLoad : false)
                }
                onClick={loadIntoConstruct}
                type="button"
              >
                <i className="fas fa-play" aria-hidden="true" />
                {isLoadingConstruct ? "Loading" : "Load into Construct"}
              </button>
              <AcademyActionTooltip
                action={promotionGateAcademyAction}
                label="Why gate loading?"
              />
            </article>
          ) : (
            <p className="empty-state">Select an Artifact to load into a Construct.</p>
          )}

          {statusText && <p className="save-state success-state">{statusText}</p>}
          {error && <p className="save-state error-state">{error}</p>}

          <AcademyActionTooltip
            action={promotionGateAcademyAction}
            label="Why load Artifacts?"
          />
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
        <p className="save-state">
          {huggingFaceAuthLabel}
          {huggingFaceAuth.username && !huggingFaceAuth.token
            ? ". Add a token in Settings before opening gated or private models."
            : "."}
        </p>

        <div className="model-browser-grid">
          <div className="model-result-list" aria-label="Model search results">
            {modelResults.length === 0 ? (
              <p className="empty-state">Search for a public text-generation model.</p>
            ) : (
              modelResults.map((model) => (
                <button
                  className={`model-result-row ${selectedModel?.repoId === model.repoId ? "is-active" : ""}`}
                  key={model.repoId}
                  onClick={() => {
                    setSelectedModelId(model.repoId);
                    setModelPreflight(null);
                    setAllowPreflightOverride(false);
                  }}
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
                {modelPreflight && (
                  <div className="model-preflight-card">
                    <div>
                      <span
                        className={`status-badge ${
                          modelPreflight.canDownload ? "cache-ready" : "cache-failed"
                        }`}
                      >
                        {modelPreflight.canDownload ? "Preflight ready" : "Needs review"}
                      </span>
                      <span className={`status-badge visibility-${modelPreflight.visibility}`}>
                        {modelPreflight.visibility}
                      </span>
                    </div>
                    <p>{modelPreflight.message}</p>
                    <dl className="model-stats">
                      <div>
                        <dt>Download</dt>
                        <dd>{formatBytes(modelPreflight.estimatedDownloadBytes)}</dd>
                      </div>
                      <div>
                        <dt>Fit</dt>
                        <dd>{modelPreflight.fitEstimate.status}</dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>{modelPreflight.fitEstimate.recommendedRuntime.toUpperCase()}</dd>
                      </div>
                      <div>
                        <dt>Auth</dt>
                        <dd>{modelPreflight.auth.tokenPresent ? "Token" : "Public"}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                <div className="model-actions">
                  <button
                    className="button-secondary"
                    disabled={isPreflightingModel}
                    onClick={() => void preflightSelectedModel()}
                    type="button"
                  >
                    <i className="fas fa-list-check" aria-hidden="true" />
                    {isPreflightingModel ? "Checking" : "Preflight Model"}
                  </button>
                  {downloadGateState.blocked && (
                    <div className="model-download-gate">
                      <p>{downloadGateState.message}</p>
                      <label className="toggle-row" htmlFor="preflight-override">
                        <span>Engineer override</span>
                        <input
                          checked={allowPreflightOverride}
                          id="preflight-override"
                          onChange={(event) => setAllowPreflightOverride(event.target.checked)}
                          type="checkbox"
                        />
                      </label>
                    </div>
                  )}
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
                    disabled={isDownloadingModel || !downloadGateState.allowed}
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
                  {handoff?.purpose === "qa-generator" && handoff.returnTo === "materials" && (
                    <button
                      className="button-secondary"
                      data-testid="archive-return-to-materials"
                      disabled={!canReturnCachedModelToMaterials}
                      onClick={returnCachedModelToMaterials}
                      type="button"
                    >
                      <i className="fas fa-arrow-turn-down" aria-hidden="true" />
                      Return to Materials
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="empty-state">Select a model to inspect its fit estimate.</p>
            )}
          </aside>
        </div>

        <ModelLiteracyCards profile={selectedModelLiteracyProfile} />

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
      <LearningCard
        title="Readiness separates output types"
        body="Artifacts can be metadata-only, LoRA adapters, full checkpoints, or blocked outputs. Readiness tells users which kind they are about to promote."
        academyAction={artifactReadinessAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.artifactsReadiness)}
      />
      <LearningCard
        title="Promotion is evidence, not hope"
        body="Load into Construct only when output files, base-model compatibility, and Trial evidence are clear enough to make the result worth testing."
        academyAction={promotionGateAcademyAction}
        onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.artifactsPromotionGate)}
      />
      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="What should I learn before promotion?" />
      </div>
    </section>
  );
};

export default ArtifactsWorkbench;
