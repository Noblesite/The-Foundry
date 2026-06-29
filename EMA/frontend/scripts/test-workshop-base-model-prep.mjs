import { readFile } from "node:fs/promises";

const files = {
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  callout: await readFile(
    new URL("../src/components/WorkshopBaseModelCallout.tsx", import.meta.url),
    "utf8"
  ),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  packageJson: await readFile(new URL("../package.json", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.callout,
  "buildSystemReadinessSummary",
  "Base-model callout uses the shared readiness contract"
);
assertIncludes(
  files.callout,
  "defaultBaseModel: modelId",
  "Base-model callout evaluates the Workshop-selected base model"
);
assertIncludes(
  files.callout,
  "constructModelId: modelId",
  "Base-model callout keeps Construct readiness aligned with the Workshop model"
);
assertIncludes(
  files.callout,
  "Cache it now so later stations do not stop for",
  "Base-model callout explains why preparation belongs early"
);
assertIncludes(
  files.callout,
  "onPrepareModel(readiness.modelAction)",
  "Base-model callout routes to the shared preparation action"
);
assertIncludes(
  files.app,
  "baseModelPreparationTarget",
  "App tracks a first-run base-model preparation target"
);
assertIncludes(
  files.app,
  "setBaseModelPreparationTarget({",
  "App creates a preparation target after Workshop creation"
);
assertIncludes(
  files.app,
  "defaultBaseModel: request.baseModel || settings.defaultBaseModel",
  "Workshop creation persists the selected base model as the default"
);
assertIncludes(
  files.app,
  "constructModelId: request.baseModel || settings.constructModelId",
  "Workshop creation persists the selected base model for Construct"
);
assertIncludes(
  files.app,
  "<WorkshopBaseModelCallout",
  "App renders the first-run base-model callout"
);
assertIncludes(
  files.app,
  "purpose: \"base-model\"",
  "Prepare action passes a base-model Archive handoff"
);
assertIncludes(
  files.app,
  "preflightOnOpen: true",
  "Prepare action opens Archive with preflight queued"
);
assertIncludes(
  files.styles,
  ".workshop-base-model-callout",
  "Base-model preparation callout has dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:workshop-base-model-prep",
  "Package scripts include the base-model prep regression check"
);

console.log("Workshop base-model preparation checks passed.");
