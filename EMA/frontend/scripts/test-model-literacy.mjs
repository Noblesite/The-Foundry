import { readFile } from "node:fs/promises";

const files = {
  modelLiteracy: await readFile(
    new URL("../src/domain/modelLiteracy.ts", import.meta.url),
    "utf8"
  ),
  modelLiteracyCards: await readFile(
    new URL("../src/components/ModelLiteracyCards.tsx", import.meta.url),
    "utf8"
  ),
  artifacts: await readFile(
    new URL("../src/components/ArtifactsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  construct: await readFile(
    new URL("../src/components/ConstructWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  packageJson: await readFile(new URL("../package.json", import.meta.url), "utf8"),
  roadmap: await readFile(new URL("../../../docs/roadmap.md", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.modelLiteracy,
  "export const buildModelLiteracyProfile",
  "Model literacy exposes a shared deterministic profile builder"
);
assertIncludes(
  files.modelLiteracy,
  "Q, K, and V attention projections",
  "Model literacy teaches QKV attention relationships"
);
assertIncludes(
  files.modelLiteracy,
  "Reserved tokens",
  "Model literacy teaches reserved and special tokenizer behavior"
);
assertIncludes(
  files.modelLiteracy,
  "The model does not take action on its own",
  "Model literacy explains wrapper responsibility"
);
assertIncludes(
  files.modelLiteracy,
  "For RAG, the wrapper retrieves Library context",
  "Model literacy connects wrapper logic to RAG context injection"
);
assertIncludes(
  files.modelLiteracy,
  "context window",
  "Model literacy explains context budget"
);
assertIncludes(
  files.modelLiteracyCards,
  "aria-label={`Model literacy for ${profile.modelId}`}",
  "Model literacy cards expose an accessible label"
);
assertIncludes(
  files.modelLiteracyCards,
  "profile.cards.map",
  "Model literacy card component renders every profile card"
);
assertIncludes(
  files.artifacts,
  "selectedModelLiteracyProfile",
  "Archive derives model literacy from selected model metadata"
);
assertIncludes(
  files.artifacts,
  "<ModelLiteracyCards profile={selectedModelLiteracyProfile} />",
  "Archive renders model literacy before download jobs"
);
assertIncludes(
  files.construct,
  "modelLiteracyProfile",
  "Construct derives model literacy from runtime state"
);
assertIncludes(
  files.construct,
  "<ModelLiteracyCards compact profile={modelLiteracyProfile} />",
  "Construct renders compact model literacy before runtime actions"
);
assertIncludes(
  files.styles,
  ".model-literacy-panel",
  "Model literacy cards have dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:model-literacy",
  "Package scripts include the model literacy regression check"
);
assertIncludes(
  files.roadmap,
  "first Archive and Construct model",
  "Roadmap records the first model literacy slice"
);

console.log("Model literacy checks passed.");
