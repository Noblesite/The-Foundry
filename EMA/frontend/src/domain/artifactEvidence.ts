import { Artifact, ArtifactReadinessStatus, Trial } from "./foundry";

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
