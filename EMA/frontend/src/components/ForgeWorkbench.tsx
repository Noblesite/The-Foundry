import React, { useEffect, useMemo, useState } from "react";
import { StartForgeRequest } from "../contracts/foundryApi";
import { ForgeRun, MaterialSource, SectionSummary, TrainingMethod, Workshop } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { WorkspaceSettings } from "./SettingsOverlay";
import { ConceptTooltip, LearningCard, TrainingMetricExplainer } from "./LearningComponents";

interface ForgeWorkbenchProps {
  repository: FoundryRepository;
  settings: WorkspaceSettings;
  summary: SectionSummary;
  workshop: Workshop;
  onOpenAcademy: () => void;
}

const ForgeWorkbench: React.FC<ForgeWorkbenchProps> = ({
  repository,
  settings,
  summary,
  workshop,
  onOpenAcademy,
}) => {
  const [materials, setMaterials] = useState<MaterialSource[]>([]);
  const [forgeRuns, setForgeRuns] = useState<ForgeRun[]>([]);
  const [draft, setDraft] = useState<StartForgeRequest>({
    materialSetId: "",
    baseModel: settings.modelName,
    method: settings.trainingMethod,
    epochs: settings.epochs,
    learningRate: settings.learningRate,
    loadIn4Bit: settings.loadIn4Bit,
  });
  const [isStarting, setIsStarting] = useState(false);
  const [advancingRunId, setAdvancingRunId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    Promise.all([
      repository.listMaterials(workshop.id),
      repository.listForgeRuns(workshop.id),
    ])
      .then(([sources, runs]) => {
        if (!isCurrent) {
          return;
        }

        const jsonlMaterials = sources.filter((source) => source.kind === "jsonl");
        setMaterials(sources);
        setForgeRuns(runs);
        setDraft((current) => ({
          ...current,
          baseModel: settings.modelName,
          method: settings.trainingMethod,
          learningRate: settings.learningRate,
          loadIn4Bit: settings.loadIn4Bit,
          epochs: settings.epochs,
          materialSetId: current.materialSetId || jsonlMaterials[0]?.id || "",
        }));
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
    settings.epochs,
    settings.learningRate,
    settings.loadIn4Bit,
    settings.modelName,
    settings.trainingMethod,
    workshop.id,
  ]);

  const jsonlMaterials = useMemo(
    () => materials.filter((source) => source.kind === "jsonl"),
    [materials]
  );

  const selectedMaterial = useMemo(
    () => jsonlMaterials.find((source) => source.id === draft.materialSetId),
    [draft.materialSetId, jsonlMaterials]
  );

  const updateDraft = <K extends keyof StartForgeRequest>(
    key: K,
    value: StartForgeRequest[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const startForge = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsStarting(true);
    setError(null);
    setStatusText(null);

    try {
      const forgeRun = await repository.startForge(workshop.id, draft);
      setForgeRuns((current) => [forgeRun, ...current.filter((run) => run.id !== forgeRun.id)]);
      setStatusText(`${forgeRun.label} queued with ${selectedMaterial?.qaPairCount ?? 0} QA pairs.`);
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
              <p className="panel-kicker">Training contract</p>
              <h2>Queue a Forge</h2>
            </div>
          </div>

          <label className="field-label" htmlFor="forge-material">
            Training Material
          </label>
          <select
            id="forge-material"
            value={draft.materialSetId}
            onChange={(event) => updateDraft("materialSetId", event.target.value)}
            required
          >
            <option value="">Select exported JSONL Material</option>
            {jsonlMaterials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name} / {material.qaPairCount.toLocaleString()} QA
              </option>
            ))}
          </select>

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
            {isStarting ? "Queueing" : "Queue Forge"}
          </button>

          {jsonlMaterials.length === 0 && (
            <p className="save-state">
              Export QA pairs from Materials first, then they will appear here.
            </p>
          )}
          {statusText && <p className="save-state success-state">{statusText}</p>}
          {error && <p className="save-state error-state">{error}</p>}
        </form>

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
          <span className="status-badge">{forgeRuns.length} jobs</span>
        </div>
        <div className="assembly-run-list">
          {forgeRuns.length === 0 ? (
            <p className="empty-state">No Forge jobs queued yet.</p>
          ) : (
            forgeRuns.map((run) => (
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
                  {run.epoch && <span>Epoch {run.epoch.current} / {run.epoch.total}</span>}
                  {run.materialSetId && <span>{run.materialSetId}</span>}
                  {run.artifactId && <span>Artifact {run.artifactId}</span>}
                  <button
                    className="button-secondary button-compact"
                    type="button"
                    disabled={
                      advancingRunId === run.id ||
                      run.status === "completed" ||
                      run.status === "failed"
                    }
                    onClick={() => advanceSimulation(run.id)}
                  >
                    <i className="fas fa-forward-step" aria-hidden="true" />
                    {advancingRunId === run.id ? "Advancing" : "Run Step"}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        actionLabel="Open Academy"
        onAction={onOpenAcademy}
      />
    </section>
  );
};

export default ForgeWorkbench;
