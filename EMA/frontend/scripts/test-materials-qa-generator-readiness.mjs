import { readFile } from "node:fs/promises";

const files = {
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  contracts: await readFile(new URL("../src/contracts/foundryApi.ts", import.meta.url), "utf8"),
  materials: await readFile(
    new URL("../src/components/MaterialsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  repository: await readFile(
    new URL("../src/services/foundryRepository.ts", import.meta.url),
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
  "data-testid=\"qa-generator-cache-action\"",
  "Materials QA generator cache action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "qaGeneratorCacheReady && !qaGeneratorRuntimeConfigured\n                            ? configureModelBackedGeneratorFromWarning",
  "Cached QA generator cache action configures the runtime before proof"
);
assertIncludes(
  files.materials,
  "is cached and configured. Run the model-backed QA proof next.",
  "Materials cache readiness copy reflects configured runtime state"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-configure-returned-model\"",
  "Materials returned Archive model configure action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-run-model-proof\"",
  "Materials model-backed proof action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "Run the model-backed QA proof before training-quality Assembly Lines.",
  "Materials returned Archive guidance points to the final proof step"
);
assertIncludes(
  files.materials,
  "Cached means available, not quality-approved.",
  "Materials teaches that cached QA models still need quality proof"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-cached-quality-note\"",
  "Materials exposes a stable cached-but-not-quality-passed note for browser smoke tests"
);
assertIncludes(
  files.materials,
  "buildQAProofDiagnostics",
  "Materials derives human-readable QA proof diagnostics from quality metrics"
);
assertIncludes(
  files.materials,
  "buildQAProofFailureReasons",
  "Materials explains why a cached model proof failed"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-proof-details-toggle\"",
  "Materials exposes a stable QA proof details toggle"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-proof-diagnostics\"",
  "Materials exposes the QA proof diagnostics drawer for browser smoke tests"
);
assertIncludes(
  files.materials,
  "repository.getLastQAGeneratorQualityProof(workshop.id)",
  "Materials reloads the latest QA proof evidence for the active Workshop"
);
assertIncludes(
  files.contracts,
  "latestQAGeneratorQualityProof",
  "API contracts expose latest QA proof history"
);
assertIncludes(
  files.repository,
  "foundryApiRoutes.latestQAGeneratorQualityProof(workshopId)",
  "API repository uses backend latest QA proof history"
);
assertIncludes(
  files.materials,
  "repository.rememberQAGeneratorQualityProof(workshop.id, qualityProof)",
  "Materials remembers fresh QA proof evidence after a proof run"
);
assertIncludes(
  files.materials,
  "qaProofMatchesSelectedModel",
  "Materials blocks stale QA proof evidence from unlocking training-quality generation"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-generator-proof-freshness\"",
  "Materials surfaces last QA proof freshness for browser smoke tests"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-export-proof-state\"",
  "Materials surfaces JSONL proof state before export"
);
assertIncludes(
  files.contracts,
  "foundry.qa-proof-state.v1",
  "API contracts define the JSONL QA proof-state payload"
);
assertIncludes(
  files.materials,
  "data-testid=\"jsonl-preview-proof-state\"",
  "Materials shows backend/export QA proof state in JSONL preview"
);
assertIncludes(
  files.materials,
  "Export proof evidence",
  "Materials labels the JSONL preview proof evidence"
);
assertIncludes(
  files.repository,
  "mockQAProofState",
  "Mock repository mirrors backend JSONL QA proof-state summaries"
);
assertIncludes(
  files.materials,
  "JSONL proof state",
  "Materials labels proof state in the JSONL review area"
);
assertIncludes(
  files.materials,
  "Why did this proof fail?",
  "Materials gives users plain-language proof failure details"
);
assertIncludes(
  files.materials,
  "Run proof again",
  "Materials lets users rerun the cached model proof from the failure note"
);
assertIncludes(
  files.materials,
  "Inspect in Archive",
  "Materials links failed proof recovery back to Archive"
);
assertIncludes(
  files.materials,
  "Use smoke mode",
  "Materials keeps a safe smoke-mode fallback visible after failed proof"
);
assertIncludes(
  files.materials,
  "Generated sample",
  "Materials surfaces the failed proof sample row"
);
assertIncludes(
  files.materials,
  "Source preview",
  "Materials compares the generated sample to source evidence"
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
  files.styles,
  ".qa-model-proof-quality-note",
  "Cached QA model quality warning has dedicated styling"
);
assertIncludes(
  files.styles,
  ".qa-model-proof-diagnostics",
  "QA proof diagnostics drawer has dedicated styling"
);
assertIncludes(
  files.styles,
  ".qa-proof-diagnostic-grid",
  "QA proof diagnostics metrics have dedicated grid styling"
);
assertIncludes(
  files.styles,
  ".qa-proof-comparison",
  "QA proof baseline comparison has dedicated styling"
);
assertIncludes(
  files.styles,
  ".qa-proof-evidence",
  "QA proof generated sample and source evidence have dedicated styling"
);
assertIncludes(
  files.styles,
  ".qa-export-proof-state",
  "JSONL proof state has dedicated styling"
);
assertIncludes(
  files.styles,
  ".qa-preview-proof-state",
  "JSONL preview proof-state card has dedicated styling"
);
assertIncludes(
  files.packageJson,
  "test:materials-qa-generator-readiness",
  "Package scripts include the Materials QA generator readiness regression check"
);

console.log("Materials QA generator readiness checks passed.");
