import type { ConstructRuntimePreflightResult } from "./foundry";

export type RuntimeReadinessStatus = "ready" | "caution" | "blocked";

export interface RuntimeReadinessItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  guidance: string;
}

export interface RuntimeReadinessSummary {
  status: RuntimeReadinessStatus;
  title: string;
  summary: string;
  nextAction: string;
  loadButtonLabel: string;
  canLoad: boolean;
  requiresConfirmation: boolean;
  items: RuntimeReadinessItem[];
  warnings: string[];
}

const readinessGuidanceByCheck: Record<string, Record<RuntimeReadinessItem["status"], string>> = {
  config: {
    pass: "The architecture metadata is readable, so The Foundry can choose the right model loader.",
    warn: "The config loaded with caveats. Review model notes before loading.",
    fail: "The runtime cannot identify the model architecture. Check the local path, repo id, or gated access.",
  },
  tokenizer: {
    pass: "The tokenizer is available, so prompts can be converted into model tokens.",
    warn: "Tokenizer loaded with caveats. Short smoke prompts are safest.",
    fail: "The model cannot tokenize prompts yet. Download tokenizer files or verify Hugging Face access.",
  },
  memory: {
    pass: "Estimated memory leaves comfortable headroom for loading and generation.",
    warn: "The model may fit, but use shorter context and output caps until a smoke test passes.",
    fail: "The estimated load exceeds the safe memory budget. Try a smaller model or quantized build.",
  },
};

const defaultReadinessGuidance: Record<RuntimeReadinessItem["status"], string> = {
  pass: "This compatibility check is clear.",
  warn: "This check is not blocking, but it deserves review before loading.",
  fail: "This check blocks safe loading until it is resolved.",
};

export const buildRuntimeReadinessSummary = (
  preflightResult: ConstructRuntimePreflightResult
): RuntimeReadinessSummary => {
  const failedChecks = preflightResult.checks.filter((check) => check.status === "fail");
  const warningChecks = preflightResult.checks.filter((check) => check.status === "warn");
  const status: RuntimeReadinessStatus =
    failedChecks.length > 0 || !preflightResult.ok
      ? "blocked"
      : warningChecks.length > 0 || preflightResult.warnings.length > 0
      ? "caution"
      : "ready";
  const title =
    status === "ready"
      ? "Ready to load"
      : status === "caution"
      ? "Load with caution"
      : "Fix before loading";
  const summary =
    status === "ready"
      ? "The model passed compatibility checks. You can load it, then run the smoke test."
      : status === "caution"
      ? "The model is likely usable, but the runtime found constraints worth reviewing first."
      : "One or more required checks failed. Resolve the blockers before loading the model.";
  const nextAction =
    status === "ready"
      ? "Click Load Current Model, then run the smoke test."
      : status === "caution"
      ? "Review the warnings, then choose Load Anyway if you want to continue."
      : "Fix the failed checks, preflight again, then load.";
  const loadButtonLabel =
    status === "ready"
      ? "Load Current Model"
      : status === "caution"
      ? "Load Anyway"
      : "Blocked";

  return {
    status,
    title,
    summary,
    nextAction,
    loadButtonLabel,
    canLoad: status !== "blocked",
    requiresConfirmation: status === "caution",
    items: preflightResult.checks.map((check) => ({
      ...check,
      guidance:
        readinessGuidanceByCheck[check.id]?.[check.status] ||
        defaultReadinessGuidance[check.status],
    })),
    warnings: preflightResult.warnings,
  };
};
