import React, { useEffect, useMemo, useState } from "react";
import { AcademyConcept, SectionSummary } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { LearningCard, LayerVisualizer, TokenPreview } from "./LearningComponents";

interface AcademyWorkbenchProps {
  repository: FoundryRepository;
  focusConceptId: string | null;
  summary: SectionSummary;
}

const fallbackConcepts: AcademyConcept[] = [
  {
    id: "acd-attention-layers",
    title: "Understanding Attention Layers",
    concept: "attention",
    shortExplanation:
      "Attention helps a model weigh which tokens matter most when it predicts the next token.",
    relatedStations: ["academy", "forge", "construct"],
  },
  {
    id: "acd-evaluation",
    title: "Evaluation",
    concept: "evaluation",
    shortExplanation:
      "Evaluation compares model replies against reviewed examples before you promote an Artifact.",
    relatedStations: ["trials", "forge", "artifacts"],
  },
  {
    id: "acd-weak-sample-review",
    title: "Weak Sample Review",
    concept: "weak-sample-review",
    shortExplanation:
      "Weak sample review turns failed and needs-work replies into corrected Material for the next Forge.",
    relatedStations: ["trials", "materials", "forge"],
  },
];

const conceptLessons: Record<
  string,
  {
    icon: string;
    principle: string;
    buildAction: string;
    explainers: string[];
  }
> = {
  attention: {
    icon: "fa-project-diagram",
    principle:
      "The model does not read every token equally. Attention scores help each layer decide which earlier tokens should shape the next prediction.",
    buildAction:
      "Use Token Preview beside Construct replies to notice which prompt words are setting the model's direction.",
    explainers: [
      "Queries ask what the current token needs.",
      "Keys describe what each previous token offers.",
      "Values carry the information the layer blends into the next representation.",
    ],
  },
  evaluation: {
    icon: "fa-scale-balanced",
    principle:
      "Evaluation is the quality gate between a trained Artifact and a Construct users can trust. It uses reviewed prompts, expected answers, and rubric scores to expose drift.",
    buildAction:
      "Run an evaluation Forge, compare pass rate against the previous report, then review weak rows before training again.",
    explainers: [
      "Pass rate shows broad readiness, not perfect safety.",
      "Rubrics split quality into specific signals like instruction match and tone.",
      "Report comparison is more useful than one isolated score.",
    ],
  },
  "weak-sample-review": {
    icon: "fa-screwdriver-wrench",
    principle:
      "Weak samples are the places where the Artifact showed you exactly what it has not learned yet. Correcting them creates targeted Material for the next Forge.",
    buildAction:
      "Keep rows that teach a real mistake, rewrite the expected output, then export and train from the reviewed Material.",
    explainers: [
      "Needs-work rows are useful when the reply is close but missing an important constraint.",
      "Failed rows are useful when the reply teaches the model what not to repeat.",
      "Review notes preserve human judgment so future Trials explain why a row mattered.",
    ],
  },
};

const getConceptKey = (concept: AcademyConcept): string => concept.concept || concept.id;

const AcademyWorkbench: React.FC<AcademyWorkbenchProps> = ({
  repository,
  focusConceptId,
  summary,
}) => {
  const [concepts, setConcepts] = useState<AcademyConcept[]>(fallbackConcepts);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(focusConceptId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError(null);

    repository
      .listAcademyConcepts()
      .then((savedConcepts) => {
        if (isCurrent && savedConcepts.length) {
          setConcepts(savedConcepts);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load concepts.");
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
  }, [repository]);

  useEffect(() => {
    if (focusConceptId) {
      setSelectedConceptId(focusConceptId);
    }
  }, [focusConceptId]);

  const selectedConcept = useMemo(() => {
    const requested = concepts.find(
      (concept) => concept.id === selectedConceptId || concept.concept === selectedConceptId
    );
    return requested || concepts[0] || fallbackConcepts[0];
  }, [concepts, selectedConceptId]);

  const selectedLesson =
    conceptLessons[getConceptKey(selectedConcept)] || conceptLessons.attention;

  return (
    <section className="workbench-page academy-workbench" aria-label="Academy">
      <div className="workbench-hero panel-glass academy-hero">
        <div>
          <p className="section-eyebrow">{summary.eyebrow}</p>
          <h1>{summary.title}</h1>
          <p>{summary.body}</p>
        </div>
        <div className="academy-focus-chip">
          <i className={`fas ${selectedLesson.icon}`} aria-hidden="true" />
          <span>{selectedConcept.title}</span>
        </div>
      </div>

      <div className="workbench-grid">
        {summary.stats.map((stat) => (
          <article className="stat-card panel-glass" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      {error && <p className="save-state error-state">{error}</p>}

      <div className="academy-layout">
        <aside className="academy-concept-list panel-glass" aria-label="Academy concepts">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Concept map</p>
              <h2>Learn in context</h2>
            </div>
            <span className="status-badge">{isLoading ? "Loading" : `${concepts.length} concepts`}</span>
          </div>
          {concepts.map((concept) => (
            <button
              className={`academy-concept-button ${
                concept.id === selectedConcept.id ? "is-active" : ""
              }`}
              key={concept.id}
              onClick={() => setSelectedConceptId(concept.id)}
              type="button"
            >
              <span>{concept.title}</span>
              <small>{concept.relatedStations.join(" / ")}</small>
            </button>
          ))}
        </aside>

        <article className="academy-detail panel-glass">
          <div className="academy-detail-header">
            <div className="learning-card-icon" aria-hidden="true">
              <i className={`fas ${selectedLesson.icon}`} />
            </div>
            <div>
              <p className="panel-kicker">Focused lesson</p>
              <h2>{selectedConcept.title}</h2>
              <p>{selectedConcept.shortExplanation}</p>
            </div>
          </div>

          <div className="academy-principle-grid">
            <section>
              <span>What is happening?</span>
              <p>{selectedLesson.principle}</p>
            </section>
            <section>
              <span>Try this next</span>
              <p>{selectedLesson.buildAction}</p>
            </section>
          </div>

          <div className="academy-explainer-list">
            {selectedLesson.explainers.map((explainer, index) => (
              <div key={explainer}>
                <strong>{index + 1}</strong>
                <p>{explainer}</p>
              </div>
            ))}
          </div>
        </article>

        <div className="academy-visual-stack">
          <LayerVisualizer />
          <TokenPreview text="Reviewed weak samples become sharper training Material." />
          <LearningCard
            title={summary.concept.title}
            body={summary.concept.body}
          />
        </div>
      </div>
    </section>
  );
};

export default AcademyWorkbench;
