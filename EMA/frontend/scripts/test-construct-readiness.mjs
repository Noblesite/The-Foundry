import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = new URL("../src/domain/constructReadiness.ts", import.meta.url);
const outDir = new URL("../node_modules/.tmp/readiness-tests/", import.meta.url);
const outFile = new URL("constructReadiness.mjs", outDir);

const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: "constructReadiness.ts",
});

await mkdir(outDir, { recursive: true });
await writeFile(outFile, transpiled.outputText, "utf8");

const { buildRuntimeReadinessSummary } = await import(outFile.href);

const createPreflight = (overrides = {}) => ({
  ok: true,
  modelId: "runtime/models/huggingface/sshleifer-tiny-gpt2",
  device: "mps",
  localFilesOnly: true,
  modelType: "gpt2",
  architectures: ["GPT2LMHeadModel"],
  contextWindow: 1024,
  parameterCountEstimate: 102714,
  estimatedLoadBytes: 513570,
  availableBytes: 18 * 1024 ** 3,
  fitStatus: "fits",
  checks: [
    {
      id: "config",
      label: "Model config",
      status: "pass",
      detail: "gpt2 config is readable.",
    },
    {
      id: "tokenizer",
      label: "Tokenizer",
      status: "pass",
      detail: "Tokenizer loaded with vocab size 50257.",
    },
    {
      id: "memory",
      label: "Memory fit",
      status: "pass",
      detail: "Estimated load fits with comfortable headroom.",
    },
  ],
  warnings: [],
  diagnostics: {},
  ...overrides,
});

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
};

const assertIncludes = (actual, expected, message) => {
  if (!actual.includes(expected)) {
    throw new Error(`${message}: expected "${actual}" to include "${expected}"`);
  }
};

const ready = buildRuntimeReadinessSummary(createPreflight());
assertEqual(ready.status, "ready", "Ready preflight status");
assertEqual(ready.canLoad, true, "Ready preflight can load");
assertEqual(ready.requiresConfirmation, false, "Ready preflight confirmation");
assertEqual(ready.loadButtonLabel, "Load Current Model", "Ready preflight load label");
assertIncludes(
  ready.items.find((item) => item.label === "Tokenizer")?.guidance || "",
  "prompts can be converted",
  "Ready tokenizer guidance"
);

const caution = buildRuntimeReadinessSummary(
  createPreflight({
    fitStatus: "tight",
    checks: [
      {
        id: "config",
        label: "Model config",
        status: "pass",
        detail: "gpt2 config is readable.",
      },
      {
        id: "tokenizer",
        label: "Tokenizer",
        status: "pass",
        detail: "Tokenizer loaded with vocab size 50257.",
      },
      {
        id: "memory",
        label: "Memory fit",
        status: "warn",
        detail: "Estimated load may fit, but context should stay conservative.",
      },
    ],
    warnings: ["Estimated load size may fit, but context and generation settings should stay conservative."],
  })
);
assertEqual(caution.status, "caution", "Caution preflight status");
assertEqual(caution.canLoad, true, "Caution preflight can load");
assertEqual(caution.requiresConfirmation, true, "Caution preflight confirmation");
assertEqual(caution.loadButtonLabel, "Load Anyway", "Caution preflight load label");

const blocked = buildRuntimeReadinessSummary(
  createPreflight({
    ok: false,
    fitStatus: "too-large",
    checks: [
      {
        id: "config",
        label: "Model config",
        status: "pass",
        detail: "gpt2 config is readable.",
      },
      {
        id: "tokenizer",
        label: "Tokenizer",
        status: "pass",
        detail: "Tokenizer loaded with vocab size 50257.",
      },
      {
        id: "memory",
        label: "Memory fit",
        status: "fail",
        detail: "Estimated load exceeds available memory.",
      },
    ],
    warnings: ["Estimated load size exceeds the conservative runtime budget for this machine."],
  })
);
assertEqual(blocked.status, "blocked", "Blocked preflight status");
assertEqual(blocked.canLoad, false, "Blocked preflight can load");
assertEqual(blocked.requiresConfirmation, false, "Blocked preflight confirmation");
assertEqual(blocked.loadButtonLabel, "Blocked", "Blocked preflight load label");
