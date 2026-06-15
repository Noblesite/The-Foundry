import React, { useEffect, useState } from "react";
import {
  ConstructRuntimeDevice,
  ConstructRuntimeMode,
  ConstructRuntime,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  TrainingMethod,
  WorkspaceSettings,
  resolveDefaultBaseModel,
} from "../domain/foundry";
import { activeFoundryDataSource } from "../domain/dataSourceMode";
import {
  ModelPreparationActivity,
  SystemReadinessModelAction,
} from "../domain/systemReadiness";
import SystemReadinessPanel from "./SystemReadinessPanel";

export type { WorkspaceSettings };

interface SettingsPanelProps {
  settings: WorkspaceSettings;
  sourceStatus?: FoundryRuntimeStatus | null;
  runtime?: ConstructRuntime | null;
  archiveEntries?: ModelArchiveEntry[];
  preparationActivity?: ModelPreparationActivity;
  onPrepareModel?: (action: SystemReadinessModelAction) => void;
  onCancelPreparation?: () => void;
  onSave: (settings: WorkspaceSettings) => void;
}

interface HelpTooltipProps {
  text: string;
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({ text }) => (
  <span className="help-tooltip" tabIndex={0} aria-label={text}>
    <i className="fas fa-circle-question" aria-hidden="true" />
    <span className="help-tooltip-content">{text}</span>
  </span>
);

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  sourceStatus,
  runtime,
  archiveEntries = [],
  preparationActivity,
  onPrepareModel,
  onCancelPreparation,
  onSave,
}) => {
  const [draft, setDraft] = useState<WorkspaceSettings>(settings);
  const [saved, setSaved] = useState(false);
  const apiReachable = Boolean(sourceStatus?.api.reachable);
  const constructReachable = Boolean(sourceStatus?.construct.reachable);
  const catalogReachable = Boolean(sourceStatus?.catalog.reachable);
  const sourceBadge = sourceStatus
    ? apiReachable
      ? "Reachable"
      : activeFoundryDataSource.liveConstruct
        ? "Unreachable"
        : activeFoundryDataSource.badge
    : activeFoundryDataSource.badge;

  const updateDraft = <K extends keyof WorkspaceSettings>(
    key: K,
    value: WorkspaceSettings[K]
  ) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateDefaultBaseModel = (value: string) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      defaultBaseModel: value,
      modelName: value,
      constructModelId: value,
    }));
  };

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const saveSettings = () => {
    onSave(draft);
    setSaved(true);
  };

  return (
    <section className="settings-panel" aria-label="Foundry settings">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Configuration</p>
          <h2>Settings</h2>
        </div>
        <button className="icon-button" onClick={saveSettings} title="Save settings" aria-label="Save settings">
          <i className="fas fa-floppy-disk" aria-hidden="true" />
        </button>
      </div>

      <div className="settings-scroll">
        <fieldset className="settings-group runtime-source-panel">
          <legend>Runtime Source</legend>
          <div className="runtime-source-readout">
            <div>
              <span className="panel-kicker">Data mode</span>
              <strong>{activeFoundryDataSource.label}</strong>
              <p>{sourceStatus?.api.detail || activeFoundryDataSource.detail}</p>
            </div>
            <span className={`status-badge source-${activeFoundryDataSource.mode}`}>
              {sourceBadge}
            </span>
          </div>
          <div className="runtime-source-grid">
            <div>
              <span>Construct</span>
              <strong>
                {sourceStatus
                  ? constructReachable
                    ? `${sourceStatus.construct.mode || "runtime"} ${sourceStatus.construct.modelLoaded ? "loaded" : "ready"}`
                    : "Unavailable"
                  : activeFoundryDataSource.liveConstruct
                    ? "FastAPI"
                    : "Mock"}
              </strong>
            </div>
            <div>
              <span>Catalog</span>
              <strong>
                {sourceStatus
                  ? catalogReachable
                    ? sourceStatus.catalog.status
                    : "Unavailable"
                  : activeFoundryDataSource.liveCatalog
                    ? "FastAPI"
                    : "Mock"}
              </strong>
            </div>
            <div>
              <span>FastAPI</span>
              <strong>{apiReachable ? "Reachable" : "Offline"}</strong>
            </div>
            <div>
              <span>Model</span>
              <strong>
                {sourceStatus?.construct.modelLoaded
                  ? sourceStatus.construct.modelId || "Loaded"
                  : "Not loaded"}
              </strong>
            </div>
          </div>
        </fieldset>

        <SystemReadinessPanel
          settings={draft}
          sourceStatus={sourceStatus}
          runtime={runtime}
          archiveEntries={archiveEntries}
          preparationActivity={preparationActivity}
          onPrepareModel={onPrepareModel}
          onCancelPreparation={onCancelPreparation}
        />

        <fieldset className="settings-group">
          <legend>Provider</legend>
          <label className="field-label" htmlFor="hf-token">
            Hugging Face token
            <HelpTooltip text="The token lets the wrapper download gated models and push trained adapters when the backend supports it." />
          </label>
          <input
            id="hf-token"
            type="password"
            value={draft.huggingFaceToken}
            placeholder="hf_..."
            onChange={(event) => updateDraft("huggingFaceToken", event.target.value)}
          />

          <label className="field-label" htmlFor="default-base-model">
            Default base model
            <HelpTooltip text="The base model is the pretrained network before your subject-specific examples bend its behavior." />
          </label>
          <input
            id="default-base-model"
            type="text"
            value={resolveDefaultBaseModel(draft)}
            onChange={(event) => updateDefaultBaseModel(event.target.value)}
          />
        </fieldset>

        <fieldset className="settings-group">
          <legend>Persona</legend>
          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="subject-matter">
                Subject
                <HelpTooltip text="The subject becomes the data boundary for retrieval, QA generation, and fine tuning examples." />
              </label>
              <input
                id="subject-matter"
                type="text"
                value={draft.subjectMatter}
                onChange={(event) => updateDraft("subjectMatter", event.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="character-voice">
                Voice
                <HelpTooltip text="Voice is the behavior target the model should imitate after examples and adapters shape it." />
              </label>
              <input
                id="character-voice"
                type="text"
                value={draft.characterVoice}
                onChange={(event) => updateDraft("characterVoice", event.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>Materials Assembly Line</legend>
          <label className="field-label" htmlFor="source-directory">
            Materials directory
            <HelpTooltip text="Drop CSV, PDF, scraped pages, transcripts, and other raw inputs here before the Assembly Line builds structured QA pairs." />
          </label>
          <input
            id="source-directory"
            type="text"
            value={draft.sourceDirectory}
            onChange={(event) => updateDraft("sourceDirectory", event.target.value)}
          />

          <label className="field-label" htmlFor="output-directory">
            Material Set output
            <HelpTooltip text="Generated question-answer examples land here before review, filtering, and fine tuning." />
          </label>
          <input
            id="output-directory"
            type="text"
            value={draft.outputDirectory}
            onChange={(event) => updateDraft("outputDirectory", event.target.value)}
          />

          <label className="field-label" htmlFor="qa-pairs">
            QA pairs per source
            <HelpTooltip text="More pairs create broader coverage but also raise review cost and can repeat weak source material." />
          </label>
          <input
            id="qa-pairs"
            type="number"
            min={1}
            max={200}
            value={draft.qaPairsPerSource}
            onChange={(event) => updateDraft("qaPairsPerSource", Number(event.target.value))}
          />
        </fieldset>

        <fieldset className="settings-group">
          <legend>Inference</legend>
          <label className="field-label" htmlFor="construct-runtime-mode">
            Runtime mode
            <HelpTooltip text="Simulator streams deterministic fake tokens. Transformers attempts local Hugging Face model inference through the backend adapter." />
          </label>
          <select
            id="construct-runtime-mode"
            value={draft.constructRuntimeMode}
            onChange={(event) =>
              updateDraft("constructRuntimeMode", event.target.value as ConstructRuntimeMode)
            }
          >
            <option value="simulated">Simulator</option>
            <option value="transformers">Transformers</option>
          </select>

          <label className="field-label" htmlFor="construct-model-id">
            Runtime model id/path
            <HelpTooltip text="For Transformers mode, this can be a Hugging Face model id or a local model directory path." />
          </label>
          <input
            id="construct-model-id"
            type="text"
            value={draft.constructModelId}
            onChange={(event) => updateDraft("constructModelId", event.target.value)}
          />

          <label className="field-label" htmlFor="construct-device">
            Device preference
            <HelpTooltip text="Auto lets the backend choose CUDA, MPS, or CPU. Pick CPU for the safest local fallback." />
          </label>
          <select
            id="construct-device"
            value={draft.constructDevice}
            onChange={(event) =>
              updateDraft("constructDevice", event.target.value as ConstructRuntimeDevice)
            }
          >
            <option value="auto">Auto</option>
            <option value="cpu">CPU</option>
            <option value="cuda">CUDA</option>
            <option value="mps">MPS</option>
          </select>

          <label className="field-label" htmlFor="context-window">
            Context window
            <HelpTooltip text="The context window is how many tokens the model can consider at once, including chat history, retrieved documents, and its answer." />
          </label>
          <input
            id="context-window"
            type="number"
            min={512}
            step={512}
            value={draft.contextWindow}
            onChange={(event) => updateDraft("contextWindow", Number(event.target.value))}
          />

          <label className="field-label" htmlFor="max-new-tokens">
            Max new tokens
            <HelpTooltip text="This caps the number of tokens the model may generate after reading the prompt." />
          </label>
          <input
            id="max-new-tokens"
            type="number"
            min={32}
            step={32}
            value={draft.maxNewTokens}
            onChange={(event) => updateDraft("maxNewTokens", Number(event.target.value))}
          />

          <label className="field-label" htmlFor="temperature">
            Temperature: {draft.temperature.toFixed(2)}
            <HelpTooltip text="Temperature controls randomness. Lower values stay predictable; higher values explore more unusual wording." />
          </label>
          <input
            id="temperature"
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={draft.temperature}
            onChange={(event) => updateDraft("temperature", Number(event.target.value))}
          />

          <label className="field-label" htmlFor="top-p">
            Top-p: {draft.topP.toFixed(2)}
            <HelpTooltip text="Top-p trims the token choices to a probability mass, keeping generation focused without choosing only the single most likely token." />
          </label>
          <input
            id="top-p"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.topP}
            onChange={(event) => updateDraft("topP", Number(event.target.value))}
          />
        </fieldset>

        <fieldset className="settings-group">
          <legend>Forge</legend>
          <label className="field-label" htmlFor="training-method">
            Forge method
            <HelpTooltip text="LoRA trains small adapter matrices. QLoRA also quantizes the base model so training can run with less VRAM." />
          </label>
          <select
            id="training-method"
            value={draft.trainingMethod}
            onChange={(event) => updateDraft("trainingMethod", event.target.value as TrainingMethod)}
          >
            <option value="QLoRA">QLoRA</option>
            <option value="LoRA">LoRA</option>
          </select>

          <div className="settings-grid">
            <div>
              <label className="field-label" htmlFor="epochs">
                Epochs
                <HelpTooltip text="An epoch is one full pass over the training examples. Too many passes can overfit the voice." />
              </label>
              <input
                id="epochs"
                type="number"
                min={1}
                max={20}
                value={draft.epochs}
                onChange={(event) => updateDraft("epochs", Number(event.target.value))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="learning-rate">
                Learning rate
                <HelpTooltip text="Learning rate controls how strongly each batch changes the adapter weights." />
              </label>
              <input
                id="learning-rate"
                type="text"
                value={draft.learningRate}
                onChange={(event) => updateDraft("learningRate", event.target.value)}
              />
            </div>
          </div>

          <label className="toggle-row" htmlFor="load-in-4bit">
            <span>
              4-bit loading
              <HelpTooltip text="4-bit loading stores model weights in a smaller format to reduce VRAM pressure." />
            </span>
            <input
              id="load-in-4bit"
              type="checkbox"
              checked={draft.loadIn4Bit}
              onChange={(event) => updateDraft("loadIn4Bit", event.target.checked)}
            />
          </label>

          <label className="toggle-row" htmlFor="enable-streaming">
            <span>
              Token streaming
              <HelpTooltip text="Streaming sends each generated token to the UI as it arrives, which makes model latency visible." />
            </span>
            <input
              id="enable-streaming"
              type="checkbox"
              checked={draft.enableStreaming}
              onChange={(event) => updateDraft("enableStreaming", event.target.checked)}
            />
          </label>
        </fieldset>

        {saved && <p className="save-state">Foundry settings saved locally.</p>}
      </div>
    </section>
  );
};

export default SettingsPanel;
