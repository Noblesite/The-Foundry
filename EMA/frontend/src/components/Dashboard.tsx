import React, { useMemo, useState } from "react";
import {
  AcademyAction,
  ConstructRuntime,
  DashboardLoopEvidence,
  DashboardSummary,
  FoundryLoopFocus,
  NavigationSection,
} from "../domain/foundry";
import {
  ArtifactEvidenceAction,
  ArtifactEvidenceSummary,
  getArtifactEvidenceAction,
} from "../domain/artifactEvidence";
import {
  formatRuntimeMemory,
  getLoadedModelSnapshot,
  getRuntimeMemory,
  shortModelId,
} from "../domain/runtimeState";
import {
  AcademyActionTooltip,
  LearningAction,
  LearningCard,
  ProcessExplainer,
} from "./LearningComponents";
import ProgressRing from "./ProgressRing";

interface DashboardProps {
  summary: DashboardSummary;
  artifactEvidence: ArtifactEvidenceSummary;
  onCreateWorkshop: () => void;
  onRunConstruct: () => void;
  onArtifactEvidenceAction: (action: ArtifactEvidenceAction) => void;
  onViewQueue: () => void;
  academyAction?: AcademyAction;
  learningLoopAction?: AcademyAction;
  loopEvidence?: DashboardLoopEvidence | null;
  isLoopEvidenceRefreshing?: boolean;
  runtime?: ConstructRuntime | null;
  onResumeLesson: () => void;
  onOpenLearningLoop: () => void;
  onOpenLoopStep: (focus: FoundryLoopFocus) => void;
}

type LoopStepState = "complete" | "active" | "pending";

interface LoopStep {
  label: string;
  detail: string;
  evidenceReason: string;
  state: LoopStepState;
  destination: NavigationSection;
  actionLabel: string;
  targetLabel: string;
  focusTitle: string;
  focusDetail: string;
}

const stepStateLabel: Record<LoopStepState, string> = {
  complete: "Complete",
  active: "Active",
  pending: "Pending",
};

const LOOP_TOUR_STORAGE_KEY = "foundry.loopTour.dismissed";
const LOOP_TOUR_STEP_LABELS = new Set([
  "Material",
  "Assembly Line",
  "QA Review",
  "JSONL Material",
  "Forge",
]);

