import type {
  ConstructRuntime,
  FoundryRuntimeStatus,
  ModelArchiveEntry,
  WorkspaceSettings,
  Workshop,
} from "../domain/foundry";
import {
  buildSystemReadinessSummary,
  ModelPreparationActivity,
  SystemReadinessModelAction,
} from "../domain/systemReadiness";

interface WorkshopBaseModelCalloutProps {
  workshop: Workshop;
  modelId: string;
  settings: WorkspaceSettings;
  sourceStatus?: FoundryRuntimeStatus | null;
  runtime?: ConstructRuntime | null;
  archiveEntries: ModelArchiveEntry[];
  preparationActivity?: ModelPreparationActivity;
  onPrepareModel: (action: SystemReadinessModelAction) => void;
  onDismiss: () => void;
}

const actionInProgress = (activity?: ModelPreparationActivity) =>
  Boolean(activity && !["idle", "ready", "failed", "canceled"].includes(activity.state));

const WorkshopBaseModelCallout: React.FC<WorkshopBaseModelCalloutProps> = ({
  workshop,
  modelId,
  settings,
  sourceStatus,
  runtime,
  archiveEntries,
  preparationActivity,
  onPrepareModel,
  onDismiss,
}) => {
  const readiness = buildSystemReadinessSummary(
    {
      ...settings,
      defaultBaseModel: modelId,
      constructModelId: modelId,
    },
    sourceStatus,
    runtime,
    archiveEntries
  );
  const isPreparing = actionInProgress(preparationActivity);
  const isReady = readiness.modelAction.type === "ready";

  return (
    <section className={`workshop-base-model-callout readiness-${readiness.state}`}>
      <div className="workshop-base-model-copy">
        <p className="panel-kicker">First-run model prep</p>
        <h2>Prepare {workshop.name}'s base model</h2>
        <p>
          {modelId} is the foundation for this Workshop's Forge jobs, Artifacts,
          and Construct tests. Cache it now so later stations do not stop for
          model setup.
        </p>
        <div className="workshop-base-model-meta">
          <span className={`status-badge readiness-${readiness.state}`}>
            {readiness.state}
          </span>
          <span>{readiness.modelAction.detail}</span>
        </div>
      </div>
      <div className="workshop-base-model-actions">
        <button
          className="button-primary button-compact"
          disabled={isReady || isPreparing}
          onClick={() => onPrepareModel(readiness.modelAction)}
          type="button"
        >
          <i className="fas fa-box-archive" aria-hidden="true" />
          {isPreparing ? "Preparing" : isReady ? "Base Model Ready" : readiness.modelAction.label}
        </button>
        <button
          aria-label="Dismiss base model preparation callout"
          className="button-secondary button-compact"
          onClick={onDismiss}
          type="button"
        >
          Later
        </button>
      </div>
    </section>
  );
};

export default WorkshopBaseModelCallout;
