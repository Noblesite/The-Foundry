import { readFile } from "node:fs/promises";

const files = {
  api: await readFile(new URL("../src/contracts/foundryApi.ts", import.meta.url), "utf8"),
  repository: await readFile(new URL("../src/services/foundryRepository.ts", import.meta.url), "utf8"),
  materials: await readFile(
    new URL("../src/components/MaterialsWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  domain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  academy: await readFile(new URL("../src/domain/academyRegistry.ts", import.meta.url), "utf8"),
  packageJson: await readFile(new URL("../package.json", import.meta.url), "utf8"),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.api,
  "previewMaterialSource",
  "API routes expose the Material source preview endpoint"
);
assertIncludes(
  files.api,
  "evaluateMaterialSource",
  "API routes expose the Material source evaluator endpoint"
);
assertIncludes(
  files.api,
  "DeleteMaterialResult",
  "API contract exposes Material delete result"
);
assertIncludes(
  files.repository,
  "previewMaterialSource:",
  "Repository exposes Material source preview"
);
assertIncludes(
  files.repository,
  "evaluateMaterialSource:",
  "Repository exposes Material source evaluation"
);
assertIncludes(
  files.repository,
  "deleteMaterial:",
  "Repository exposes Material deletion"
);
assertIncludes(
  files.domain,
  "foundry.material.source-preview.v1",
  "Domain contract includes Material source preview version"
);
assertIncludes(
  files.domain,
  "foundry.source-evaluator.v1",
  "Domain contract includes source evaluator version"
);
assertIncludes(
  files.materials,
  "material-detail-drawer",
  "Materials renders the detail drawer"
);
assertIncludes(
  files.materials,
  "Source Preview",
  "Material drawer shows extracted source preview"
);
assertIncludes(
  files.materials,
  "What QA generation will see",
  "Material drawer explains generated chunks"
);
assertIncludes(
  files.materials,
  "focusMaterialReview",
  "Material drawer can focus QA Review on one Material"
);
assertIncludes(
  files.materials,
  "Review this Material",
  "Material drawer exposes a review action"
);
assertIncludes(
  files.materials,
  "materialPendingDeletionId",
  "Materials stores pending Material deletion state"
);
assertIncludes(
  files.materials,
  "confirmMaterialDelete",
  "Materials can confirm Material deletion"
);
assertIncludes(
  files.materials,
  "data-testid={`material-delete-${material.id}`}",
  "Material delete actions have stable browser-test hooks"
);
assertIncludes(
  files.materials,
  "data-testid={`material-delete-confirm-${material.id}`}",
  "Material delete confirmations have stable browser-test hooks"
);
assertIncludes(
  files.materials,
  "selectedMaterialReviewFilterId",
  "QA Review stores the active Material filter"
);
assertIncludes(
  files.materials,
  "All Materials",
  "QA Review exposes a Material filter dropdown"
);
assertIncludes(
  files.materials,
  "Material Review Filter",
  "QA Review shows active Material filter context"
);
assertIncludes(
  files.materials,
  "Crawl Map",
  "Material drawer shows website crawl metadata"
);
assertIncludes(
  files.materials,
  "Source Evaluator",
  "Material drawer teaches source evaluation"
);
assertIncludes(
  files.materials,
  "Evaluator system prompt",
  "Material drawer exposes evaluator system prompt"
);
assertIncludes(
  files.materials,
  "materialsSourceEvaluation",
  "Material drawer uses Source Evaluation Academy guidance"
);
assertIncludes(
  files.materials,
  "evaluateSelectedMaterialSource",
  "Material drawer can run source evaluation"
);
assertIncludes(
  files.materials,
  "Model review before QA generation",
  "Material drawer labels model review before QA"
);
assertIncludes(
  files.materials,
  "sourceEvaluationsByMaterialId",
  "Materials stores source evaluation results per Material"
);
assertIncludes(
  files.materials,
  "sourceEvaluationGate",
  "Assembly Line computes source evaluation gate state"
);
assertIncludes(
  files.materials,
  "Assembly Line source-evaluation gate",
  "Assembly Line renders a source evaluation gate"
);
assertIncludes(
  files.materials,
  "Source evaluation required",
  "Training-quality Assembly Line blocks missing source evaluations"
);
assertIncludes(
  files.materials,
  "Inspect missing source",
  "Source evaluation gate can open the Material evaluator"
);
assertIncludes(
  files.materials,
  "data-testid=\"source-gate-inspect-missing\"",
  "Source evaluation gate has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"source-evaluator-run\"",
  "Source evaluator run action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"assembly-start-training\"",
  "Training Assembly Line start has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"qa-review-material-filter\"",
  "QA Review Material filter has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid={`qa-accept-${qaPair.id}`}",
  "QA Review accept actions have stable browser-test hooks"
);
assertIncludes(
  files.materials,
  "data-testid=\"jsonl-preview\"",
  "JSONL preview action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"jsonl-override-quality\"",
  "JSONL quality override has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "data-testid=\"jsonl-export\"",
  "JSONL export action has a stable browser-test hook"
);
assertIncludes(
  files.materials,
  "not evaluated",
  "Material Catalog labels Materials without source evaluation"
);
assertIncludes(
  files.styles,
  ".material-detail-drawer",
  "Material drawer has dedicated styling"
);
assertIncludes(
  files.styles,
  ".material-source-preview",
  "Extracted source preview has readable styling"
);
assertIncludes(
  files.styles,
  ".material-review-focus",
  "Focused Material review state has dedicated styling"
);
assertIncludes(
  files.styles,
  ".source-evaluator-panel",
  "Source evaluator panel has dedicated styling"
);
assertIncludes(
  files.styles,
  ".source-gate-material",
  "Source evaluation gate has dedicated interactive styling"
);
assertIncludes(
  files.styles,
  ".source-evaluation-badge",
  "Material Catalog source evaluation badges have dedicated styling"
);
assertIncludes(
  files.styles,
  ".material-delete-confirm",
  "Material delete confirmation has dedicated styling"
);
assertIncludes(
  files.academy,
  "source-evaluation",
  "Academy registry includes Source Evaluation concept"
);
assertIncludes(
  files.academy,
  "What does the evaluator system prompt do?",
  "Academy registry explains evaluator system prompts"
);
assertIncludes(
  files.packageJson,
  "test:material-detail-drawer",
  "Package scripts include the Material detail drawer regression check"
);

console.log("Material detail drawer checks passed.");