const buildLoopSteps = (
  summary: DashboardSummary,
  evidence?: DashboardLoopEvidence | null,
  runtime?: ConstructRuntime | null
): LoopStep[] => {
  const { currentArtifact, forgeQueue } = summary;
  const activeForge = forgeQueue.some((job) => job.status === "queued" || job.status === "running");
  const materialCount = evidence?.materialCount ?? 0;
  const chunkCount = evidence?.chunkCount ?? 0;
  const qaPairCount = evidence?.qaPairCount ?? 0;
  const acceptedQAPairCount = evidence?.acceptedQAPairCount ?? 0;
  const blockedQAPairCount = evidence?.blockedQAPairCount ?? 0;
  const jsonlMaterialCount = evidence?.jsonlMaterialCount ?? 0;
  const completedAssemblyRunCount = evidence?.completedAssemblyRunCount ?? 0;
  const activeAssemblyRunCount = evidence?.activeAssemblyRunCount ?? 0;
  const activeForgeRunCount = evidence?.activeForgeRunCount ?? (activeForge ? forgeQueue.length : 0);
  const completedForgeRunCount =
    evidence?.completedForgeRunCount ??
    forgeQueue.filter((job) => job.status === "completed").length;
  const artifactCount = evidence?.artifactCount ?? (currentArtifact.id ? 1 : 0);
  const readyArtifactCount =
    evidence?.readyArtifactCount ??
    (currentArtifact.status === "ready" ||
    currentArtifact.readiness?.status === "verified" ||
    currentArtifact.readiness?.canLoad === true
      ? 1
      : 0);
  const trialCount = evidence?.trialCount ?? (currentArtifact.trialScore > 0 ? 1 : 0);
  const adapterBackedTrialCount = evidence?.adapterBackedTrialCount ?? 0;
  const artifactExists = artifactCount > 0 || Boolean(currentArtifact.id);
  const artifactReady =
    readyArtifactCount > 0 ||
    currentArtifact.status === "ready" ||
    currentArtifact.readiness?.status === "verified" ||
    currentArtifact.readiness?.canLoad === true;
  const constructReady = Boolean(runtime?.loaded);
  const trialReady = trialCount > 0 || currentArtifact.trialScore > 0;

  return [
    {
      label: "Material",
      detail: materialCount ? `${materialCount} source${materialCount === 1 ? "" : "s"} cataloged` : "No sources yet",
      evidenceReason: materialCount
        ? "Complete because the catalog has source Material to build from."
        : "Active because this Workshop still needs its first source Material.",
      state: materialCount > 0 ? "complete" : "active",
      destination: "materials",
      actionLabel: "Open Materials",
      targetLabel: "Source material panel",
      focusTitle: "Start with source Material",
      focusDetail:
        "Add or inspect the raw files, pages, transcripts, or JSONL rows that become training evidence.",
    },
    {
      label: "Assembly Line",
      detail: activeAssemblyRunCount
        ? `${activeAssemblyRunCount} run${activeAssemblyRunCount === 1 ? "" : "s"} active`
        : chunkCount
          ? `${chunkCount} chunks prepared`
          : "No chunks yet",
      evidenceReason:
        completedAssemblyRunCount > 0 || chunkCount > 0
          ? `Complete because ${chunkCount.toLocaleString()} source chunks are available.`
          : activeAssemblyRunCount > 0
            ? "Active because an Assembly Line run is processing source Material."
            : materialCount > 0
              ? "Active because Material exists and is ready to chunk."
              : "Pending until at least one Material is cataloged.",
      state:
        completedAssemblyRunCount > 0 || chunkCount > 0
          ? "complete"
          : activeAssemblyRunCount > 0 || materialCount > 0
            ? "active"
            : "pending",
      destination: "materials",
      actionLabel: "Open Assembly Line",
      targetLabel: "Assembly Line runs",
      focusTitle: "Check chunking and QA generation",
      focusDetail:
        "Review the Assembly Line run that chunks source text and creates candidate QA pairs.",
    },
    {
      label: "QA Review",
      detail: acceptedQAPairCount
        ? `${acceptedQAPairCount} approved`
        : qaPairCount
          ? `${qaPairCount} waiting review`
          : "No QA pairs yet",
      evidenceReason: acceptedQAPairCount
        ? `Complete because ${acceptedQAPairCount.toLocaleString()} QA pairs are approved.`
        : qaPairCount
          ? "Active because generated QA pairs are waiting for human review."
          : "Pending until the Assembly Line generates QA pairs.",
      state: acceptedQAPairCount > 0 ? "complete" : qaPairCount > 0 ? "active" : "pending",
      destination: "materials",
      actionLabel: "Review QA",
      targetLabel: "Generated Chunks and QA",
      focusTitle: "Review generated QA pairs",
      focusDetail:
        "Approve, edit, or reject generated QA pairs before they become training Material.",
    },
    {
      label: "JSONL Material",
      detail: jsonlMaterialCount
        ? `${jsonlMaterialCount} JSONL Material${jsonlMaterialCount === 1 ? "" : "s"}`
        : blockedQAPairCount
          ? `${blockedQAPairCount} quality blocked`
          : "No export yet",
      evidenceReason: jsonlMaterialCount
        ? "Complete because approved QA has been exported as JSONL Material."
        : acceptedQAPairCount > 0
          ? "Active because approved QA pairs are ready for JSONL preview and export."
          : blockedQAPairCount > 0
            ? "Pending because QA rows are blocked by the quality gate."
            : "Pending until reviewed QA pairs are accepted.",
      state: jsonlMaterialCount > 0 ? "complete" : acceptedQAPairCount > 0 ? "active" : "pending",
      destination: "materials",
      actionLabel: "Preview JSONL",
      targetLabel: "JSONL Preview",
      focusTitle: "Validate Forge-ready JSONL",
      focusDetail:
        "Preview schema checks and source references before exporting approved QA pairs.",
    },
    {
      label: "Forge",
      detail: activeForgeRunCount
        ? `${activeForgeRunCount} active job${activeForgeRunCount === 1 ? "" : "s"}`
        : completedForgeRunCount
          ? `${completedForgeRunCount} completed`
          : "Training contract",
      evidenceReason:
        completedForgeRunCount > 0 || currentArtifact.forgeRunId
          ? "Complete because at least one Forge has produced training output."
          : activeForgeRunCount > 0
            ? "Active because Forge jobs are queued or running."
            : jsonlMaterialCount > 0
              ? "Active because JSONL Material is ready for a training contract."
              : "Pending until a JSONL Material exists.",
      state:
        completedForgeRunCount > 0 || currentArtifact.forgeRunId
          ? "complete"
          : activeForgeRunCount > 0 || jsonlMaterialCount > 0
            ? "active"
            : "pending",
      destination: "forge",
      actionLabel: activeForge ? "View Forge Queue" : "Open Forge",
      targetLabel: activeForge ? "Forge Queue" : "Queue a Forge",
      focusTitle: activeForge ? "Watch active Forge jobs" : "Create a training contract",
      focusDetail:
        "Select an exported JSONL Material and verify the method, base model, and local proof settings.",
    },
    {
      label: "Artifact",
      detail: readyArtifactCount
        ? `${readyArtifactCount} ready`
        : artifactCount
          ? `${artifactCount} candidate${artifactCount === 1 ? "" : "s"}`
          : currentArtifact.status,
      evidenceReason: artifactReady
        ? "Complete because at least one Artifact is ready to inspect or load."
        : artifactExists
          ? "Active because Artifact metadata exists but readiness still needs review."
          : "Pending until a Forge creates or registers an Artifact.",
      state: artifactReady ? "complete" : artifactExists ? "active" : "pending",
      destination: "artifacts",
      actionLabel: "Inspect Artifact",
      targetLabel: "Artifact Catalog",
      focusTitle: "Inspect Artifact readiness",
      focusDetail:
        "Confirm the Forge output, readiness checks, adapter metadata, and Construct load path.",
    },
    {
      label: "Construct",
      detail: constructReady ? `Loaded on ${runtime?.device || "runtime"}` : "Load and stream",
      evidenceReason: constructReady
        ? "Complete because the local runtime reports a loaded Construct."
        : artifactReady
          ? "Active because a ready Artifact can now be loaded into Construct."
          : "Pending until an Artifact passes readiness.",
      state: constructReady ? "complete" : artifactReady ? "active" : "pending",
      destination: "construct",
      actionLabel: "Open Construct",
      targetLabel: "Local runtime",
      focusTitle: "Load and talk to the Construct",
      focusDetail:
        "Load the selected model or adapter-backed Artifact, then stream a response from the local runtime.",
    },
    {
      label: "Trial",
      detail: trialReady
        ? `${trialCount || 1} saved${adapterBackedTrialCount ? ` / ${adapterBackedTrialCount} adapter-backed` : ""}`
        : "Save verdicts",
      evidenceReason: trialReady
        ? "Complete because Trial verdicts have been saved as evaluation evidence."
        : constructReady
          ? "Active because Construct replies can now be saved as Trial verdicts."
          : "Pending until a Construct is loaded and produces replies.",
      state: trialReady ? "complete" : constructReady ? "active" : "pending",
      destination: "trials",
      actionLabel: "Open Trials",
      targetLabel: "Saved Trials",
      focusTitle: "Record Trial evidence",
      focusDetail:
        "Save verdicts, compare repeated prompts, and export weak samples back into Materials when needed.",
    },
  ];
};

