import React, { useEffect, useState } from "react";
import {
  ModelArchiveEntry,
  ModelSearchResult,
  WorkspaceSettings,
} from "../domain/foundry";

interface BaseModelSelectorProps {
  id: string;
  value?: string;
  defaultBaseModel: string;
  settings: WorkspaceSettings;
  archiveEntries?: ModelArchiveEntry[];
  onChange: (modelId: string) => void;
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

const BaseModelSelector: React.FC<BaseModelSelectorProps> = ({
  id,
  value = "",
  defaultBaseModel,
  settings,
  archiveEntries = [],
  onChange,
  onSearchBaseModels,
}) => {
  const currentBaseModel = value.trim();
  const [modelQuery, setModelQuery] = useState(currentBaseModel || defaultBaseModel);
  const [modelResults, setModelResults] = useState<ModelSearchResult[]>([]);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [modelSearchError, setModelSearchError] = useState<string | null>(null);

  useEffect(() => {
    setModelQuery(currentBaseModel || defaultBaseModel);
    setModelResults([]);
    setModelSearchError(null);
  }, [currentBaseModel, defaultBaseModel]);

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
  const shouldShowCurrentOption = Boolean(currentBaseModel && !optionIds.has(currentBaseModel));
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
        onChange(results[0].repoId);
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
      onChange(query);
    }
  };

  return (
    <div className="workshop-model-selector base-model-selector">
      <div className="workshop-model-search base-model-search">
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
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
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
      <div className="workshop-model-selector-actions base-model-selector-actions">
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
  );
};

export default BaseModelSelector;
