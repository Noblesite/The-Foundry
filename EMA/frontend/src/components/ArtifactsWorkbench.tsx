import React, { useEffect, useMemo, useState } from "react";
import { AcademyAction, Artifact, Construct, SectionSummary, Workshop } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, ConceptTooltip, LearningCard } from "./LearningComponents";

interface ArtifactsWorkbenchProps {
  activeArtifactId: string;
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  academyAction?: AcademyAction;
  onConstructLoaded: (construct: Construct, artifact: Artifact) => void;
  onOpenAcademy: () => void;
}

const ArtifactsWorkbench: React.FC<ArtifactsWorkbenchProps> = ({
  activeArtifactId,
  repository,
  summary,
  workshop,
  academyAction,
  onConstructLoaded,
  onOpenAcademy,
}) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState(activeArtifactId);
  const [isLoadingConstruct, setIsLoadingConstruct] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    repository
      .listArtifacts(workshop.id)
      .then((items) => {
        if (!isCurrent) {
          return;
        }
        setArtifacts(items);
        setSelectedArtifactId((current) => current || activeArtifactId || items[0]?.id || "");
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Artifacts.");
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeArtifactId, repository, workshop.id]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId),
    [artifacts, selectedArtifactId]
  );

  const loadIntoConstruct = async () => {
    if (!selectedArtifact) {
      return;
    }

    setIsLoadingConstruct(true);
    setStatusText(null);
    setError(null);

    try {
      const construct = await repository.loadArtifactIntoConstruct(workshop.id, {
        artifactId: selectedArtifact.id,
      });
      setStatusText(`${selectedArtifact.name} loaded into ${construct.name}.`);
      onConstructLoaded(construct, selectedArtifact);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Construct.");
    } finally {
      setIsLoadingConstruct(false);
    }
  };

  return (
    <section className="artifacts-workbench" aria-label="Artifacts workbench">
      <div className="workbench-hero panel-glass">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="status-badge is-forging">{workshop.name}</div>
      </div>

      <div className="artifact-layout">
        <section className="artifacts-catalog panel-glass" aria-label="Artifact catalog">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Models out</p>
              <h2>Artifact Catalog</h2>
            </div>
            <span className="status-badge">{artifacts.length} Artifacts</span>
          </div>

          <div className="artifact-list">
            {artifacts.length === 0 ? (
              <p className="empty-state">Complete a Forge to create an Artifact.</p>
            ) : (
              artifacts.map((artifact) => (
                <button
                  className={`artifact-row ${selectedArtifactId === artifact.id ? "is-active" : ""}`}
                  key={artifact.id}
                  onClick={() => setSelectedArtifactId(artifact.id)}
                  type="button"
                >
                  <div>
                    <strong>{artifact.name}</strong>
                    <span>{artifact.baseModel}</span>
                  </div>
                  <div className="material-meta">
                    <span>{artifact.version}</span>
                    <span>{artifact.trainingMethod}</span>
                    <span>{artifact.status}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <aside className="artifact-detail panel-glass" aria-label="Artifact detail">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Construct handoff</p>
              <h2>Load Artifact</h2>
            </div>
          </div>

          {selectedArtifact ? (
            <article className="forge-material-card">
              <strong>{selectedArtifact.name}</strong>
              <span>{selectedArtifact.adapterPath || "No adapter path registered yet."}</span>
              <div className="material-meta">
                <span>{selectedArtifact.id}</span>
                {selectedArtifact.forgeRunId && <span>Forge {selectedArtifact.forgeRunId}</span>}
                <span>{selectedArtifact.trialScore}% trial</span>
              </div>
              <button
                className="button-primary"
                disabled={isLoadingConstruct}
                onClick={loadIntoConstruct}
                type="button"
              >
                <i className="fas fa-play" aria-hidden="true" />
                {isLoadingConstruct ? "Loading" : "Load into Construct"}
              </button>
            </article>
          ) : (
            <p className="empty-state">Select an Artifact to load into a Construct.</p>
          )}

          {statusText && <p className="save-state success-state">{statusText}</p>}
          {error && <p className="save-state error-state">{error}</p>}

          <ConceptTooltip label="Why load Artifacts?" title="Artifact to Construct">
            An Artifact is saved model output. A Construct is the runtime surface
            that loads that output so you can run inference and test behavior.
          </ConceptTooltip>
        </aside>
      </div>

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={academyAction}
        onAction={onOpenAcademy}
      />
      <div className="dashboard-note">
        <AcademyActionTooltip action={academyAction} label="What should I learn before promotion?" />
      </div>
    </section>
  );
};

export default ArtifactsWorkbench;
