import { readFile } from "node:fs/promises";

const trialsWorkbench = await readFile(
  new URL("../src/components/TrialsWorkbench.tsx", import.meta.url),
  "utf8"
);
const repository = await readFile(
  new URL("../src/services/foundryRepository.ts", import.meta.url),
  "utf8"
);

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  trialsWorkbench,
  "const reviewedTrialVerdicts: ReviewedTrialVerdict[] = [\"pass\", \"needs-work\", \"fail\"]",
  "Trials review queue exposes only reviewed verdict choices"
);
assertIncludes(
  trialsWorkbench,
  "const needsReviewTrials = useMemo(",
  "Trials page tracks auto-captured needs-review rows"
);
assertIncludes(
  trialsWorkbench,
  "const selectedHasUnreviewedTrials = selectedTrials.some(",
  "Trials export detects selected unreviewed rows"
);
assertIncludes(
  trialsWorkbench,
  "const reviewTrial = async (trial: Trial, verdict: ReviewedTrialVerdict) =>",
  "Trials page can promote an auto-captured Trial through the repository contract"
);
assertIncludes(
  trialsWorkbench,
  "repository.createTrial(workshop.id, {",
  "Trials review queue reuses the durable Trial upsert endpoint"
);
assertIncludes(
  trialsWorkbench,
  "const promoteBestComparisonVariant = async (comparison: TrialComparison) =>",
  "Trials comparison cards can promote the strongest variant"
);
assertIncludes(
  trialsWorkbench,
  "Promote Best Variant",
  "Trials comparison cards expose a promotion action"
);
assertIncludes(
  trialsWorkbench,
  "as pass evidence for Artifact readiness",
  "Trials promotion explains the Artifact readiness handoff"
);
assertIncludes(
  trialsWorkbench,
  "current.includes(promotedTrial.id) ? current : [...current, promotedTrial.id]",
  "Promoted comparison Trials are selected for JSONL export"
);
assertIncludes(
  trialsWorkbench,
  "Review selected needs-review Trials before exporting them as JSONL.",
  "Trials export explains why unreviewed rows are blocked"
);
assertIncludes(
  trialsWorkbench,
  "className=\"trial-review-queue\"",
  "Trials cards expose an in-list review queue"
);
assertIncludes(
  trialsWorkbench,
  "const trialRuntimeEvidence = (trial: Trial) =>",
  "Trials page derives readable runtime evidence from the durable Trial profile"
);
assertIncludes(
  trialsWorkbench,
  "Real local stream",
  "Trials page distinguishes live local model streams from simulated output"
);
assertIncludes(
  trialsWorkbench,
  "Not model-quality proof",
  "Trials page warns that simulated Trial output is not model-quality evidence"
);
assertIncludes(
  trialsWorkbench,
  "className={`trial-runtime-evidence evidence-${evidence.tone}`}",
  "Trials cards surface runtime evidence above raw metadata"
);
assertIncludes(
  trialsWorkbench,
  "const promptChainForTrial = (trial: Trial): ConstructPromptChain | null =>",
  "Trials page derives prompt-chain evidence from saved generation settings"
);
assertIncludes(
  trialsWorkbench,
  "promptVariantGroups",
  "Trials comparison summary counts prompt-chain variants"
);
assertIncludes(
  trialsWorkbench,
  "className=\"trial-prompt-chain\"",
  "Trials cards expose prompt-chain evidence beside runtime evidence"
);
assertIncludes(
  trialsWorkbench,
  "Read the prompt chain",
  "Trials page teaches users how to compare system and user prompt evidence"
);
assertIncludes(
  trialsWorkbench,
  "type TrialFilter = \"all\" | \"live-local\" | \"adapter-backed\" | \"simulated\" | \"needs-review\"",
  "Trials page defines the runtime evidence filter contract"
);
assertIncludes(
  trialsWorkbench,
  "const trialMatchesFilter = (trial: Trial, filter: TrialFilter) =>",
  "Trials filter predicate keeps live local, adapter-backed, simulated, and review states explicit"
);
assertIncludes(
  trialsWorkbench,
  "className=\"trial-filter-bar\"",
  "Trials page exposes a filter bar for runtime evidence views"
);
assertIncludes(
  trialsWorkbench,
  "Select visible",
  "Trials export controls can select only the currently filtered rows"
);
assertIncludes(
  trialsWorkbench,
  "className=\"evaluation-report-actions\"",
  "Trial Report cards expose direct corrective actions"
);
assertIncludes(
  trialsWorkbench,
  "openWeakSampleReview(summary, { openForge: true })",
  "Trial Report cards can export weak samples and open Forge"
);
assertIncludes(
  trialsWorkbench,
  "Export and Train",
  "Weak sample review supports the corrective Forge loop"
);
assertIncludes(
  repository,
  "throw new Error(\"Review auto-captured Trials before exporting them to JSONL.\");",
  "Mock repository blocks unreviewed Trial export like the backend"
);
