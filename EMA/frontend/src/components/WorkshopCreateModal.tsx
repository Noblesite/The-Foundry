import React, { useEffect, useState } from "react";
import { CreateWorkshopRequest } from "../contracts/foundryApi";
import {
  ModelArchiveEntry,
  ModelSearchResult,
  WorkspaceSettings,
  resolveDefaultBaseModel,
} from "../domain/foundry";

interface WorkshopCreateModalProps {
  isOpen: boolean;
  isSaving: boolean;
  settings: WorkspaceSettings;
  archiveEntries?: ModelArchiveEntry[];
  onClose: () => void;
  onCreate: (request: CreateWorkshopRequest) => Promise<void>;
  onSearchBaseModels?: (query: string) => Promise<ModelSearchResult[]>;
}

interface BaseModelOption {
  id: string;
  label: string;
  detail: string;
}

const isCachedArchiveEntry = (entry: ModelArchiveEntry) =>
  Boolean(entry.localPath) && (entry.status === "cached" || entry.status === "ready");

const formatModelSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) {
    return "size unknown";
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024).toLocaleString()} KB`;
};

const WorkshopCreateModal: React.FC<WorkshopCreateModalProps> = ({
  isOpen,
  isSaving,
  settings,
  archiveEntries = [],
  onClose,
  onCreate,
  onSearchBaseModels,
}) => {
  const defaultBaseModel = resolveDefaultBaseModel(settings);
  const [draft, setDraft] = useState<CreateWorkshopRequest>({
    name: `${settings.subjectMatter} Workshop`,
    subject: settings.subjectMatter,
    voiceTarget: settings.characterVoice,
    baseModel: defaultBaseModel,
  });
  const [modelQuery, setModelQuery] = useState(defaultBaseModel);
  const [modelResults, setModelResults] = useState<ModelSearchResult[]>([]);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [modelSearchError, setModelSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft({
        name: `${settings.subjectMatter} Workshop`,
        subject: settings.subjectMatter,
        voiceTarget: settings.characterVoice,
        baseModel: defaultBaseModel,
      });
      setModelQuery(defaultBaseModel);
      setModelResults([]);
      setModelSearchError(null);
    }
  }, [
    defaultBaseModel,
    isOpen,
    settings.characterVoice,
    settings.subjectMatter,
  ]);

  if (!isOpen) {
    return null;
  }

  const updateDraft = <K extends keyof CreateWorkshopRequest>(
    key: K,
    value: CreateWorkshopRequest[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const cachedOptions: BaseModelOption[] = archiveEntries
    .filter(isCachedArchiveEntry)
    .map((entry) => ({
      id: entry.repoId,
      label: entry.repoId,
      detail: `Cached Archive · ${formatModelSize(entry.sizeOnDiskBytes)} · ${entry.pipelineTag || "model"}`,
    }));

  const remoteOptions: BaseModelOption[] = modelResults.map((model) => ({
    id: model.repoId,
    label: model.repoId,
    detail: `${model.cached ? "Cached" : "Hugging Face"} · ${model.fitEstimate.status} · ${
      model.pipelineTag || "model"
    }`,
  }));

  const optionIds = new Set([
    ...cachedOptions.map((option) => option.id),
    ...remoteOptions.map((option) => option.id),
  ]);
  const currentBaseModel = (draft.baseModel || "").trim();
  const shouldShowCurrentOption = currentBaseModel && !optionIds.has(currentBaseModel);
  const searchUsesToken = Boolean(settings.huggingFaceToken);

  const searchBaseModels = async () => {
    if (!onSearchBaseModels) {
      setModelSearchError("Model search is not available in the current data source.");
      return;
    }
    const query = modelQuery.trim();
    if (!query) {
      setModelSearchError("Enter a model family, repo id, or keyword to search.");
      return;
    }

    setIsSearchingModels(true);
    setModelSearchError(null);
    try {
      const results = await onSearchBaseModels(query);
      setModelResults(results);
      if (!currentBaseModel && results[0]) {
        updateDraft("baseModel", results[0].repoId);
      }
      if (results.length === 0) {
        setModelSearchError("No matching models returned. You can still use the typed repo id.");
      }
    } catch (error: unknown) {
      setModelSearchError(error instanceof Error ? error.message : "Could not search Hugging Face models.");
    } finally {
      setIsSearchingModels(false);
    }
  };

  const useTypedModelId = () => {
    const query = modelQuery.trim();
    if (query) {
      updateDraft("baseModel", query);
    }
  };

  const submitWorkshop = async (event: React.FormEvent) => {
    event.preventDefault();
    await onCreate(draft);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workshop-modal panel-glass" role="dialog" aria-modal="true" aria-label="Create Workshop">
        <div className="modal-heading">
          <div>
            <p className="section-eyebrow">Workshop</p>
            <h2>New Workshop</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close new Workshop">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <form className="workshop-form" onSubmit={submitWorkshop}>
          <label className="field-label" htmlFor="workshop-name">Name</label>
          <input
            id="workshop-name"
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            required
          />

          <label className="field-label" htmlFor="workshop-subject">Subject matter</label>
          <input
            id="workshop-subject"
            type="text"
            value={draft.subject}
            onChange={(event) => updateDraft("subject", event.target.value)}
            required
          />

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="workshop-voice">Voice target</label>
              <input
                id="workshop-voice"
                type="text"
                value={draft.voiceTarget ?? ""}
                onChange={(event) => updateDraft("voiceTarget", event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="workshop-model">Base model</label>
              <div className="workshop-model-selector">
                <div className="workshop-model-search">
                  <input
                    aria-label="Search Hugging Face base models"
                    type="search"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchBaseModels();
                      }
                    }}
                    placeholder="Search Hugging Face or paste repo id"
                  />
                  <button
                    className="button-secondary button-compact"
                    disabled={isSearchingModels}
                    onClick={() => void searchBaseModels()}
                    type="button"
                  >
                    <i className="fas fa-magnifying-glass" aria-hidden="true" />
                    {isSearchingModels ? "Searching" : "Search"}
                  </button>
                </div>
                <select
                  id="workshop-model"
                  value={draft.baseModel ?? ""}
                  onChange={(event) => updateDraft("baseModel", event.target.value)}
                >
                  {shouldShowCurrentOption && (
                    <option value={currentBaseModel}>{currentBaseModel} · Current</option>
                  )}
                  {cachedOptions.length > 0 && (
                    <optgroup label="Cached Archive">
                      {cachedOptions.map((option) => (
                        <option key={`cached-${option.id}`} value={option.id}>
                          {option.label} · {option.detail}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {remoteOptions.length > 0 && (
                    <optgroup label="Hugging Face results">
                      {remoteOptions.map((option) => (
                        <option key={`remote-${option.id}`} value={option.id}>
                          {option.label} · {option.detail}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {!shouldShowCurrentOption && cachedOptions.length === 0 && remoteOptions.length === 0 && (
                    <option value={defaultBaseModel}>{defaultBaseModel} · Settings default</option>
                  )}
                </select>
                <div className="workshop-model-selector-actions">
                  <button className="button-ghost" onClick={useTypedModelId} type="button">
                    Use typed ID
                  </button>
                  <span>
                    {searchUsesToken
                      ? "Search uses saved Hugging Face credentials."
                      : "Search shows public models until a token is saved."}
                  </span>
                </div>
                {modelSearchError && <p className="save-state error-state">{modelSearchError}</p>}
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="button-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button-primary" type="submit" disabled={isSaving}>
              <i className="fas fa-plus" aria-hidden="true" />
              {isSaving ? "Creating" : "Create Workshop"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

export default WorkshopCreateModal;
