import React, { useEffect, useMemo, useState } from "react";
import {
  ConfigureQAGeneratorRuntimeRequest,
  ImportMaterialFileRequest,
  IngestMaterialRequest,
  StartAssemblyLineRequest,
} from "../contracts/foundryApi";
import {
  AcademyAction,
  AssemblyLineRun,
  MaterialChunk,
  MaterialKind,
  MaterialSource,
  QAPair,
  QAGeneratorQualityProof,
  QAGeneratorRuntime,
  QAGeneratorSmokeProof,
  SectionSummary,
  Workshop,
} from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, LearningCard } from "./LearningComponents";

interface MaterialsWorkbenchProps {
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  academyAction?: AcademyAction;
  onOpenAcademy: () => void;
}

const materialKinds: Array<{ label: string; value: MaterialKind }> = [
  { label: "CSV", value: "csv" },
  { label: "PDF", value: "pdf" },
  { label: "Website", value: "website" },
  { label: "Transcript", value: "transcript" },
  { label: "Video transcript", value: "video-transcript" },
  { label: "Text", value: "text" },
  { label: "JSONL dataset", value: "jsonl" },
];

const importableMaterialKinds: ImportMaterialFileRequest["kind"][] = [
  "csv",
  "pdf",
  "transcript",
  "video-transcript",
  "text",
  "jsonl",
];

const inferMaterialKindFromFile = (fileName: string): ImportMaterialFileRequest["kind"] => {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }
  if (normalized.endsWith(".pdf")) {
    return "pdf";
  }
  if (normalized.endsWith(".jsonl") || normalized.endsWith(".ndjson")) {
    return "jsonl";
  }
  if (
    normalized.endsWith(".srt") ||
    normalized.endsWith(".vtt") ||
    normalized.endsWith(".transcript")
  ) {
    return "transcript";
  }
  return "text";
};

const materialNameFromFile = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

const qaTypeFromMetadata = (qaPair: QAPair): string | undefined => {
  const metadataType = qaPair.generationMetadata?.qaType;
  if (typeof metadataType === "string" && metadataType.trim()) {
    return metadataType;
  }
  const metricType = qaPair.qualityGate?.metrics?.qaType;
  if (typeof metricType === "string" && metricType.trim()) {
    return metricType;
  }
  return undefined;
};

const promptVersionFromMetadata = (qaPair: QAPair): string | undefined => {
  const prompt = qaPair.generationMetadata?.prompt;
  if (prompt && typeof prompt === "object" && "templateVersion" in prompt) {
    const templateVersion = (prompt as { templateVersion?: unknown }).templateVersion;
    return typeof templateVersion === "string" ? templateVersion : undefined;
  }
  const metricVersion = qaPair.qualityGate?.metrics?.promptTemplateVersion;
  return typeof metricVersion === "string" ? metricVersion : undefined;
};

