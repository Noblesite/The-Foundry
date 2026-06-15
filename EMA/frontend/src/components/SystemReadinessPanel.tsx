import type {
  ConstructRuntime,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  WorkspaceSettings,
} from "../domain/foundry";
import {
  buildSystemReadinessSummary,
  SystemReadinessModelAction,
} from "../domain/systemReadiness";

interface SystemReadinessPanelProps {
  settings: WorkspaceSettings;
  sourceStatus?: FoundryRuntimeStatus | null;
  runtime?: ConstructRuntime | null;
  archiveEntries?: ModelArchiveEntry[];
  compact?: boolean;
  onPrepareModel?: (action: SystemReadinessModelAction) => void;
}

const stateIcon = {
  ready: "fa-check",
  caution: "fa-triangle-exclamation",
  blocked: "fa-xmark",
} as const;

const SystemReadinessPanel: React.FC<SystemReadinessPanelProps> = ({
  settings,
  sourceStatus,
  runtime,
  archiveEntries = [],
  compact = false,
  onPrepareModel,
}) => {
  const summary = buildSystemReadinessSummary(settings, sourceStatus, runtime, archiveEntries);
  const steps = compact ? summary.steps.slice(0, 4) : summary.steps;
  const actionDisabled = summary.modelAction.type === "ready";

  return (
    <section className={`system-readiness-card readiness-${summary.state}`}>
      <div className="system-readiness-header">
        <div>
          <p className="panel-kicker">System readiness</p>
          <h3>{summary.title}</h3>
          <p>{summary.detail}</p>
        </div>
        <span className={`status-badge readiness-${summary.state}`}>{summary.state}</span>
      </div>
      <div className="system-readiness-action">
        <div>
          <strong>{summary.modelAction.label}</strong>
          <span>{summary.modelAction.detail}</span>
        </div>
        <button
          className="button-secondary button-compact"
          disabled={actionDisabled}
          onClick={() => onPrepareModel?.(summary.modelAction)}
          type="button"
        >
          <i className="fas fa-wand-magic-sparkles" aria-hidden="true" />
          Prepare Model
        </button>
      </div>
      <div className="system-readiness-list">
        {steps.map((step) => (
          <article className={`system-readiness-step is-${step.state}`} key={step.id}>
            <i className={`fas ${stateIcon[step.state]}`} aria-hidden="true" />
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default SystemReadinessPanel;
