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
  trials: await readFile(
    new URL("../src/components/TrialsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  foundryDomain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  roadmap: await readFile(new URL("../../../docs/roadmap.md", import.meta.url), "utf8"),
  repository: await readFile(
    new URL("../src/services/foundryRepository.ts", import.meta.url),
    "utf8"
  ),
  apiContracts: await readFile(
    new URL("../src/contracts/foundryApi.ts", import.meta.url),
    "utf8"
  ),
  apiServer: await readFile(new URL("../../../EMA/backend/api_server.py", import.meta.url), "utf8"),
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
  "export const getArtifactEvidenceAction =",
  "Artifact evidence domain exposes state-aware action routing"
);
assertIncludes(
  files.artifactEvidence,
  "trialFilter: \"needs-review\"",
  "Artifact evidence routes needs-review states to the Trial review filter"
);
assertIncludes(
  files.artifactEvidence,
  "trialFilter: \"adapter-backed\"",
  "Artifact evidence routes verified states to adapter-backed comparison evidence"
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
  "repository.listArtifactEvidence(workshop.id)",
  "Artifacts workbench loads backend evidence for selected Artifacts"
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
  files.artifacts,
  "onArtifactEvidenceAction(selectedArtifactEvidenceAction)",
  "Artifacts detail panel exposes the recommended evidence action"
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
  files.dashboard,
  "onArtifactEvidenceAction(artifactEvidenceAction)",
  "Dashboard evidence strip exposes the recommended action"
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
  files.construct,
  "onArtifactEvidenceAction(artifactEvidenceAction)",
  "Construct evidence card exposes the recommended action"
);
assertIncludes(
  files.trials,
  "loopFocus.trialFilter",
  "Trials workbench honors evidence-requested Trial filters"
);
assertIncludes(
  files.trials,
  "focusedArtifactId",
  "Trials workbench narrows evidence handoffs to the selected Artifact"
);
assertIncludes(
  files.trials,
  "evidenceScopedTrials",
  "Trials workbench scopes counts and comparisons to the selected Artifact"
);
assertIncludes(
  files.trials,
  "onClearLoopFocus",
  "Trials workbench can clear an Artifact-scoped evidence handoff"
);
assertIncludes(
  files.foundryDomain,
  "trialFilter?:",
  "Loop focus can carry a Trial evidence filter"
);
assertIncludes(
  files.app,
  "const [activeArtifactEvidenceSummary, setActiveArtifactEvidenceSummary]",
  "App keeps active Artifact evidence available for Dashboard readiness"
);
assertIncludes(
  files.app,
  "repository.getArtifactEvidence(activeArtifactId)",
  "App loads exact backend Artifact evidence for Dashboard readiness"
);
assertIncludes(
  files.repository,
  "getArtifactEvidence:",
  "Repository exposes exact Artifact evidence summaries"
);
assertIncludes(
  files.apiContracts,
  "artifactEvidenceDetail:",
  "API routes include the exact Artifact evidence endpoint"
);
assertIncludes(
  files.apiServer,
  "/api/v1/artifacts/{artifact_id}/evidence",
  "FastAPI exposes the exact Artifact evidence endpoint"
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