const MaterialsWorkbench: React.FC<MaterialsWorkbenchProps> = ({
  repository,
  summary,
  workshop,
  academyAction,
  onOpenAcademy,
}) => {
  const [draft, setDraft] = useState<IngestMaterialRequest>({
    name: "",
    kind: "text",
    sourceUri: "",
  });
  const [materials, setMaterials] = useState<MaterialSource[]>([]);
  const [assemblyRuns, setAssemblyRuns] = useState<AssemblyLineRun[]>([]);
  const [reviewRunId, setReviewRunId] = useState<string | undefined>();
  const [reviewChunks, setReviewChunks] = useState<MaterialChunk[]>([]);
  const [reviewQAPairs, setReviewQAPairs] = useState<QAPair[]>([]);
  const [exportName, setExportName] = useState(`${workshop.name} QA Dataset`);
  const [exportState, setExportState] = useState<string | null>(null);
  const [includeDraftsInExport, setIncludeDraftsInExport] = useState(false);
  const [includeLowQualityInExport, setIncludeLowQualityInExport] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [assemblyDraft, setAssemblyDraft] = useState<StartAssemblyLineRequest>({
    materialSourceIds: [],
    chunkSizeTokens: 1024,
    chunkOverlapTokens: 128,
    qaPairsPerSource: 24,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingAssembly, setIsStartingAssembly] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [savingQAPairId, setSavingQAPairId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [qaGeneratorRuntime, setQAGeneratorRuntime] = useState<QAGeneratorRuntime | null>(null);
  const [qaGeneratorDraft, setQAGeneratorDraft] = useState<ConfigureQAGeneratorRuntimeRequest>({
    mode: "deterministic",
    modelId: "sshleifer/tiny-gpt2",
    maxNewTokens: 320,
    temperature: 0.2,
  });
  const [qaGeneratorSmokeProof, setQAGeneratorSmokeProof] =
    useState<QAGeneratorSmokeProof | null>(null);
  const [qaGeneratorQualityProof, setQAGeneratorQualityProof] =
    useState<QAGeneratorQualityProof | null>(null);
  const [isConfiguringGenerator, setIsConfiguringGenerator] = useState(false);
  const [isRunningGeneratorSmoke, setIsRunningGeneratorSmoke] = useState(false);
  const [isRunningGeneratorQualityProof, setIsRunningGeneratorQualityProof] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterials(workshop.id),
      repository.listAssemblyLineRuns(workshop.id),
      repository.getQAGeneratorRuntime(),
    ])
      .then(([sources, runs, runtime]) => {
        if (isCurrent) {
          setMaterials(sources);
          setAssemblyRuns(runs);
          setQAGeneratorRuntime(runtime);
          setQAGeneratorDraft({
            mode: runtime.mode,
            modelId: runtime.modelId,
            maxNewTokens: runtime.maxNewTokens,
            temperature: runtime.temperature,
          });
          setReviewRunId(runs[0]?.id);
          setSelectedMaterialIds(sources.filter((source) => source.status === "staged").map((source) => source.id));
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Materials.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, workshop.id]);

  useEffect(() => {
    setExportName(`${workshop.name} QA Dataset`);
    setExportState(null);
  }, [workshop.id, workshop.name]);

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterialChunks(workshop.id, reviewRunId),
      repository.listQAPairs(workshop.id, reviewRunId),
    ])
      .then(([chunks, qaPairs]) => {
        if (isCurrent) {
          setReviewChunks(chunks);
          setReviewQAPairs(qaPairs);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Assembly outputs.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, reviewRunId, workshop.id]);

  const materialStats = useMemo(() => {
    const chunks = materials.reduce((total, material) => total + material.chunkCount, 0);
    const qaPairs = materials.reduce((total, material) => total + material.qaPairCount, 0);

    return [
      { label: "Sources staged", value: materials.length.toLocaleString() },
      { label: "Chunks prepared", value: chunks.toLocaleString() },
      { label: "QA pairs", value: qaPairs.toLocaleString() },
    ];
  }, [materials]);

  const qaReviewStats = useMemo(() => {
    const accepted = reviewQAPairs.filter(
      (qaPair) => qaPair.reviewStatus === "accepted" || qaPair.reviewStatus === "edited"
    ).length;
    const rejected = reviewQAPairs.filter((qaPair) => qaPair.reviewStatus === "rejected").length;
    const draft = reviewQAPairs.length - accepted - rejected;
    const blocked = reviewQAPairs.filter(
      (qaPair) => qaPair.qualityGate?.status === "blocked"
    ).length;
    return { accepted, rejected, draft, blocked };
  }, [reviewQAPairs]);

  const updateDraft = <K extends keyof IngestMaterialRequest>(
    key: K,
    value: IngestMaterialRequest[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateAssemblyDraft = <K extends keyof StartAssemblyLineRequest>(
    key: K,
    value: StartAssemblyLineRequest[K]
  ) => {
    setAssemblyDraft((current) => ({ ...current, [key]: value }));
  };

  const updateQAGeneratorDraft = <K extends keyof ConfigureQAGeneratorRuntimeRequest>(
    key: K,
    value: ConfigureQAGeneratorRuntimeRequest[K]
  ) => {
    setQAGeneratorDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleMaterialSelection = (materialId: string) => {
    setSelectedMaterialIds((current) =>
      current.includes(materialId)
        ? current.filter((id) => id !== materialId)
        : [...current, materialId]
    );
  };

  const registerMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const trimmedName = draft.name.trim();
      if (!trimmedName) {
        throw new Error("Material name cannot be empty.");
      }
      const material = selectedFile
        ? await repository.importMaterialFile(workshop.id, {
            name: trimmedName,
            kind: importableMaterialKinds.includes(draft.kind as ImportMaterialFileRequest["kind"])
              ? (draft.kind as ImportMaterialFileRequest["kind"])
              : inferMaterialKindFromFile(selectedFile.name),
            file: selectedFile,
          })
        : await repository.registerMaterial(workshop.id, {
            ...draft,
            name: trimmedName,
            sourceUri: draft.sourceUri.trim(),
          });
      setMaterials((current) => [material, ...current.filter((item) => item.id !== material.id)]);
      setDraft({ name: "", kind: draft.kind, sourceUri: "" });
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Could not register Material.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    if (!file) {
      return;
    }
    const inferredKind = inferMaterialKindFromFile(file.name);
    setDraft((current) => ({
      ...current,
      name: current.name || materialNameFromFile(file.name) || file.name,
      kind: inferredKind,
      sourceUri: "",
    }));
  };

  const startAssemblyLine = async () => {
    setIsStartingAssembly(true);
    setError(null);

    try {
      const run = await repository.startAssemblyLine(workshop.id, {
        ...assemblyDraft,
        materialSourceIds: selectedMaterialIds,
      });
      setAssemblyRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setReviewRunId(run.id);
      const [chunks, qaPairs] = await Promise.all([
        repository.listMaterialChunks(workshop.id, run.id),
        repository.listQAPairs(workshop.id, run.id),
      ]);
      setReviewChunks(chunks);
      setReviewQAPairs(qaPairs);
      const refreshedMaterials = await repository.listMaterials(workshop.id);
      setMaterials(refreshedMaterials);
      setSelectedMaterialIds([]);
    } catch (assemblyError: unknown) {
      setError(
        assemblyError instanceof Error ? assemblyError.message : "Could not start Assembly Line."
      );
    } finally {
      setIsStartingAssembly(false);
    }
  };

  const configureQAGenerator = async () => {
    setIsConfiguringGenerator(true);
    setError(null);
    try {
      const runtime = await repository.configureQAGeneratorRuntime({
        ...qaGeneratorDraft,
        modelId: qaGeneratorDraft.modelId.trim() || "sshleifer/tiny-gpt2",
        maxNewTokens: Number(qaGeneratorDraft.maxNewTokens),
        temperature: Number(qaGeneratorDraft.temperature),
      });
      setQAGeneratorRuntime(runtime);
      setQAGeneratorDraft({
        mode: runtime.mode,
        modelId: runtime.modelId,
        maxNewTokens: runtime.maxNewTokens,
        temperature: runtime.temperature,
      });
      setQAGeneratorSmokeProof(null);
      setQAGeneratorQualityProof(null);
    } catch (runtimeError: unknown) {
      setError(runtimeError instanceof Error ? runtimeError.message : "Could not configure QA generator.");
    } finally {
      setIsConfiguringGenerator(false);
    }
  };

  const runQAGeneratorSmokeProof = async () => {
    setIsRunningGeneratorSmoke(true);
    setError(null);
    try {
      const smokeProof = await repository.runQAGeneratorSmokeProof();
      setQAGeneratorSmokeProof(smokeProof);
      setQAGeneratorRuntime(smokeProof.runtime);
    } catch (smokeError: unknown) {
      setError(smokeError instanceof Error ? smokeError.message : "Could not run QA generator smoke proof.");
    } finally {
      setIsRunningGeneratorSmoke(false);
    }
  };

  const runQAGeneratorQualityProof = async () => {
    setIsRunningGeneratorQualityProof(true);
    setError(null);
    try {
      const qualityProof = await repository.runQAGeneratorQualityProof();
      setQAGeneratorQualityProof(qualityProof);
      setQAGeneratorRuntime(qualityProof.runtime);
    } catch (proofError: unknown) {
      setError(proofError instanceof Error ? proofError.message : "Could not run QA quality proof.");
    } finally {
      setIsRunningGeneratorQualityProof(false);
    }
  };

  const exportQAPairs = async () => {
    if (!reviewRunId) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportState(null);

    try {
      const exportResult = await repository.exportQAPairs(workshop.id, {
        assemblyLineRunId: reviewRunId,
        name: exportName.trim() || `${workshop.name} QA Dataset`,
        includeDrafts: includeDraftsInExport,
        includeLowQuality: includeLowQualityInExport,
      });
      setMaterials((current) => [
        exportResult.material,
        ...current.filter((item) => item.id !== exportResult.material.id),
      ]);
      setExportState(
        `Exported ${exportResult.qaPairCount.toLocaleString()} QA pairs to ${exportResult.exportUri}`
      );
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Could not export QA pairs.");
    } finally {
      setIsExporting(false);
    }
  };

  const updateLocalQAPair = (qaPairId: string, updates: Partial<QAPair>) => {
    setReviewQAPairs((current) =>
      current.map((qaPair) => (qaPair.id === qaPairId ? { ...qaPair, ...updates } : qaPair))
    );
  };

  const saveQAPairReview = async (
    qaPair: QAPair,
    reviewStatus: QAPair["reviewStatus"] = qaPair.reviewStatus
  ) => {
    setSavingQAPairId(qaPair.id);
    setError(null);
    try {
      const saved = await repository.updateQAPairReview(workshop.id, qaPair.id, {
        question: qaPair.question,
        answer: qaPair.answer,
        reviewStatus,
      });
      updateLocalQAPair(qaPair.id, saved);
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not save QA review.");
    } finally {
      setSavingQAPairId(null);
    }
  };

  return (
    <section className="materials-workbench" aria-label="Materials workbench">
      <div className="workbench-hero panel-glass">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="status-badge is-forging">{workshop.name}</div>
      </div>

      <div className="workbench-grid">
        {materialStats.map((stat) => (
          <article className="stat-card panel-glass" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="materials-layout">
        <div className="materials-controls">
          <form className="material-form panel-glass" onSubmit={registerMaterial}>
          <div>
            <p className="section-eyebrow">Catalog</p>
            <h2>Add Material</h2>
          </div>

          <label className="field-label" htmlFor="material-name">Name</label>
          <input
            id="material-name"
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder="Episode summaries"
            required
          />

          <label className="field-label" htmlFor="material-file">Local file</label>
          <input
            key={fileInputKey}
            id="material-file"
            type="file"
            accept=".txt,.md,.markdown,.text,.csv,.jsonl,.ndjson,.pdf,.transcript,.srt,.vtt"
            onChange={handleFileSelection}
          />
          {selectedFile && (
            <p className="save-state">
              Importing {selectedFile.name} into controlled runtime storage.
            </p>
          )}

          <label className="field-label" htmlFor="material-kind">Material type</label>
          <select
            id="material-kind"
            value={draft.kind}
            onChange={(event) => updateDraft("kind", event.target.value as MaterialKind)}
          >
            {materialKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>{kind.label}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="material-source">Source path or URL</label>
          <input
            id="material-source"
            type="text"
            value={draft.sourceUri}
            onChange={(event) => updateDraft("sourceUri", event.target.value)}
            placeholder="runtime/materials/sources/episode-summaries.csv"
            required={!selectedFile}
            disabled={Boolean(selectedFile)}
          />

          <button className="button-primary" type="submit" disabled={isSaving}>
            <i className="fas fa-box-archive" aria-hidden="true" />
            {isSaving ? "Staging" : selectedFile ? "Import Material" : "Stage Material"}
          </button>
          {error && <p className="save-state error-state">{error}</p>}
          </form>

          <section className="assembly-panel panel-glass" aria-label="Assembly Line controls">
            <div>
              <p className="section-eyebrow">Assembly Line</p>
              <h2>Prepare QA Pairs</h2>
            </div>

            <div className="qa-generator-panel">
              <div className="runtime-readiness-header">
                <div>
                  <span className="panel-kicker">QA Generator</span>
                  <strong>{qaGeneratorRuntime?.status || "loading"}</strong>
                  <p>{qaGeneratorRuntime?.detail || "Reading generator runtime state..."}</p>
                </div>
                <span className={`status-badge ${qaGeneratorRuntime?.ready ? "is-active" : ""}`}>
                  {qaGeneratorRuntime?.ready ? "Ready" : "Review"}
                </span>
              </div>

              <div className="settings-grid">
                <div>
                  <label className="field-label" htmlFor="qa-generator-mode">Mode</label>
                  <select
                    id="qa-generator-mode"
                    value={qaGeneratorDraft.mode}
                    onChange={(event) =>
                      updateQAGeneratorDraft(
                        "mode",
                        event.target.value as ConfigureQAGeneratorRuntimeRequest["mode"]
                      )
                    }
                  >
                    <option value="deterministic">Deterministic smoke</option>
                    <option value="transformers">Local Transformers</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="qa-generator-model">Generator model</label>
                  <input
                    id="qa-generator-model"
                    type="text"
                    value={qaGeneratorDraft.modelId}
                    onChange={(event) => updateQAGeneratorDraft("modelId", event.target.value)}
                    placeholder="sshleifer/tiny-gpt2"
                  />
                </div>
              </div>

              <div className="settings-grid">
                <div>
                  <label className="field-label" htmlFor="qa-generator-max-tokens">Max new tokens</label>
                  <input
                    id="qa-generator-max-tokens"
                    type="number"
                    min={24}
                    max={2048}
                    step={16}
                    value={qaGeneratorDraft.maxNewTokens}
                    onChange={(event) =>
                      updateQAGeneratorDraft("maxNewTokens", Number(event.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="qa-generator-temperature">Temperature</label>
                  <input
                    id="qa-generator-temperature"
                    type="number"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={qaGeneratorDraft.temperature}
                    onChange={(event) =>
                      updateQAGeneratorDraft("temperature", Number(event.target.value))
                    }
                  />
                </div>
              </div>

              <div className="runtime-action-row">
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isConfiguringGenerator}
                  onClick={configureQAGenerator}
                >
                  {isConfiguringGenerator ? "Configuring" : "Configure"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isRunningGeneratorSmoke}
                  onClick={runQAGeneratorSmokeProof}
                >
                  {isRunningGeneratorSmoke ? "Testing" : "Smoke proof"}
                </button>
                <button
                  className="button-secondary button-compact"
                  type="button"
                  disabled={isRunningGeneratorQualityProof}
                  onClick={runQAGeneratorQualityProof}
                >
                  {isRunningGeneratorQualityProof ? "Comparing" : "Quality proof"}
                </button>
              </div>

              {qaGeneratorSmokeProof && (
                <div className={`qa-generator-proof qa-generator-proof-${qaGeneratorSmokeProof.status}`}>
                  <strong>{qaGeneratorSmokeProof.status}</strong>
                  <p>{qaGeneratorSmokeProof.summary}</p>
                  {qaGeneratorSmokeProof.rows[0] && (
                    <span>
                      {qaGeneratorSmokeProof.rows[0].generatorModel} /{" "}
                      {Math.round((qaGeneratorSmokeProof.rows[0].confidence || 0) * 100)}%
                    </span>
                  )}
                </div>
              )}

              {qaGeneratorQualityProof && (
                <div className="qa-quality-proof">
                  <p>{qaGeneratorQualityProof.recommendation}</p>
                  <div className="qa-quality-proof-grid">
                    {qaGeneratorQualityProof.results.map((result) => (
                      <article className="qa-quality-proof-card" key={result.label}>
                        <div className="runtime-readiness-header">
                          <div>
                            <span className="panel-kicker">{result.label}</span>
                            <strong>{Math.round(result.quality.score * 100)}% proof</strong>
                          </div>
                          <span className={`status-badge ${result.status === "passed" ? "is-active" : "quality-blocked"}`}>
                            {result.status}
                          </span>
                        </div>
                        <p>{result.detail}</p>
                        {result.rows[0] ? (
                          <blockquote>
                            <strong>{result.rows[0].question}</strong>
                            <span>{result.rows[0].answer}</span>
                          </blockquote>
                        ) : (
                          <span className="empty-state">No cached model row generated.</span>
                        )}
                        <div className="material-meta">
                          {result.quality.qaType && <span>{result.quality.qaType}</span>}
                          <span>{Math.round(result.quality.confidence * 100)}% confidence</span>
                          <span>{Math.round(result.quality.sourceOverlap * 100)}% overlap</span>
                          <span>{result.quality.answerLength} words</span>
                          {result.quality.groundedTerms && result.quality.groundedTerms.length > 0 && (
                            <span>Grounded: {result.quality.groundedTerms.join(", ")}</span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="settings-grid">
              <div>
                <label className="field-label" htmlFor="chunk-size">Chunk size</label>
                <input
                  id="chunk-size"
                  type="number"
                  min={128}
                  step={128}
                  value={assemblyDraft.chunkSizeTokens}
                  onChange={(event) => updateAssemblyDraft("chunkSizeTokens", Number(event.target.value))}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="chunk-overlap">Overlap</label>
                <input
                  id="chunk-overlap"
                  type="number"
                  min={0}
                  step={32}
                  value={assemblyDraft.chunkOverlapTokens}
                  onChange={(event) => updateAssemblyDraft("chunkOverlapTokens", Number(event.target.value))}
                />
              </div>
            </div>

            <label className="field-label" htmlFor="qa-pairs-per-source">QA pairs per source</label>
            <input
              id="qa-pairs-per-source"
              type="number"
              min={1}
              max={200}
              value={assemblyDraft.qaPairsPerSource}
              onChange={(event) => updateAssemblyDraft("qaPairsPerSource", Number(event.target.value))}
            />

            <button
              className="button-primary"
              type="button"
              disabled={isStartingAssembly || selectedMaterialIds.length === 0}
              onClick={startAssemblyLine}
            >
              <i className="fas fa-gears" aria-hidden="true" />
              {isStartingAssembly ? "Running" : "Start Assembly Line"}
            </button>
            <span className="selection-count">{selectedMaterialIds.length} selected</span>
          </section>
        </div>

        <div className="materials-catalog panel-glass">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Sources</p>
              <h2>Material Catalog</h2>
            </div>
          </div>
          <div className="material-list">
            {materials.map((material) => (
              <article className="material-row" key={material.id}>
                <label className="material-select" htmlFor={`material-${material.id}`}>
                  <input
                    id={`material-${material.id}`}
                    type="checkbox"
                    checked={selectedMaterialIds.includes(material.id)}
                    onChange={() => toggleMaterialSelection(material.id)}
                  />
                  <span className="sr-only">Select {material.name}</span>
                </label>
                <div>
                  <strong>{material.name}</strong>
                  <span>{material.sourceUri}</span>
                </div>
                <div className="material-meta">
                  <span>{material.kind}</span>
                  <span>{material.status}</span>
                  <span>{material.chunkCount} chunks</span>
                  <span>{material.qaPairCount} QA</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      <section className="assembly-runs panel-glass" aria-label="Assembly Line runs">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Assembly Line</p>
            <h2>Recent Runs</h2>
          </div>
        </div>
        <div className="assembly-run-list">
          {assemblyRuns.length === 0 ? (
            <p className="empty-state">No Assembly Line runs yet.</p>
          ) : (
            assemblyRuns.map((run) => (
              <button
                className={`assembly-run-row ${reviewRunId === run.id ? "is-active" : ""}`}
                key={run.id}
                onClick={() => setReviewRunId(run.id)}
                type="button"
              >
                <div>
                  <strong>{run.status}</strong>
                  <span>{run.materialSourceIds.length} Materials / {run.progress}%</span>
                </div>
                <div className="material-meta">
                  <span>{run.chunkCount} chunks</span>
                  <span>{run.qaPairCount} QA</span>
                  <span>{run.chunkSizeTokens} tokens</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="assembly-review panel-glass" aria-label="Assembly Line output review">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Review</p>
            <h2>Generated Chunks and QA</h2>
          </div>
          <div className="review-actions">
            <span className="status-badge">{reviewChunks.length} chunks / {reviewQAPairs.length} QA</span>
            <span className="status-badge">
              {qaReviewStats.accepted} accepted / {qaReviewStats.draft} draft
            </span>
            <span className={`status-badge ${qaReviewStats.blocked ? "quality-blocked" : "is-active"}`}>
              {qaReviewStats.blocked} quality blocked
            </span>
            <input
              aria-label="Exported Material name"
              type="text"
              value={exportName}
              onChange={(event) => setExportName(event.target.value)}
            />
            <label className="toggle-row qa-export-toggle">
              <input
                type="checkbox"
                checked={includeDraftsInExport}
                onChange={(event) => setIncludeDraftsInExport(event.target.checked)}
              />
              <span>Include draft rows</span>
            </label>
            <label className="toggle-row qa-export-toggle">
              <input
                type="checkbox"
                checked={includeLowQualityInExport}
                onChange={(event) => setIncludeLowQualityInExport(event.target.checked)}
              />
              <span>Override quality gate</span>
            </label>
            <button
              className="button-secondary"
              type="button"
              disabled={
                !reviewRunId ||
                reviewQAPairs.length === 0 ||
                (!includeDraftsInExport && qaReviewStats.accepted === 0) ||
                (!includeLowQualityInExport && qaReviewStats.blocked > 0) ||
                isExporting
              }
              onClick={exportQAPairs}
            >
              <i className="fas fa-file-export" aria-hidden="true" />
              {isExporting ? "Exporting" : "Export JSONL"}
            </button>
          </div>
        </div>
        {exportState && <p className="save-state success-state">{exportState}</p>}
        {qaReviewStats.blocked > 0 && !includeLowQualityInExport && (
          <p className="save-state error-state">
            Quality gate is blocking {qaReviewStats.blocked} QA row(s). Accept higher-quality rows or use the override.
          </p>
        )}
        <div className="assembly-review-grid">
          <div className="review-column">
            <h3>Chunks</h3>
            <div className="review-list">
              {reviewChunks.length === 0 ? (
                <p className="empty-state">Run the Assembly Line to inspect generated chunks.</p>
              ) : (
                reviewChunks.slice(0, 8).map((chunk) => (
                  <article className="review-card" key={chunk.id}>
                    <strong>Chunk {chunk.chunkIndex + 1} / {chunk.tokenCount} tokens</strong>
                    <p>{chunk.text}</p>
                  </article>
                ))
              )}
            </div>
          </div>
          <div className="review-column">
            <h3>QA Pairs</h3>
            <div className="review-list">
              {reviewQAPairs.length === 0 ? (
                <p className="empty-state">Generated QA pairs will appear here before Forge training.</p>
              ) : (
                reviewQAPairs.slice(0, 8).map((qaPair) => (
                  <article className="review-card qa-review-card" key={qaPair.id}>
                    <div className="qa-review-card-header">
                      <span className={`status-badge qa-status-${qaPair.reviewStatus}`}>
                        {qaPair.reviewStatus}
                      </span>
                      <span className="qa-generator-badge">
                        {qaPair.generatorModel || "generator pending"}
                      </span>
                      {typeof qaPair.confidence === "number" && (
                        <span className="qa-confidence-badge">
                          {Math.round(qaPair.confidence * 100)}% confidence
                        </span>
                      )}
                      {qaPair.qualityGate?.status === "blocked" && (
                        <span className="qa-quality-badge qa-quality-blocked">
                          quality blocked
                        </span>
                      )}
                      {qaTypeFromMetadata(qaPair) && (
                        <span className="qa-quality-badge">
                          {qaTypeFromMetadata(qaPair)}
                        </span>
                      )}
                      {qaPair.reviewedAt && (
                        <span className="qa-reviewed-time">
                          {new Date(qaPair.reviewedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    {qaPair.qualityGate?.status === "blocked" && (
                      <p className="qa-quality-note">
                        {qaPair.qualityGate.reasons.join("; ")}
                        {qaPair.qualityGate.metrics && (
                          <>
                            {" "}
                            Score {Math.round(qaPair.qualityGate.metrics.score * 100)}%,
                            overlap {Math.round(qaPair.qualityGate.metrics.sourceOverlap * 100)}%.
                          </>
                        )}
                      </p>
                    )}
                    <div className="qa-quality-learning-row">
                      <span>
                        QA type teaches the generator what kind of example this row is meant to become.
                      </span>
                      {promptVersionFromMetadata(qaPair) && (
                        <span>Prompt: {promptVersionFromMetadata(qaPair)}</span>
                      )}
                      {qaPair.qualityGate?.metrics?.groundedTerms &&
                        qaPair.qualityGate.metrics.groundedTerms.length > 0 && (
                          <span>
                            Grounded terms: {qaPair.qualityGate.metrics.groundedTerms.join(", ")}
                          </span>
                        )}
                    </div>
                    <label className="field-label" htmlFor={`qa-question-${qaPair.id}`}>
                      Question
                    </label>
                    <textarea
                      id={`qa-question-${qaPair.id}`}
                      value={qaPair.question}
                      onChange={(event) =>
                        updateLocalQAPair(qaPair.id, {
                          question: event.target.value,
                          reviewStatus: qaPair.reviewStatus === "accepted" ? "edited" : qaPair.reviewStatus,
                        })
                      }
                      rows={3}
                    />
                    <label className="field-label" htmlFor={`qa-answer-${qaPair.id}`}>
                      Answer
                    </label>
                    <textarea
                      id={`qa-answer-${qaPair.id}`}
                      value={qaPair.answer}
                      onChange={(event) =>
                        updateLocalQAPair(qaPair.id, {
                          answer: event.target.value,
                          reviewStatus: qaPair.reviewStatus === "accepted" ? "edited" : qaPair.reviewStatus,
                        })
                      }
                      rows={5}
                    />
                    <div className="qa-review-actions">
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair, "accepted")}
                      >
                        Accept
                      </button>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair, "rejected")}
                      >
                        Reject
                      </button>
                      <button
                        className="button-secondary button-compact"
                        type="button"
                        disabled={savingQAPairId === qaPair.id}
                        onClick={() => saveQAPairReview(qaPair)}
                      >
                        {savingQAPairId === qaPair.id ? "Saving" : "Save"}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={academyAction}
        onAction={onOpenAcademy}
      />

      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="What happens next?" />
      </div>
    </section>
  );
};

export default MaterialsWorkbench;
