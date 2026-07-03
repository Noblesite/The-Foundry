import { readFile } from "node:fs/promises";

const files = {
  academyRegistry: await readFile(
    new URL("../src/domain/academyRegistry.ts", import.meta.url),
    "utf8"
  ),
  academyWorkbench: await readFile(
    new URL("../src/components/AcademyWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  learningComponents: await readFile(
    new URL("../src/components/LearningComponents.tsx", import.meta.url),
    "utf8"
  ),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

const conceptIds = Array.from(
  files.academyRegistry.matchAll(/([a-zA-Z]+): "([^"]+)"/g),
  (match) => match[2]
).filter((value) => value.startsWith("attention") || files.academyRegistry.includes(`concept: ACADEMY_CONCEPT_IDS.`));

const requiredConceptIds = [
  "attention",
  "chunking",
  "evaluation",
  "foundry-loop",
  "memory-management",
  "qa-generation",
  "qa-proof-diagnostics",
  "qa-quality-gate",
  "source-overlap",
  "training-adapters",
  "artifact-readiness",
  "hallucination-risk",
  "runtime-evidence",
  "source-ingestion",
  "trial-comparison",
  "weak-sample-review",
];

for (const conceptId of requiredConceptIds) {
  const plainKey = `${conceptId}: {`;
  const quotedKey = `"${conceptId}": {`;
  if (!files.academyWorkbench.includes(plainKey) && !files.academyWorkbench.includes(quotedKey)) {
    throw new Error(`Academy concept ${conceptId} has a focused lesson`);
  }
}

assertIncludes(
  files.academyWorkbench,
  "title={selectedLesson.visualTitle}",
  "Academy visual title changes with selected concept"
);
assertIncludes(
  files.academyWorkbench,
  "text={selectedLesson.tokenPreview}",
  "Academy token preview changes with selected concept"
);
assertIncludes(
  files.academyWorkbench,
  "title={selectedLesson.learningTitle}",
  "Academy learning card changes with selected concept"
);
assertIncludes(
  files.learningComponents,
  "interface LayerVisualizerProps",
  "LayerVisualizer accepts concept-specific copy"
);
assertIncludes(
  files.learningComponents,
  "upperLabel = \"A\"",
  "LayerVisualizer preserves existing default labels"
);
assertIncludes(
  files.learningComponents,
  "lowerLabel = \"B\"",
  "LayerVisualizer preserves existing lower default label"
);
assertIncludes(
  files.academyRegistry,
  "materialsQAProofDiagnostics",
  "Academy registry includes Materials QA proof diagnostics action"
);
assertIncludes(
  files.academyRegistry,
  "materialsSourceOverlap",
  "Academy registry includes Materials source overlap action"
);
assertIncludes(
  files.academyRegistry,
  "materialsHallucinationRisk",
  "Academy registry includes Materials hallucination risk action"
);
assertIncludes(
  files.academyWorkbench,
  "Availability is not quality",
  "Academy teaches cached model availability versus proof quality"
);
assertIncludes(
  files.academyWorkbench,
  "Grounding starts with evidence",
  "Academy teaches source overlap as grounding evidence"
);
assertIncludes(
  files.academyWorkbench,
  "Do not train on guesses",
  "Academy teaches hallucination risk as a training-data blocker"
);

if (conceptIds.length < requiredConceptIds.length) {
  throw new Error("Academy registry concept extraction found fewer concepts than expected.");
}

console.log("Academy concept checks passed.");
