import { readFile } from "node:fs/promises";

const files = {
  artifactEvidence: await readFile(
    new URL("../src/domain/artifactEvidence.ts", import.meta.url),
    "utf8"
  ),
  artifacts: await readFile(
    new URL("../src/components/ArtifactsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  dashboard: await readFile(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8"),
  construct: await readFile(
    new URL("../src/components/ConstructWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  roadmap: await readFile(new URL("../../../docs/roadmap.md", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.artifactEvidence,
  "export const buildArtifactEvidenceSummary =",
  "Artifact evidence domain exposes a shared summary builder"
);
assertIncludes(
  files.artifactEvidence,
  "adapterBackedPassTrials.length > 0",
  "Artifact evidence treats adapter-backed pass Trials as verified"
);
assertIncludes(
  files.artifactEvidence,
  "status: \"simulated\"",
  "Artifact evidence labels simulated-only pass Trials explicitly"
);
assertIncludes(
  files.artifacts,
  "repository.listTrials(workshop.id)",
  "Artifacts workbench loads Trial evidence for selected Artifacts"
);
assertIncludes(
  files.artifacts,
  "selectedArtifactEvidence",
  "Artifacts workbench derives selected Artifact evidence"
);
assertIncludes(
  files.artifacts,
  "Artifact evidence",
  "Artifacts detail panel renders evidence guidance"
);
assertIncludes(
  files.dashboard,
  "artifactEvidence: ArtifactEvidenceSummary",
  "Dashboard receives current Artifact evidence"
);
assertIncludes(
  files.dashboard,
  "dashboard-artifact-evidence",
  "Dashboard renders current Artifact evidence summary"
);
assertIncludes(
  files.construct,
  "artifactEvidenceSummary",
  "Construct workbench derives evidence for the loaded Artifact"
);
assertIncludes(
  files.construct,
  "Artifact evidence",
  "Construct workbench shows evidence before response inspection"
);
assertIncludes(
  files.app,
  "const [activeWorkshopTrials, setActiveWorkshopTrials]",
  "App keeps active Workshop Trials available for Dashboard evidence"
);
assertIncludes(
  files.app,
  "buildArtifactEvidenceSummary(activeArtifact, activeWorkshopTrials)",
  "App derives Dashboard Artifact evidence from active Trials"
);
assertIncludes(
  files.styles,
  ".artifact-evidence-card",
  "Artifact evidence card has shared styling"
);
assertIncludes(
  files.styles,
  ".dashboard-artifact-evidence",
  "Dashboard evidence strip has dedicated styling"
);
assertIncludes(
  files.roadmap,
  "Artifact readiness evidence panel",
  "Roadmap records the Artifact evidence slices"
);

console.log("Artifact evidence checks passed.");
