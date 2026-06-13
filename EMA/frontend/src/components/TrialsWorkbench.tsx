import React, { useEffect, useMemo, useState } from "react";
import {
  ForgeEvaluationReport,
  ForgeRun,
  SectionSummary,
  Trial,
  TrialVerdict,
  Workshop,
} from "../domain/foundry";
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

interface EvaluationReportSummary {
  forgeRun: ForgeRun;
  report: ForgeEvaluationReport;
}

const TrialsWorkbench: React.FC<TrialsWorkbenchProps> = ({
  repository,
  summary,
  workshop,
  onOpenAcademy,
}) => {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [evaluationReports, setEvaluationReports] = useState<EvaluationReportSummary[]>([]);
  const [selectedTrialIds, setSelectedTrialIds] = useState<string[]>([]);
  const [exportName, setExportName] = useState(`${workshop.name} Trial Dataset`);
  const [isExporting, setIsExporting] = useState(false);
  const [exportState, setExportState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError(null);

    Promise.all([repository.listTrials(workshop.id), repository.listForgeRuns(workshop.id)])
      .then(async ([savedTrials, forgeRuns]) => {
        const completedEvaluationRuns = forgeRuns.filter(
          (run) => run.purpose === "evaluation" && run.status === "completed"
        );
        const reports = await Promise.all(
          completedEvaluationRuns.map(async (forgeRun) => {
            try {
              const workerState = await repository.getForgeWorkerState(forgeRun.id);
              const report = workerState.metrics.evaluationReport;
              return report ? { forgeRun, report } : null;
            } catch {
              return null;
            }
          })
        );
        if (isCurrent) {
          setTrials(savedTrials);
          setEvaluationReports(
            reports.filter((report): report is EvaluationReportSummary => Boolean(report))
          );
          setSelectedTrialIds(
            savedTrials
              .filter((trial) => trial.verdict === "pass")
              .map((trial) => trial.id)
          );
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

  useEffect(() => {
    setExportName(`${workshop.name} Trial Dataset`);
    setExportState(null);
  }, [workshop.name]);

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

  const selectedTrials = useMemo(
    () => trials.filter((trial) => selectedTrialIds.includes(trial.id)),
    [selectedTrialIds, trials]
  );

  const selectTrialsByVerdict = (verdict: TrialVerdict) => {
    setSelectedTrialIds(trials.filter((trial) => trial.verdict === verdict).map((trial) => trial.id));
  };

  const toggleTrialSelection = (trialId: string) => {
    setSelectedTrialIds((current) =>
      current.includes(trialId)
        ? current.filter((id) => id !== trialId)
        : [...current, trialId]
    );
  };

  const exportSelectedTrials = async () => {
    if (selectedTrialIds.length === 0) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportState(null);
    try {
      const exportResult = await repository.exportTrials(workshop.id, {
        trialIds: selectedTrialIds,
        name: exportName.trim() || `${workshop.name} Trial Dataset`,
      });
      setExportState(
        `Exported ${exportResult.trialCount.toLocaleString()} Trials to ${exportResult.exportUri}`
      );
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Could not export Trials.");
    } finally {
      setIsExporting(false);
    }
  };

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
          <span>Trial Reports</span>
          <strong>{evaluationReports.length}</strong>
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
      {exportState && <p className="save-state success-state">{exportState}</p>}

      <section className="evaluation-report-panel panel-glass" aria-label="Forge Trial Reports">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Evaluation history</p>
            <h2>Forge Trial Reports</h2>
          </div>
          <span className="status-badge">{evaluationReports.length} reports</span>
        </div>
        {evaluationReports.length === 0 ? (
          <p className="empty-state">
            Complete an evaluation Forge to see pass rates, rubric scores, and sample checks here.
          </p>
        ) : (
          <div className="evaluation-report-list">
            {evaluationReports.map(({ forgeRun, report }) => (
              <article className="evaluation-report-card" key={report.forgeRunId}>
                <div className="evaluation-report-card-header">
                  <div>
                    <p className="panel-kicker">{forgeRun.method} evaluation</p>
                    <h3>{forgeRun.label}</h3>
                    <span>{report.rowCount.toLocaleString()} rows / {report.materialId}</span>
                  </div>
                  <strong>{report.passRate}%</strong>
                </div>
                <div className="forge-progress-track" aria-label={`${forgeRun.label} pass rate`}>
                  <span style={{ width: `${report.passRate}%` }} />
                </div>
                <div className="trial-report-counts">
                  <span className="verdict-pass">{report.passCount} pass</span>
                  <span className="verdict-needs-work">{report.needsWorkCount} needs work</span>
                  <span className="verdict-fail">{report.failCount} fail</span>
                </div>
                <div className="evaluation-rubric-strip">
                  {report.rubric.map((item) => (
                    <span key={item.label}>
                      {item.label}: {item.score}%
                    </span>
                  ))}
                </div>
                <p>{report.recommendations[0]}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="trial-export-panel panel-glass">
        <div>
          <p className="panel-kicker">Trial export</p>
          <h2>Promote reviewed replies into Material</h2>
          <p>
            Export selected Trials as JSONL rows so the Forge can reuse vetted
            prompt-response examples as training or evaluation Material.
          </p>
        </div>
        <div className="trial-export-controls">
          <button className="button-secondary button-compact" onClick={() => selectTrialsByVerdict("pass")} type="button">
            Select pass
          </button>
          <button className="button-secondary button-compact" onClick={() => setSelectedTrialIds(trials.map((trial) => trial.id))} type="button">
            Select all
          </button>
          <button className="button-secondary button-compact" onClick={() => setSelectedTrialIds([])} type="button">
            Clear
          </button>
        </div>
        <label className="field-label" htmlFor="trial-export-name">Material name</label>
        <input
          className="text-input"
          id="trial-export-name"
          onChange={(event) => setExportName(event.target.value)}
          value={exportName}
        />
        <button
          className="button-primary"
          disabled={selectedTrialIds.length === 0 || isExporting}
          onClick={() => void exportSelectedTrials()}
          type="button"
        >
          <i className="fas fa-file-export" aria-hidden="true" />
          {isExporting ? "Exporting" : `Export ${selectedTrials.length} JSONL`}
        </button>
      </div>

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
                <label className="trial-select" htmlFor={`trial-${trial.id}`}>
                  <input
                    checked={selectedTrialIds.includes(trial.id)}
                    id={`trial-${trial.id}`}
                    onChange={() => toggleTrialSelection(trial.id)}
                    type="checkbox"
                  />
                  <span className="sr-only">Select Trial {trial.id}</span>
                </label>
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
