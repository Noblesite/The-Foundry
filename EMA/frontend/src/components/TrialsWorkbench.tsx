import React, { useEffect, useMemo, useState } from "react";
import { SectionSummary, Trial, TrialVerdict, Workshop } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { LearningCard } from "./LearningComponents";

interface TrialsWorkbenchProps {
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  onOpenAcademy: () => void;
}

const verdictLabels: Record<TrialVerdict, string> = {
  pass: "Pass",
  "needs-work": "Needs work",
  fail: "Fail",
};

const TrialsWorkbench: React.FC<TrialsWorkbenchProps> = ({
  repository,
  summary,
  workshop,
  onOpenAcademy,
}) => {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError(null);

    repository
      .listTrials(workshop.id)
      .then((savedTrials) => {
        if (isCurrent) {
          setTrials(savedTrials);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Trials.");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, workshop.id]);

  const verdictCounts = useMemo(
    () =>
      trials.reduce(
        (counts, trial) => ({
          ...counts,
          [trial.verdict]: counts[trial.verdict] + 1,
        }),
        { pass: 0, "needs-work": 0, fail: 0 } as Record<TrialVerdict, number>
      ),
    [trials]
  );

  return (
    <section className="workbench-page trials-workbench" aria-label="Trials">
      <div className="workbench-hero panel-glass">
        <p className="section-eyebrow">{summary.eyebrow}</p>
        <h1>{summary.title}</h1>
        <p>{summary.body}</p>
      </div>

      <div className="workbench-grid">
        <article className="stat-card panel-glass">
          <span>Saved Trials</span>
          <strong>{trials.length}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Pass</span>
          <strong>{verdictCounts.pass}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Needs work</span>
          <strong>{verdictCounts["needs-work"]}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Fail</span>
          <strong>{verdictCounts.fail}</strong>
        </article>
      </div>

      {error && <p className="save-state error-state">{error}</p>}

      <div className="trial-list">
        {isLoading ? (
          <article className="trial-card panel-glass">
            <p className="empty-state">Loading saved Trials...</p>
          </article>
        ) : trials.length === 0 ? (
          <article className="trial-card panel-glass">
            <p className="panel-kicker">No Trials yet</p>
            <h2>Run a Construct prompt and mark the reply.</h2>
            <p>
              The prompt, generated response, runtime settings, and verdict will appear here as
              an evaluation record for the active Artifact.
            </p>
          </article>
        ) : (
          trials.map((trial) => (
            <article className="trial-card panel-glass" key={trial.id}>
              <div className="trial-card-header">
                <div>
                  <p className="panel-kicker">{trial.runtimeMode}</p>
                  <h2>{trial.prompt}</h2>
                </div>
                <span className={`trial-verdict verdict-${trial.verdict}`}>
                  {verdictLabels[trial.verdict]}
                </span>
              </div>
              <p className="trial-response">{trial.response}</p>
              <div className="trial-meta">
                <span>Artifact {trial.artifactId}</span>
                <span>{trial.tokenCount} tokens</span>
                <span>{new Date(trial.createdAt).toLocaleString()}</span>
              </div>
            </article>
          ))
        )}
      </div>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        actionLabel="Open Academy"
        onAction={onOpenAcademy}
      />
    </section>
  );
};

export default TrialsWorkbench;
