import React, { useEffect, useMemo, useState } from "react";
import { defaultAcademyConcepts } from "../domain/academyRegistry";
import { AcademyConcept, SectionSummary } from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { LearningCard, LayerVisualizer, TokenPreview } from "./LearningComponents";

interface AcademyWorkbenchProps {
  repository: FoundryRepository;
  focusConceptId: string | null;
  summary: SectionSummary;
}

const conceptLessons: Record<
  string,
  {
    icon: string;
    principle: string;
    buildAction: string;
    explainers: string[];
    tokenPreview: string;
    visualTitle: string;
    visualBody: string;
    visualLabels: [string, string];
    learningTitle: string;
    learningBody: string;
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
    tokenPreview: "Marshall checks the ladder before the rescue",
    visualTitle: "QKV Attention",
    visualBody:
      "Queries, keys, and values help the model connect the current token to useful earlier context.",
    visualLabels: ["Q", "KV"],
    learningTitle: "Attention is routing",
    learningBody:
      "Attention does not store facts by itself. It routes signal between tokens so later layers can make a better next-token guess.",
  },
  chunking: {
    icon: "fa-layer-group",
    principle:
      "Chunking turns long source material into predictable windows that fit inside the QA generator context while keeping source references attached.",
    buildAction:
      "Tune chunk size and overlap in Materials, then inspect whether each QA pair points back to the right source chunk.",
    explainers: [
      "Small chunks are easier to ground but can miss surrounding context.",
      "Overlap protects ideas that cross a boundary, but too much overlap can create duplicate QA rows.",
      "Stable chunk IDs make review, export, Forge, and Trial evidence traceable.",
    ],
    tokenPreview: "Episode guide chunk 04 overlaps rescue setup",
    visualTitle: "Chunk Window",
    visualBody:
      "Each window carries enough local context for grounded QA without forcing the model to read an entire source at once.",
    visualLabels: ["C1", "C2"],
    learningTitle: "Chunks are source handles",
    learningBody:
      "A strong Material keeps source location metadata with every chunk so training data can be audited later.",
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
    tokenPreview: "Prompt expected observed verdict evidence",
    visualTitle: "Trial Rubric",
    visualBody:
      "A Trial compares a prompt, expected behavior, observed response, and verdict so progress is measurable.",
    visualLabels: ["P", "V"],
    learningTitle: "Evaluation is a gate",
    learningBody:
      "A pass rate is useful only when it is tied to reviewed examples, runtime mode, and Artifact evidence.",
  },
  "foundry-loop": {
    icon: "fa-arrows-spin",
    principle:
      "The Foundry loop is a learning circuit: source Material becomes reviewed QA, Forge output becomes an Artifact, and Construct replies become Trial evidence.",
    buildAction:
      "Follow the loop banner from Materials to Artifact and use each station's Academy cue before moving forward.",
    explainers: [
      "Materials define what the model is allowed to learn from.",
      "Forge changes behavior only when JSONL rows are clean and relevant.",
      "Trials close the loop by showing what improved and what still needs Material.",
    ],
    tokenPreview: "Material QA JSONL Forge Artifact Construct Trial",
    visualTitle: "Build Loop",
    visualBody:
      "Every station should produce evidence the next station can read instead of relying on memory or guesswork.",
    visualLabels: ["IN", "OUT"],
    learningTitle: "The loop teaches the builder",
    learningBody:
      "The product is not just a model. It is a guided system that shows why each build step matters.",
  },
  "source-ingestion": {
    icon: "fa-file-import",
    principle:
      "Source ingestion snapshots files and webpages into controlled storage so generated chunks and QA rows cite stable inputs.",
    buildAction:
      "Import a small text, Markdown, PDF-derived text, or website snapshot, then verify the stored source preview before chunking.",
    explainers: [
      "A snapshot protects the build from webpages changing later.",
      "Supported file types should become normalized plain text before chunking.",
      "Metadata should keep title, URI, page, section, and import mode when available.",
    ],
    tokenPreview: "Source URL title page section snapshot",
    visualTitle: "Source Snapshot",
    visualBody:
      "Ingestion converts messy inputs into stable Material records that downstream steps can trust.",
    visualLabels: ["SRC", "MAT"],
    learningTitle: "Raw data needs provenance",
    learningBody:
      "Provenance is the reason a user can inspect a QA row and understand exactly where it came from.",
  },
  "qa-generation": {
    icon: "fa-wand-magic-sparkles",
    principle:
      "QA generation asks a deterministic fallback or local model to turn source chunks into training examples grounded in the source text.",
    buildAction:
      "Use deterministic mode for smoke tests, then run a cached instruction model when quality matters.",
    explainers: [
      "The prompt should demand source-grounded answers and reject unsupported facts.",
      "Different QA types cover definitions, procedures, comparisons, edge cases, and troubleshooting.",
      "Generation mode and model ID must stay attached to every row.",
    ],
    tokenPreview: "Question answer confidence chunk reference",
    visualTitle: "QA Drafting",
    visualBody:
      "The generator reads one source window and proposes rows that humans can accept, edit, or reject.",
    visualLabels: ["CTX", "QA"],
    learningTitle: "QA quality drives Artifact quality",
    learningBody:
      "Weak generated examples train weak behavior, so review and source grounding are part of the core workflow.",
  },
  "qa-quality-gate": {
    icon: "fa-shield-halved",
    principle:
      "The QA quality gate blocks low-confidence, weakly grounded, duplicated, or trivial rows before they become Forge training Material.",
    buildAction:
      "Review blocked reasons in QA Review, edit useful rows, and export only rows that are safe for training.",
    explainers: [
      "Grounding checks whether the answer is supported by the source chunk.",
      "Triviality checks help avoid examples that teach almost nothing.",
      "Human edits should be preserved so future runs explain what changed.",
    ],
    tokenPreview: "Grounded nontrivial accepted rejected edited",
    visualTitle: "Quality Gate",
    visualBody:
      "Rows must pass both machine checks and human review before the Forge should treat them as training-ready.",
    visualLabels: ["RAW", "OK"],
    learningTitle: "Gates protect the Forge",
    learningBody:
      "A clean gate keeps demos honest and helps users understand why more data is not automatically better data.",
  },
  "training-adapters": {
    icon: "fa-screwdriver-wrench",
    principle:
      "LoRA and QLoRA train compact adapter weights that steer a base model without rewriting every parameter.",
    buildAction:
      "Pick QLoRA for lower memory pressure, verify the base model, then inspect target modules and adapter files after Forge.",
    explainers: [
      "LoRA learns low-rank update matrices for selected layers.",
      "QLoRA keeps the base model quantized while training adapters.",
      "Adapter compatibility matters because an adapter expects the same base model family it was trained against.",
    ],
    tokenPreview: "Base model frozen adapter weights update",
    visualTitle: "LoRA Adapter",
    visualBody:
      "Adapter layers learn compact updates while the base model stays mostly frozen.",
    visualLabels: ["A", "B"],
    learningTitle: "Adapters are controlled changes",
    learningBody:
      "The adapter boundary lets users experiment locally without duplicating a full base model checkpoint.",
  },
  "artifact-readiness": {
    icon: "fa-cubes",
    principle:
      "Artifact readiness checks that Forge output has loadable files, a known kind, base-model compatibility, and Trial evidence.",
    buildAction:
      "Open Artifacts after Forge, inspect readiness, then run Construct and Trials before treating the Artifact as useful.",
    explainers: [
      "Metadata-only output proves workflow shape, not model behavior.",
      "Adapter files and trainer summaries prove the Forge created something loadable.",
      "Trial evidence shows whether the Artifact actually behaves better.",
    ],
    tokenPreview: "Adapter files trainer result Trial evidence",
    visualTitle: "Artifact Evidence",
    visualBody:
      "A ready Artifact combines file readiness with runtime Trial evidence instead of relying on a green status alone.",
    visualLabels: ["FILES", "TRIAL"],
    learningTitle: "Artifacts need evidence",
    learningBody:
      "The registry should explain whether an Artifact is simulated, base-model-only, or adapter-backed.",
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
    tokenPreview: "Observed mistake corrected answer review note",
    visualTitle: "Correction Loop",
    visualBody:
      "Weak samples become focused Material when a human records the expected behavior and the reason it matters.",
    visualLabels: ["MISS", "FIX"],
    learningTitle: "Failures are training signals",
    learningBody:
      "A good review flow turns disappointment into the next precise dataset slice.",
  },
  "runtime-evidence": {
    icon: "fa-satellite-dish",
    principle:
      "Runtime evidence records whether a reply came from simulation, a base model, or an adapter-backed Artifact.",
    buildAction:
      "Check the Construct evidence card before saving a Trial verdict so you know what runtime actually answered.",
    explainers: [
      "Simulated replies prove interface flow, not model quality.",
      "Base-only local replies prove a model loaded but not that the adapter affected behavior.",
      "Adapter-backed replies are the evidence needed to judge Forge output.",
    ],
    tokenPreview: "Simulated base-only adapter-backed verdict",
    visualTitle: "Runtime Source",
    visualBody:
      "Runtime source labels keep users from mistaking a demo path for a trained model result.",
    visualLabels: ["MODE", "EVID"],
    learningTitle: "Evidence prevents confusion",
    learningBody:
      "Clear runtime labels are how The Foundry stays educational and honest while local ML features mature.",
  },
  "memory-management": {
    icon: "fa-memory",
    principle:
      "Runtime memory management releases model references and asks the local platform to clear CPU, CUDA, or Apple Silicon caches.",
    buildAction:
      "Unload or release memory before switching large models, then compare the Runtime Metrics before and after load.",
    explainers: [
      "Apple Silicon shares memory between CPU and GPU workloads.",
      "CUDA, MPS, and CPU runtimes have different cleanup hooks.",
      "A lower memory footprint keeps local experimentation responsive.",
    ],
    tokenPreview: "Unload model clear cache available memory",
    visualTitle: "Memory Budget",
    visualBody:
      "Local model work succeeds when load estimates and cleanup behavior respect the current machine.",
    visualLabels: ["USE", "FREE"],
    learningTitle: "Memory is a design constraint",
    learningBody:
      "The UI should teach why model size, quantization, context length, and device choice all affect fit.",
  },
  "trial-comparison": {
    icon: "fa-code-compare",
    principle:
      "Prompt comparison reruns the same intent across Artifacts or runtime modes so users can see whether behavior changed.",
    buildAction:
      "Save a baseline response, run the same prompt against a new Artifact, then compare verdicts before promotion.",
    explainers: [
      "A single impressive reply does not prove general improvement.",
      "Repeated prompts make regressions easier to spot.",
      "Comparison rows become useful Material when weak outputs are corrected.",
    ],
    tokenPreview: "Baseline candidate prompt verdict delta",
    visualTitle: "Comparison",
    visualBody:
      "Side-by-side evidence shows whether a new Artifact improved, regressed, or simply sounded different.",
    visualLabels: ["OLD", "NEW"],
    learningTitle: "Compare before trusting",
    learningBody:
      "Trial comparison turns gut feel into a repeatable engineering habit.",
  },
};

const getConceptKey = (concept: AcademyConcept): string => concept.concept || concept.id;

const AcademyWorkbench: React.FC<AcademyWorkbenchProps> = ({
  repository,
  focusConceptId,
  summary,
}) => {
  const [concepts, setConcepts] = useState<AcademyConcept[]>(defaultAcademyConcepts);
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
    return requested || concepts[0] || defaultAcademyConcepts[0];
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
          <LayerVisualizer
            title={selectedLesson.visualTitle}
            body={selectedLesson.visualBody}
            upperLabel={selectedLesson.visualLabels[0]}
            lowerLabel={selectedLesson.visualLabels[1]}
          />
          <TokenPreview text={selectedLesson.tokenPreview} />
          <LearningCard
            title={selectedLesson.learningTitle}
            body={selectedLesson.learningBody}
          />
        </div>
      </div>
    </section>
  );
};

export default AcademyWorkbench;
