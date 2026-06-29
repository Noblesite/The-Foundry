import { readFile } from "node:fs/promises";

const files = {
  domain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  contracts: await readFile(new URL("../src/contracts/foundryApi.ts", import.meta.url), "utf8"),
  repository: await readFile(
    new URL("../src/services/foundryRepository.ts", import.meta.url),
    "utf8"
  ),
  construct: await readFile(
    new URL("../src/components/ConstructWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  app: await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  styles: await readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  roadmap: await readFile(new URL("../../../docs/roadmap.md", import.meta.url), "utf8"),
  catalog: await readFile(
    new URL("../../backend/services/foundry_catalog_service.py", import.meta.url),
    "utf8"
  ),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.domain,
  "export interface ConstructPromptChain",
  "Construct domain exposes a prompt-chain contract"
);
assertIncludes(
  files.domain,
  'contractVersion: "foundry.construct.prompt-chain.v1"',
  "Prompt-chain contract is versioned"
);
assertIncludes(
  files.contracts,
  "systemPrompt?: string",
  "Construct chat API request accepts an optional system prompt"
);
assertIncludes(
  files.repository,
  "promptChain",
  "Mock Construct repository emits prompt-chain metadata"
);
assertIncludes(
  files.repository,
  "systemPromptPresent",
  "Mock prompt-chain records whether a system prompt was present"
);
assertIncludes(
  files.catalog,
  "def _construct_prompt_chain(",
  "Backend catalog creates prompt-chain metadata"
);
assertIncludes(
  files.catalog,
  '"instructionOrder": ["system", "user", "library-context", "generation-settings"]',
  "Backend prompt-chain records instruction ordering"
);
assertIncludes(
  files.construct,
  "const [systemPrompt, setSystemPrompt]",
  "Construct workbench stores editable system prompt state"
);
assertIncludes(
  files.construct,
  "const buildEvidenceSystemPrompt =",
  "Construct workbench defines a source-grounded prompt variant for comparisons"
);
assertIncludes(
  files.construct,
  "systemPromptOverride?: string",
  "Construct send path can run one-off system prompt variants"
);
assertIncludes(
  files.construct,
  "System Prompt",
  "Construct workbench labels the system prompt field"
);
assertIncludes(
  files.construct,
  "User Prompt",
  "Construct composer labels the user prompt field"
);
assertIncludes(
  files.construct,
  "systemPrompt: activePromptChain.systemPrompt || undefined",
  "Construct stream request sends the active system prompt"
);
assertIncludes(
  files.construct,
  "promptChain: event.generation.promptChain || activePromptChain",
  "Construct response inspection stores backend prompt-chain metadata"
);
assertIncludes(
  files.construct,
  "title=\"System vs user prompt\"",
  "Construct learning rail explains prompt roles"
);
assertIncludes(
  files.construct,
  "Rerun Last User Prompt",
  "Construct prompt workbench can rerun the last user prompt for comparison"
);
assertIncludes(
  files.construct,
  "Run Comparison Recipe",
  "Construct prompt workbench offers a guided two-run comparison recipe"
);
assertIncludes(
  files.construct,
  "const runPromptComparisonRecipe = async () =>",
  "Construct comparison recipe captures prompt variants through the normal stream path"
);
assertIncludes(
  files.construct,
  "includeLibraryContextOverride: true",
  "Construct comparison recipe forces library context on for the source-grounded variant"
);
assertIncludes(
  files.construct,
  "Open Trial Comparison",
  "Construct workbench can hand prompt variants to Trials comparison"
);
assertIncludes(
  files.app,
  "const handleOpenTrialComparison = useCallback(() =>",
  "App owns the Construct to Trials comparison handoff"
);
assertIncludes(
  files.app,
  'targetLabel: "Prompt comparison"',
  "Trials handoff focuses the prompt comparison panel"
);
assertIncludes(
  files.styles,
  ".prompt-workbench",
  "Prompt workbench has dedicated Foundry styling"
);
assertIncludes(
  files.styles,
  ".prompt-compare-actions",
  "Prompt comparison actions have dedicated styling"
);
assertIncludes(
  files.styles,
  ".prompt-recipe-state",
  "Prompt comparison recipe status has dedicated spacing"
);
assertIncludes(
  files.styles,
  ".user-prompt-field",
  "User prompt composer has accessible label styling"
);
assertIncludes(
  files.roadmap,
  "Trial prompt-evidence comparison, Construct-to-Trials handoff, and two-run",
  "Roadmap records the completed prompt-chain slice"
);

console.log("Construct prompt-chain contract checks passed.");
