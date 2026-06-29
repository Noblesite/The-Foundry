import { readFile } from "node:fs/promises";

const files = {
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  forge: await readFile(new URL("../src/components/ForgeWorkbench.tsx", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  packageJson: await readFile(new URL("../package.json", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.forge,
  "buildSystemReadinessSummary",
  "Forge derives base-model readiness from the shared readiness contract"
);
assertIncludes(
  files.forge,
  "defaultBaseModel: draft.baseModel",
  "Forge evaluates the draft base model rather than only global settings"
);
assertIncludes(
  files.forge,
  "constructModelId: draft.baseModel",
  "Forge keeps Construct readiness aligned with the selected base model"
);
assertIncludes(
  files.forge,
  "forge-model-readiness",
  "Forge renders the base-model readiness strip"
);
assertIncludes(
  files.forge,
  "Cache before real training",
  "Forge warns when the base model should be cached before training"
);
assertIncludes(
  files.forge,
  "Prepare in Archive",
  "Forge offers an Archive preparation action"
);
assertIncludes(
  files.forge,
  "onPrepareModel?.(selectedBaseModelReadiness.modelAction)",
  "Forge routes readiness actions through the shared model preparation handler"
);
assertIncludes(
  files.app,
  "sourceStatus={foundryStatus}",
  "App passes runtime service status into Forge readiness"
);
assertIncludes(
  files.app,
  "runtime={constructRuntime}",
  "App passes Construct runtime into Forge readiness"
);
assertIncludes(
  files.app,
  "preparationActivity={modelPreparationActivity}",
  "App passes model preparation activity into Forge"
);
assertIncludes(
  files.app,
  "onPrepareModel={handlePrepareModel}",
  "App passes the shared model preparation handler into Forge"
);
assertIncludes(
  files.styles,
  ".forge-model-readiness",
  "Forge model readiness strip has dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:forge-model-readiness",
  "Package scripts include the Forge model readiness regression check"
);

console.log("Forge model readiness checks passed.");
