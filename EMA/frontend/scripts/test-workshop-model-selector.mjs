import { readFile } from "node:fs/promises";

const files = {
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  workshopCreate: await readFile(
    new URL("../src/components/WorkshopCreateModal.tsx", import.meta.url),
    "utf8"
  ),
  modelLiteracy: await readFile(
    new URL("../src/domain/modelLiteracy.ts", import.meta.url),
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
  foundryDomain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  packageJson: await readFile(new URL("../package.json", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.workshopCreate,
  "archiveEntries?: ModelArchiveEntry[]",
  "Workshop modal accepts cached Archive entries"
);
assertIncludes(
  files.workshopCreate,
  "onSearchBaseModels?: (query: string) => Promise<ModelSearchResult[]>",
  "Workshop modal accepts a Hugging Face-backed search callback"
);
assertIncludes(
  files.workshopCreate,
  "<optgroup label=\"Cached Archive\">",
  "Workshop modal groups cached Archive model choices"
);
assertIncludes(
  files.workshopCreate,
  "<optgroup label=\"Hugging Face results\">",
  "Workshop modal groups Hugging Face search results"
);
assertIncludes(
  files.workshopCreate,
  "Use typed ID",
  "Workshop modal preserves a manual repo-id fallback"
);
assertIncludes(
  files.workshopCreate,
  "Search uses saved Hugging Face credentials.",
  "Workshop modal explains authenticated search behavior"
);
assertIncludes(
  files.app,
  "const searchWorkshopBaseModels = useCallback",
  "App owns the Workshop base-model search contract"
);
assertIncludes(
  files.app,
  "repository.searchArchiveModels",
  "Workshop model search reuses Archive search contracts"
);
assertIncludes(
  files.app,
  "archiveEntries={archiveEntries}",
  "App passes cached Archive entries into Workshop creation"
);
assertIncludes(
  files.app,
  "onSearchBaseModels={searchWorkshopBaseModels}",
  "App passes model search into Workshop creation"
);
assertIncludes(
  files.foundryDomain,
  "export interface ModelRepositoryFile",
  "Model search results can carry repository file metadata"
);
assertIncludes(
  files.modelLiteracy,
  "repositoryFiles?:",
  "Model literacy can inspect repository file metadata"
);
assertIncludes(
  files.modelLiteracy,
  "Detected tokenizer files",
  "Model literacy surfaces tokenizer files when model metadata is available"
);
assertIncludes(
  files.modelLiteracy,
  "Architecture:",
  "Model literacy surfaces architecture metadata when preflight has it"
);
assertIncludes(
  files.artifacts,
  "repositoryFiles: inspectedModel?.siblings",
  "Archive model literacy uses inspected repository files"
);
assertIncludes(
  files.construct,
  "architectures: preflightResult?.architectures",
  "Construct model literacy uses runtime preflight architecture metadata"
);
assertIncludes(
  files.styles,
  ".workshop-model-selector",
  "Workshop model selector has dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:workshop-model-selector",
  "Package scripts include the Workshop model selector regression check"
);

console.log("Workshop model selector checks passed.");
