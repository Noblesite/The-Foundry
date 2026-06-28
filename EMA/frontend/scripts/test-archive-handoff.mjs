import { readFile } from "node:fs/promises";

const materials = await readFile(
  new URL("../src/components/MaterialsWorkbench.tsx", import.meta.url),
  "utf8"
);
const artifacts = await readFile(
  new URL("../src/components/ArtifactsWorkbench.tsx", import.meta.url),
  "utf8"
);

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

const assertOrder = (source, before, after, message) => {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  if (beforeIndex === -1 || afterIndex === -1 || beforeIndex >= afterIndex) {
    throw new Error(`${message}: expected "${before}" before "${after}"`);
  }
};

assertIncludes(
  materials,
  "const openQAGeneratorArchive = () =>",
  "Materials owns a stable QA generator Archive handoff trigger"
);
assertIncludes(
  materials,
  "data-testid=\"qa-generator-find-in-archive\"",
  "Materials exposes a stable Archive handoff control for regression testing"
);
assertIncludes(
  materials,
  "onClick={openQAGeneratorArchive}",
  "Materials handoff uses normal button click activation for route changes"
);
assertIncludes(
  materials,
  "onKeyDown={(event) =>",
  "Materials handoff remains keyboard accessible"
);
assertIncludes(
  materials,
  "const qaGeneratorArchiveModelId =",
  "Materials derives a concrete model id for QA generator Archive handoff"
);
assertIncludes(
  materials,
  "onOpenArchiveModel(qaGeneratorArchiveModelId, \"QA Generator\")",
  "Materials routes the blocked QA generator model to Archive"
);
assertIncludes(
  materials,
  "const returnedArchiveModelId =",
  "Materials pins returned Archive configuration to the handoff model id"
);
assertIncludes(
  materials,
  "returnedArchiveModelId\n          || qaGeneratorDraft.modelId.trim()",
  "Materials prefers the returned Archive model over a stale runtime draft"
);
assertIncludes(
  materials,
  "type AssemblyIntent = \"smoke\" | \"training\"",
  "Materials separates smoke/demo Assembly Line runs from training-quality runs"
);
assertIncludes(
  materials,
  "const trainingQualityGatePassed = Boolean(",
  "Materials computes an explicit model-backed proof gate for training-quality QA"
);
assertIncludes(
  materials,
  "(!assemblyIntentIsTraining || trainingQualityGatePassed)",
  "Materials keeps smoke runs available while gating training-quality runs"
);
assertIncludes(
  materials,
  "Training-quality Assembly Line is blocked until model-backed QA proof passes.",
  "Materials blocks training-quality Assembly Line starts without a passing proof"
);
assertIncludes(
  materials,
  "aria-label=\"Assembly Line training-quality gate\"",
  "Materials exposes the Assembly Line training-quality gate in the UI"
);

assertOrder(
  artifacts,
  "await searchModels(handoff.modelId);",
  "await preflightArchiveTarget(handoff.modelId, handoff.revision);",
  "Archive handoff preflights after search so the preflight result wins the race"
);
assertIncludes(
  artifacts,
  "setModelPreflight(null);\n    setAllowPreflightOverride(false);",
  "Archive clears stale preflight when starting a new search"
);
assertIncludes(
  artifacts,
  "onClick={() => {\n                    setSelectedModelId(model.repoId);\n                    setModelPreflight(null);",
  "Archive clears preflight only on explicit model selection"
);
assertIncludes(
  artifacts,
  "onModelDownloadJobStarted?.(job);",
  "Archive reports queued download jobs to App for automatic return routing"
);
