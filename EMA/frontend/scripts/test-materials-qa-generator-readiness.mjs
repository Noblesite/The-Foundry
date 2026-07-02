import { readFile } from "node:fs/promises";

const files = {
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  materials: await readFile(
    new URL("../src/components/MaterialsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  baseModelSelector: await readFile(
    new URL("../src/components/BaseModelSelector.tsx", import.meta.url),
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
  files.materials,
  "archiveEntries?: ModelArchiveEntry[]",
  "Materials accepts cached Archive entries"
);
assertIncludes(
  files.materials,
  "onSearchBaseModels?: (query: string) => Promise<ModelSearchResult[]>",
  "Materials accepts the shared model search callback"
);
assertIncludes(
  files.materials,
  "<BaseModelSelector",
  "Materials uses the shared model selector for QA generator models"
);
assertIncludes(
  files.materials,
  "Search Hugging Face QA generator models",
  "QA generator model selector uses QA-specific accessible copy"
);
assertIncludes(
  files.materials,
  "qa-generator-cache-readiness",
  "Materials renders the QA generator cache readiness hint"
);
assertIncludes(
  files.materials,
  "Cache before training-quality QA",
  "Materials warns users to cache a model before real QA generation"
);
assertIncludes(
  files.materials,
  "Prepare in Archive",
  "Materials offers the Archive preparation action for uncached QA generator models"
);
assertIncludes(
  files.materials,
  "Live QA proof still required",
  "Materials distinguishes simulated proof from training-unlock evidence"
);
assertIncludes(
  files.materials,
  "real local Transformers generator",
  "Materials explains that training-quality rows need a real local generator proof"
);
assertIncludes(
  files.materials,
  "openQAGeneratorArchive",
  "QA generator readiness routes uncached models through Archive"
);
assertIncludes(
  files.app,
  "archiveEntries={archiveEntries}",
  "App passes cached Archive entries into Materials"
);
assertIncludes(
  files.app,
  "onSearchBaseModels={searchWorkshopBaseModels}",
  "App passes shared model search into Materials"
);
assertIncludes(
  files.baseModelSelector,
  "searchAriaLabel",
  "Shared model selector supports contextual accessible labels"
);
assertIncludes(
  files.styles,
  ".qa-generator-cache-readiness",
  "QA generator cache readiness hint has dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:materials-qa-generator-readiness",
  "Package scripts include the Materials QA generator readiness regression check"
);

console.log("Materials QA generator readiness checks passed.");
