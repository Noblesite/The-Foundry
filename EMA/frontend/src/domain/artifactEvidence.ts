import {
  Artifact,
  ArtifactReadinessStatus,
  FoundryLoopFocus,
  NavigationSection,
  Trial,
} from "./foundry";

export interface ArtifactEvidenceSummary {
  artifactId: string;
  status: ArtifactReadinessStatus;
  title: string;
  summary: string;
  nextAction: string;
  totalTrials: number;
  passTrials: number;
  needsReviewTrials: number;
  adapterBackedPassTrials: number;
  baseOnlyPassTrials: number;
  simulatedPassTrials: number;
}

export interface ArtifactEvidenceAction {
  id: "open-construct" | "review-trials" | "compare-trials";
  label: string;
  icon: string;
  destination: NavigationSection;
  routePreview: {
    destination: string;
    focus: string;
    filter?: string;
    artifactId: string;
  };
  focus: Omit<FoundryLoopFocus, "requestedAt">;
}

export const getArtifactEvidenceAction = (
  artifact: Artifact,
  evidence: ArtifactEvidenceSummary
): ArtifactEvidenceAction => {
  if (evidence.status === "verified") {
    return {
      id: "compare-trials",
      label: "Compare Trials",
      icon: "fa-code-compare",
      destination: "trials",
      routePreview: {
        destination: "Trials",
        focus: "Prompt comparison",
        filter: "Adapter-backed",
        artifactId: artifact.id,
      },
      focus: {
        id: `artifact-evidence-${artifact.id}-compare`,
        section: "trials",
        stepLabel: "Artifact Evidence",
        title: "Compare verified Artifact behavior",
        detail:
          "This Artifact has adapter-backed pass evidence. Compare repeated prompts before treating it as promoted behavior.",
        actionLabel: "Compare Trials",
        targetLabel: "Prompt comparison",
        artifactId: artifact.id,
        trialFilter: "adapter-backed",
      },
    };
  }

  if (evidence.needsReviewTrials > 0) {
    return {
      id: "review-trials",
      label: "Review Trials",
      icon: "fa-clipboard-check",
      destination: "trials",
      routePreview: {
        destination: "Trials",
        focus: "Trial list",
        filter: "Needs review",
        artifactId: artifact.id,
      },
      focus: {
        id: `artifact-evidence-${artifact.id}-review`,
        section: "trials",
        stepLabel: "Artifact Evidence",
        title: "Review captured Artifact replies",
        detail:
          "Auto-captured Construct replies still need a human verdict before this Artifact has promotion evidence.",
        actionLabel: "Review Trials",
        targetLabel: "Trial list",
        artifactId: artifact.id,
        trialFilter: "needs-review",
      },
    };
  }

  if (evidence.baseOnlyPassTrials > 0) {
    return {
      id: "open-construct",
      label: "Run Adapter Proof",
      icon: "fa-play",
      destination: "construct",
      routePreview: {
        destination: "Construct",
        focus: "Adapter-backed Construct",
        artifactId: artifact.id,
      },
      focus: {
        id: `artifact-evidence-${artifact.id}-adapter-proof`,
        section: "construct",
        stepLabel: "Artifact Evidence",
        title: "Run an adapter-backed proof",
        detail:
          "This Artifact only has base-model Trial evidence. Load the Artifact adapter in Construct and rerun the promoted prompt.",
        actionLabel: "Run proof",
        targetLabel: "Adapter-backed Construct",
        artifactId: artifact.id,
      },
    };
  }

  if (evidence.simulatedPassTrials > 0) {
    return {
      id: "open-construct",
      label: "Run Local Proof",
      icon: "fa-play",
      destination: "construct",
      routePreview: {
        destination: "Construct",
        focus: "Construct runtime",
        artifactId: artifact.id,
      },
      focus: {
        id: `artifact-evidence-${artifact.id}-local-proof`,
        section: "construct",
        stepLabel: "Artifact Evidence",
        title: "Replace simulated evidence with a local proof",
        detail:
          "Simulated pass Trials prove workflow shape only. Run Construct with a local model or adapter-backed Artifact before promotion.",
        actionLabel: "Run local proof",
        targetLabel: "Construct runtime",
        artifactId: artifact.id,
      },
    };
  }

  return {
    id: "open-construct",
    label: "Create Trial Evidence",
    icon: "fa-play",
    destination: "construct",
    routePreview: {
      destination: "Construct",
      focus: "Construct prompt",
      artifactId: artifact.id,
    },
    focus: {
      id: `artifact-evidence-${artifact.id}-create-trial`,
      section: "construct",
      stepLabel: "Artifact Evidence",
      title: "Create Trial evidence",
      detail:
        "This Artifact has no promoted Trial evidence. Run Construct prompts, save verdicts, and return here when evidence exists.",
      actionLabel: "Run Construct",
      targetLabel: "Construct prompt",
      artifactId: artifact.id,
    },
  };
};