const loopStepToFocus = (step: LoopStep): FoundryLoopFocus => ({
  id: `dashboard-loop-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  section: step.destination,
  stepLabel: step.label,
  title: step.focusTitle,
  detail: step.focusDetail,
  actionLabel: step.actionLabel,
  targetLabel: step.targetLabel,
  requestedAt: Date.now(),
});

const formatEvidenceRefresh = (updatedAt?: string) => {
  if (!updatedAt) {
    return "Waiting for evidence";
  }

  const updatedDate = new Date(updatedAt);
  if (Number.isNaN(updatedDate.getTime())) {
    return "Evidence timestamp unavailable";
  }

  return `Evidence refreshed ${updatedDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
};

const formatEvidenceCount = (value?: number) => (value ?? 0).toLocaleString();

const readLoopTourPreference = () => {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem(LOOP_TOUR_STORAGE_KEY) !== "true";
};

const writeLoopTourPreference = (isDismissed: boolean) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (isDismissed) {
      window.localStorage.setItem(LOOP_TOUR_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(LOOP_TOUR_STORAGE_KEY);
    }
  } catch {
    // Local storage is optional; the tour should still work without it.
  }
};

const Dashboard: React.FC<DashboardProps> = ({
  summary,
  artifactEvidence,
  onCreateWorkshop,
  onRunConstruct,
  onArtifactEvidenceAction,
  onViewQueue,
  academyAction,
  learningLoopAction,
  loopEvidence,
  isLoopEvidenceRefreshing = false,
  runtime,
  onResumeLesson,
  onOpenLearningLoop,
  onOpenLoopStep,
}) => {
  const { workshop, currentArtifact, forgeQueue, academyLesson } = summary;
  const loadedModel = getLoadedModelSnapshot(runtime);
  const runtimeMemory = getRuntimeMemory(runtime);
  const runtimeStatus = runtime?.loaded ? "Runtime loaded" : "Runtime idle";
  const loopSteps = buildLoopSteps(summary, loopEvidence, runtime);
  const artifactEvidenceAction = useMemo(
    () => getArtifactEvidenceAction(currentArtifact, artifactEvidence),
    [artifactEvidence, currentArtifact]
  );
  const tourSteps = useMemo(
    () => loopSteps.filter((step) => LOOP_TOUR_STEP_LABELS.has(step.label)),
    [loopSteps]
  );
  const [isLoopTourVisible, setIsLoopTourVisible] = useState(readLoopTourPreference);
  const [activeTourStepIndex, setActiveTourStepIndex] = useState(0);
  const activeTourStep =
    tourSteps[Math.min(activeTourStepIndex, Math.max(tourSteps.length - 1, 0))];
  const activeLoopStep = loopSteps.find((step) => step.state === "active");
  const nextRequiredStep =
    activeLoopStep ||
    loopSteps.find((step) => step.state === "pending") ||
    loopSteps[loopSteps.length - 1];
  const completedLoopSteps = loopSteps.filter((step) => step.state === "complete").length;
  const evidenceRefreshLabel = isLoopEvidenceRefreshing
    ? "Refreshing evidence"
    : formatEvidenceRefresh(loopEvidence?.updatedAt);
  const evidenceRows = [
    {
      label: "Materials",
      value: formatEvidenceCount(loopEvidence?.materialCount),
      detail: `${formatEvidenceCount(loopEvidence?.chunkCount)} chunks prepared`,
    },
    {
      label: "QA Review",
      value: formatEvidenceCount(loopEvidence?.acceptedQAPairCount),
      detail: `${formatEvidenceCount(loopEvidence?.qaPairCount)} total / ${formatEvidenceCount(
        loopEvidence?.blockedQAPairCount
      )} quality blocked`,
    },
    {
      label: "JSONL Material",
      value: formatEvidenceCount(loopEvidence?.jsonlMaterialCount),
      detail: "Forge-ready exports",
    },
    {
      label: "Forge",
      value: formatEvidenceCount(loopEvidence?.activeForgeRunCount),
      detail: `${formatEvidenceCount(loopEvidence?.completedForgeRunCount)} completed`,
    },
    {
      label: "Artifacts",
      value: formatEvidenceCount(loopEvidence?.readyArtifactCount),
      detail: `${formatEvidenceCount(loopEvidence?.artifactCount)} registered`,
    },
    {
      label: "Trials",
      value: formatEvidenceCount(loopEvidence?.trialCount),
      detail: `${formatEvidenceCount(loopEvidence?.adapterBackedTrialCount)} adapter-backed`,
    },
  ];
  const dismissLoopTour = () => {
    setIsLoopTourVisible(false);
    writeLoopTourPreference(true);
  };
  const restartLoopTour = () => {
    setActiveTourStepIndex(0);
    setIsLoopTourVisible(true);
    writeLoopTourPreference(false);
  };
  const goToNextTourStep = () => {
    if (activeTourStepIndex >= tourSteps.length - 1) {
      dismissLoopTour();
      return;
    }

    setActiveTourStepIndex((currentIndex) => currentIndex + 1);
  };
  const goToPreviousTourStep = () => {
    setActiveTourStepIndex((currentIndex) => Math.max(0, currentIndex - 1));
  };

  return (
    <section className="dashboard-page" aria-label="Workshop dashboard">
      <div className="dashboard-hero panel-glass">
        <div>
          <p className="section-eyebrow">Build Intelligence. Understand Everything.</p>
          <h1>Welcome back, Engineer.</h1>
          <p>What are we building today?</p>
        </div>
        <button className="button-primary" onClick={onCreateWorkshop}>
          <i className="fas fa-plus" aria-hidden="true" />
          New Workshop
        </button>
      </div>

      <ProcessExplainer />

      <section className="learning-loop-map panel-glass" aria-label="Foundry learning loop progress">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Academy progress</p>
            <h2>Foundry Learning Loop</h2>
          </div>
          <div className="runtime-load-actions">
            <details className="learning-loop-evidence-popover">
              <summary
                className={`learning-loop-evidence-time ${
                  isLoopEvidenceRefreshing ? "is-refreshing" : ""
                }`}
                aria-label={`${evidenceRefreshLabel}. Open evidence details.`}
              >
                <time
                  dateTime={loopEvidence?.updatedAt || undefined}
                  title={
                    loopEvidence?.updatedAt
                      ? new Date(loopEvidence.updatedAt).toLocaleString()
                      : undefined
                  }
                  aria-live="polite"
                >
                  <i className="fas fa-rotate" aria-hidden="true" />
                  {evidenceRefreshLabel}
                </time>
              </summary>
              <div className="learning-loop-evidence-panel" role="group" aria-label="Loop evidence details">
                <div>
                  <p className="panel-kicker">Backend evidence</p>
                  <strong>Why the loop is where it is</strong>
                </div>
                <dl>
                  {evidenceRows.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>
                        <strong>{row.value}</strong>
                        <span>{row.detail}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
            <span className="status-badge">
              {completedLoopSteps}/{loopSteps.length} complete
            </span>
            <AcademyActionTooltip action={learningLoopAction} label="Where am I?" />
          </div>
        </div>
        {isLoopTourVisible && activeTourStep ? (
          <article className="loop-tour-card" aria-label="First-run loop tour">
            <div className="loop-tour-copy">
              <div className="loop-tour-progress">
                <span>First-run tour</span>
                <strong>
                  {activeTourStepIndex + 1}/{tourSteps.length}
                </strong>
              </div>
              <h3>{activeTourStep.label}</h3>
              <p>{activeTourStep.focusDetail}</p>
              <span className={`status-badge is-${activeTourStep.state}`}>
                {stepStateLabel[activeTourStep.state]}
              </span>
            </div>
            <div className="loop-tour-steps" aria-label="Tour steps" role="list">
              {tourSteps.map((step, index) => (
                <button
                  aria-current={index === activeTourStepIndex ? "step" : undefined}
                  className={`loop-tour-step ${index === activeTourStepIndex ? "is-active" : ""}`}
                  key={step.label}
                  onClick={() => setActiveTourStepIndex(index)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  {step.label}
                </button>
              ))}
            </div>
            <div className="loop-tour-actions">
              <button
                className="button-secondary button-compact"
                disabled={activeTourStepIndex === 0}
                onClick={goToPreviousTourStep}
                type="button"
              >
                Previous
              </button>
              <button
                className="button-primary button-compact"
                onClick={() => onOpenLoopStep(loopStepToFocus(activeTourStep))}
                type="button"
              >
                Open tour target
                <i className="fas fa-arrow-right" aria-hidden="true" />
              </button>
              <button className="button-secondary button-compact" onClick={goToNextTourStep} type="button">
                {activeTourStepIndex >= tourSteps.length - 1 ? "Finish tour" : "Next"}
              </button>
              <button className="button-ghost button-compact" onClick={dismissLoopTour} type="button">
                Skip tour
              </button>
            </div>
          </article>
        ) : null}
        <div className="learning-loop-rail">
          {loopSteps.map((step, index) => {
            const reasonId = `learning-loop-reason-${index + 1}`;
            return (
              <button
                aria-describedby={reasonId}
                aria-label={`${step.actionLabel}: ${step.label} is ${stepStateLabel[step.state]}`}
                className={`learning-loop-step is-${step.state}`}
                key={step.label}
                onClick={() => onOpenLoopStep(loopStepToFocus(step))}
                type="button"
              >
                <span className="learning-loop-index">{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <span className="learning-loop-reason" id={reasonId}>
                  {step.evidenceReason}
                </span>
                <em>
                  {stepStateLabel[step.state]}
                  <i className="fas fa-arrow-right" aria-hidden="true" />
                </em>
              </button>
            );
          })}
        </div>
        <div className="learning-loop-footer">
          <span>
            Current focus: {nextRequiredStep.label}
          </span>
          <span className="learning-loop-evidence-note">
            {isLoopEvidenceRefreshing
              ? "Updating the map from backend evidence now."
              : loopEvidence
              ? "Station actions update this map from backend evidence."
              : "The map is using fallback evidence until the backend responds."}
          </span>
          <div className="learning-loop-actions">
            <button
              aria-label={`Resume next required action: ${nextRequiredStep.actionLabel} in ${nextRequiredStep.targetLabel}`}
              className="button-primary button-compact learning-loop-resume-action"
              onClick={() => onOpenLoopStep(loopStepToFocus(nextRequiredStep))}
              type="button"
            >
              Resume next required action
              <i className="fas fa-arrow-right" aria-hidden="true" />
            </button>
            <span className="learning-loop-resume-target">
              {nextRequiredStep.actionLabel} / {nextRequiredStep.targetLabel}
            </span>
            {!isLoopTourVisible ? (
              <button
                className="button-secondary button-compact"
                onClick={restartLoopTour}
                type="button"
              >
                Start loop tour
              </button>
            ) : null}
            <LearningAction
              action={learningLoopAction}
              className="button-secondary button-compact"
              fallbackLabel="Learn the loop"
              onOpen={onOpenLearningLoop}
            />
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <article className="dashboard-card panel-glass active-workshop-card">
          <div className="card-header">
            <div>
              <span>Active Workshop</span>
              <h2>{workshop.name}</h2>
            </div>
            <span className="status-badge is-forging">Forge in progress</span>
          </div>
          <ProgressRing value={workshop.progress} label="complete" />
          <div className="mini-progress">
            <span>Material refinement</span>
            <div><i style={{ width: `${workshop.materialRefinement}%` }} /></div>
          </div>
        </article>

        <article className="dashboard-card panel-glass artifact-card">
          <div className="card-header">
            <div>
              <span>Current Artifact</span>
              <h2>{currentArtifact.name}</h2>
            </div>
            <span className="status-badge">{currentArtifact.version}</span>
          </div>
          <div className="artifact-core" aria-hidden="true">
            <i className="fas fa-cube" />
          </div>
          <div className={`dashboard-artifact-evidence readiness-${artifactEvidence.status}`}>
            <div>
              <span>Evidence</span>
              <strong>{artifactEvidence.title}</strong>
            </div>
            <span className={`status-badge readiness-${artifactEvidence.status}`}>
              {artifactEvidence.status}
            </span>
            <p>{artifactEvidence.summary}</p>
            <button
              className="button-secondary button-compact"
              onClick={() => onArtifactEvidenceAction(artifactEvidenceAction)}
              type="button"
            >
              <i className={`fas ${artifactEvidenceAction.icon}`} aria-hidden="true" />
              {artifactEvidenceAction.label}
            </button>
          </div>
          <div className="dashboard-runtime-strip">
            <span className={`status-badge ${runtime?.loaded ? "is-active" : ""}`}>
              {runtimeStatus}
            </span>
            <div>
              <span>Model</span>
              <strong>{shortModelId(loadedModel.modelId)}</strong>
            </div>
            <div>
              <span>Device</span>
              <strong>{loadedModel.device || runtime?.device || "none"}</strong>
            </div>
            <div>
              <span>Memory</span>
              <strong>{formatRuntimeMemory(runtimeMemory)}</strong>
            </div>
          </div>
          <button className="button-secondary" onClick={onRunConstruct}>
            <i className="fas fa-play" aria-hidden="true" />
            Run Construct
          </button>
        </article>

        <article className="dashboard-card panel-glass forge-queue-card">
          <div className="card-header">
            <div>
              <span>Forge Queue</span>
              <h2>{forgeQueue.length} jobs running</h2>
            </div>
          </div>
          <div className="queue-list">
            {forgeQueue.map((job) => (
              <div className="queue-item" key={job.id}>
                <div>
                  <span>{job.label}</span>
                  <strong>{job.progress}%</strong>
                </div>
                <div className="queue-track">
                  <i style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
          <button className="button-secondary" onClick={onViewQueue}>View Queue</button>
        </article>

        <article className="dashboard-card panel-glass academy-card">
          <div className="card-header">
            <div>
              <span>Academy</span>
              <h2>Continue learning</h2>
            </div>
          </div>
          <div className="academy-orbit" aria-hidden="true">
            {Array.from({ length: 10 }).map((_, index) => (
              <i key={index} style={{ transform: `rotate(${index * 36}deg) translateX(44px)` }} />
            ))}
          </div>
          <p>{academyLesson.title}</p>
          <LearningAction
            action={academyAction}
            className="button-secondary"
            fallbackLabel="Resume Lesson"
            onOpen={onResumeLesson}
          />
        </article>
      </div>

      <LearningCard
        title="What is LoRA?"
        body="LoRA, or Low-Rank Adaptation, lets us fine-tune a model by training small update matrices instead of changing all model weights. This makes training faster and more memory efficient."
        academyAction={academyAction}
        actionLabel="Learn more"
        onAction={onResumeLesson}
      />

      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="Why learn this now?" />
      </div>
    </section>
  );
};

export default Dashboard;
