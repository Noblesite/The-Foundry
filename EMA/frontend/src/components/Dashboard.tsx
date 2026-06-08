import React from "react";
import { DashboardSummary } from "../domain/foundry";
import { ConceptTooltip, LearningCard, ProcessExplainer } from "./LearningComponents";
import ProgressRing from "./ProgressRing";

interface DashboardProps {
  summary: DashboardSummary;
  onCreateWorkshop: () => void;
  onRunConstruct: () => void;
  onViewQueue: () => void;
  onResumeLesson: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({
  summary,
  onCreateWorkshop,
  onRunConstruct,
  onViewQueue,
  onResumeLesson,
}) => {
  const { workshop, currentArtifact, forgeQueue, academyLesson } = summary;

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
          <button className="button-secondary" onClick={onResumeLesson}>Resume Lesson</button>
        </article>
      </div>

      <LearningCard
        title="What is LoRA?"
        body="LoRA, or Low-Rank Adaptation, lets us fine-tune a model by training small update matrices instead of changing all model weights. This makes training faster and more memory efficient."
        actionLabel="Learn more"
        onAction={onResumeLesson}
      />

      <div className="dashboard-note">
        <ConceptTooltip label="What is an Assembly Line?" title="Assembly Line">
          The Assembly Line turns raw Materials into structured chunks, embeddings,
          QA pairs, and Material Sets that can be used by the Forge.
        </ConceptTooltip>
      </div>
    </section>
  );
};

export default Dashboard;
