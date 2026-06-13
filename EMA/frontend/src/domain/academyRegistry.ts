import { AcademyAction, AcademyConcept } from "./foundry";

export const ACADEMY_CONCEPT_IDS = {
  attention: "attention",
  evaluation: "evaluation",
  weakSampleReview: "weak-sample-review",
} as const;

export const ACADEMY_ACTION_IDS = {
  dashboardResumeLesson: "dashboard.resume-lesson",
  materialsOpenAssemblyLine: "materials.open-assembly-line",
  forgeOpenTraining: "forge.open-training",
  artifactsOpenPromotion: "artifacts.open-promotion",
  trialsOpenEvaluation: "trials.open-evaluation",
  trialsReviewWeakSamples: "trials.review-weak-samples",
} as const;

export const defaultAcademyConcepts: AcademyConcept[] = [
  {
    id: "acd-attention-layers",
    title: "Understanding Attention Layers",
    concept: ACADEMY_CONCEPT_IDS.attention,
    shortExplanation:
      "Attention helps a model weigh which tokens matter most when it predicts the next token.",
    relatedStations: ["academy", "forge", "construct"],
  },
  {
    id: "acd-evaluation",
    title: "Evaluation",
    concept: ACADEMY_CONCEPT_IDS.evaluation,
    shortExplanation:
      "Evaluation compares model replies against reviewed examples before you promote an Artifact.",
    relatedStations: ["trials", "forge", "artifacts"],
  },
  {
    id: "acd-weak-sample-review",
    title: "Weak Sample Review",
    concept: ACADEMY_CONCEPT_IDS.weakSampleReview,
    shortExplanation:
      "Weak sample review turns failed and needs-work replies into corrected Material for the next Forge.",
    relatedStations: ["trials", "materials", "forge"],
  },
];

export const defaultAcademyActions: AcademyAction[] = [
  {
    id: ACADEMY_ACTION_IDS.dashboardResumeLesson,
    station: "workshop",
    action: "resume-lesson",
    label: "Resume Lesson",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why attention now?",
    tooltipBody:
      "Attention is the first layer-level concept to understand because it explains how prompts steer the next generated token.",
  },
  {
    id: ACADEMY_ACTION_IDS.materialsOpenAssemblyLine,
    station: "materials",
    action: "open-assembly-line",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why Materials matter",
    tooltipBody:
      "Materials become chunks and examples. Cleaner inputs make every later training and evaluation step easier to trust.",
  },
  {
    id: ACADEMY_ACTION_IDS.forgeOpenTraining,
    station: "forge",
    action: "open-training-concepts",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.attention,
    tooltipTitle: "Why training metrics need context",
    tooltipBody:
      "Forge metrics are useful only when paired with examples, validation, and layer-level understanding.",
  },
  {
    id: ACADEMY_ACTION_IDS.artifactsOpenPromotion,
    station: "artifacts",
    action: "open-promotion-concepts",
    label: "Open Academy",
    conceptId: ACADEMY_CONCEPT_IDS.evaluation,
    tooltipTitle: "Why promotion needs Trials",
    tooltipBody:
      "Artifacts should move into Constructs only after evaluation gives you evidence that behavior improved.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsOpenEvaluation,
    station: "trials",
    action: "open-evaluation",
    label: "Open Academy: Evaluation",
    conceptId: ACADEMY_CONCEPT_IDS.evaluation,
    tooltipTitle: "What is Evaluation?",
    tooltipBody:
      "Evaluation checks model replies against reviewed prompts, expected answers, and rubric scores before promotion.",
  },
  {
    id: ACADEMY_ACTION_IDS.trialsReviewWeakSamples,
    station: "trials",
    action: "review-weak-samples",
    label: "Learn",
    conceptId: ACADEMY_CONCEPT_IDS.weakSampleReview,
    tooltipTitle: "What is Weak Sample Review?",
    tooltipBody:
      "Weak sample review turns failed or needs-work replies into corrected rows that can train the next Artifact.",
  },
];

export const findAcademyAction = (
  actions: AcademyAction[],
  actionId: string
): AcademyAction | undefined => actions.find((action) => action.id === actionId);