const trialBelongsToArtifact = (artifact: Artifact, trial: Trial) =>
  trial.artifactId === artifact.id || trial.runtimeProfile?.artifactId === artifact.id;

export const buildArtifactEvidenceSummary = (
  artifact: Artifact,
  trials: Trial[]
): ArtifactEvidenceSummary => {
  const artifactTrials = trials.filter((trial) => trialBelongsToArtifact(artifact, trial));
  const passTrials = artifactTrials.filter((trial) => trial.verdict === "pass");
  const needsReviewTrials = artifactTrials.filter((trial) => trial.verdict === "needs-review");
  const adapterBackedPassTrials = passTrials.filter(
    (trial) =>
      trial.runtimeProfile?.source === "adapter-backed" ||
      trial.runtimeProfile?.adapterLoaded === true
  );
  const baseOnlyPassTrials = passTrials.filter(
    (trial) =>
      trial.runtimeProfile?.source === "base-only" ||
      (trial.runtimeMode === "transformers" && trial.runtimeProfile?.source !== "adapter-backed")
  );
  const simulatedPassTrials = passTrials.filter(
    (trial) =>
      trial.runtimeProfile?.source === "simulated" ||
      trial.runtimeMode === "simulated" ||
      !trial.runtimeProfile
  );

  if (adapterBackedPassTrials.length > 0) {
    return {
      artifactId: artifact.id,
      status: "verified",
      title: "Adapter-backed Trial evidence",
      summary: `${adapterBackedPassTrials.length} pass Trial${
        adapterBackedPassTrials.length === 1 ? "" : "s"
      } streamed with Artifact adapter evidence.`,
      nextAction: "Use this Artifact in Construct, then keep comparing prompts before public promotion.",
      totalTrials: artifactTrials.length,
      passTrials: passTrials.length,
      needsReviewTrials: needsReviewTrials.length,
      adapterBackedPassTrials: adapterBackedPassTrials.length,
      baseOnlyPassTrials: baseOnlyPassTrials.length,
      simulatedPassTrials: simulatedPassTrials.length,
    };
  }

  if (baseOnlyPassTrials.length > 0) {
    return {
      artifactId: artifact.id,
      status: "caution",
      title: "Base-model Trial evidence",
      summary: `${baseOnlyPassTrials.length} pass Trial${
        baseOnlyPassTrials.length === 1 ? "" : "s"
      } ran locally, but adapter-backed evidence is still missing.`,
      nextAction: "Load the Artifact adapter and rerun the promoted prompt before trusting model behavior.",
      totalTrials: artifactTrials.length,
      passTrials: passTrials.length,
      needsReviewTrials: needsReviewTrials.length,
      adapterBackedPassTrials: adapterBackedPassTrials.length,
      baseOnlyPassTrials: baseOnlyPassTrials.length,
      simulatedPassTrials: simulatedPassTrials.length,
    };
  }

  if (simulatedPassTrials.length > 0) {
    return {
      artifactId: artifact.id,
      status: "simulated",
      title: "Simulated Trial evidence",
      summary: `${simulatedPassTrials.length} pass Trial${
        simulatedPassTrials.length === 1 ? "" : "s"
      } proves workflow shape, not model quality.`,
      nextAction: "Run a local model or adapter-backed Construct Trial before promotion.",
      totalTrials: artifactTrials.length,
      passTrials: passTrials.length,
      needsReviewTrials: needsReviewTrials.length,
      adapterBackedPassTrials: adapterBackedPassTrials.length,
      baseOnlyPassTrials: baseOnlyPassTrials.length,
      simulatedPassTrials: simulatedPassTrials.length,
    };
  }

  if (needsReviewTrials.length > 0) {
    return {
      artifactId: artifact.id,
      status: "caution",
      title: "Trials need review",
      summary: `${needsReviewTrials.length} captured Trial${
        needsReviewTrials.length === 1 ? "" : "s"
      } still needs a human verdict.`,
      nextAction: "Review Trial replies and promote the strongest comparison variant.",
      totalTrials: artifactTrials.length,
      passTrials: passTrials.length,
      needsReviewTrials: needsReviewTrials.length,
      adapterBackedPassTrials: adapterBackedPassTrials.length,
      baseOnlyPassTrials: baseOnlyPassTrials.length,
      simulatedPassTrials: simulatedPassTrials.length,
    };
  }

  return {
    artifactId: artifact.id,
    status: "blocked",
    title: "No promoted Trial evidence",
    summary: "This Artifact has no pass Trials yet.",
    nextAction: "Run Construct prompts, compare variants in Trials, and promote the best response.",
    totalTrials: artifactTrials.length,
    passTrials: passTrials.length,
    needsReviewTrials: needsReviewTrials.length,
    adapterBackedPassTrials: adapterBackedPassTrials.length,
    baseOnlyPassTrials: baseOnlyPassTrials.length,
    simulatedPassTrials: simulatedPassTrials.length,
  };
};
