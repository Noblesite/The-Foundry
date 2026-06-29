import React, { useEffect, useMemo, useRef, useState } from "react";
import { StartForgeRequest } from "../contracts/foundryApi";
import { ACADEMY_ACTION_IDS, findAcademyAction } from "../domain/academyRegistry";
import {
  AcademyAction,
  FoundryLoopFocus,
  ForgeEvaluationReport,
  ForgeRun,
  ReviewedTrialVerdict,
  SectionSummary,
  ConstructPromptChain,
  Trial,
  TrialVerdict,
  Workshop,
} from "../domain/foundry";
import { FoundryRepository } from "../services/foundryRepository";
import { AcademyActionTooltip, LearningAction, LearningCard } from "./LearningComponents";
import LoopFocusCallout from "./LoopFocusCallout";

interface TrialsWorkbenchProps {
  academyActions: AcademyAction[];
  repository: FoundryRepository;
  summary: SectionSummary;
  workshop: Workshop;
  onOpenAcademy: (conceptId?: string) => void;
  onOpenAcademyAction: (actionId: string) => void;
  onOpenForgePreset: (preset: StartForgeRequest) => void;
  onLoopEvidenceRefresh?: () => void;
  loopFocus?: FoundryLoopFocus | null;
}

const verdictLabels: Record<TrialVerdict, string> = {
  pass: "Pass",
  "needs-work": "Needs work",
  fail: "Fail",
  "needs-review": "Needs review",
};

const runtimeSourceLabels: Record<string, string> = {
  simulated: "Simulated",
  "base-only": "Base model",
  "adapter-backed": "Adapter-backed",
};

const runtimeSourceLabel = (source?: string) =>
  runtimeSourceLabels[source || ""] || source || "Unknown runtime";

const runtimeModeLabel = (mode?: string) => {
  if (mode === "transformers") {
    return "Local Transformers";
  }
  if (mode === "simulated") {
    return "Simulated";
  }
  return mode || "Unknown runtime";
};

const trialRuntimeEvidence = (trial: Trial) => {
  const profile = trial.runtimeProfile;
  const runtimeMode = profile?.runtimeMode || trial.runtimeMode;
  const source = profile?.source || (runtimeMode === "simulated" ? "simulated" : "base-only");
  const modelId = profile?.modelId || profile?.baseModel || "unknown model";
  const device = profile?.device || "unknown device";

  if (runtimeMode === "transformers" && source === "adapter-backed") {
    return {
      tone: "live-adapter",
      icon: "fa-bolt",
      kicker: "Real local stream",
      title: "Adapter-backed local model",
      detail: `Transformers streamed from ${modelId} on ${device}; the Artifact adapter was applied.`,
    };
  }

  if (runtimeMode === "transformers") {
    return {
      tone: "live-base",
      icon: "fa-microchip",
      kicker: "Real local stream",
      title: "Base model only",
      detail: `Transformers streamed from ${modelId} on ${device}; no adapter was applied.`,
    };
  }

  if (source === "simulated" || runtimeMode === "simulated") {
    return {
      tone: "simulated",
      icon: "fa-flask",
      kicker: "Simulated contract",
      title: "Not model-quality proof",
      detail: "This Trial proves the UI/API loop, but it did not stream from a loaded local model.",
    };
  }

  return {
    tone: "unknown",
    icon: "fa-circle-question",
    kicker: runtimeModeLabel(runtimeMode),
    title: runtimeSourceLabel(source),
    detail: "Runtime evidence is incomplete. Re-run the Construct prompt after loading a model.",
  };
};

const verdictRank: Record<TrialVerdict, number> = {
  pass: 3,
  "needs-work": 2,
  fail: 1,
  "needs-review": 0,
};

const reviewedTrialVerdicts: ReviewedTrialVerdict[] = ["pass", "needs-work", "fail"];

const normalizePrompt = (prompt: string) =>
  prompt.trim().toLowerCase().replace(/\s+/g, " ");

const shortValue = (value: string, length = 48) =>
  value.length > length ? `${value.slice(0, length - 1)}...` : value;

const promptChainForTrial = (trial: Trial): ConstructPromptChain | null =>
  trial.generationSettings.promptChain || null;

const promptChainSystemLabel = (promptChain: ConstructPromptChain | null) => {
  if (!promptChain) {
    return "not recorded";
  }
  if (!promptChain.systemPromptPresent) {
    return "not set";
  }
  return shortValue(promptChain.systemPromptPreview || promptChain.systemPrompt, 64);
};

const promptChainOrderLabel = (promptChain: ConstructPromptChain | null) =>
  promptChain?.instructionOrder?.join(" -> ") || "not recorded";

const promptChainLibraryLabel = (promptChain: ConstructPromptChain | null) => {
  if (!promptChain) {
    return "not recorded";
  }
  return promptChain.includeLibraryContext ? "included" : "off";
};

interface EvaluationReportSummary {
  forgeRun: ForgeRun;
  report: ForgeEvaluationReport;
}

interface ReviewedWeakSample {
  id: string;
  include: boolean;
  instruction: string;
  expected: string;
  observed: string;
  verdict: Exclude<ReviewedTrialVerdict, "pass">;
  note: string;
}

type ReadinessState =
  | "needs-more-data"
  | "ready-for-forge"
  | "candidate-artifact"
  | "ready-for-construct";
type TrialsLoopFocusTarget = "comparison" | "export" | "list";
type TrialFilter = "all" | "live-local" | "adapter-backed" | "simulated" | "needs-review";

const trialsLoopFocusTarget = (
  focus?: FoundryLoopFocus | null
): TrialsLoopFocusTarget | null => {
  if (!focus || focus.section !== "trials") {
    return null;
  }
  if (focus.targetLabel.toLowerCase().includes("export")) {
    return "export";
  }
  if (focus.targetLabel.toLowerCase().includes("comparison")) {
    return "comparison";
  }
  return "list";
};

const readinessLabels: Record<ReadinessState, string> = {
  "needs-more-data": "Needs more data",
  "ready-for-forge": "Ready for another Forge",
  "candidate-artifact": "Candidate Artifact",
  "ready-for-construct": "Ready for Construct",
};

const trialFilterLabels: Record<TrialFilter, string> = {
  all: "All",
  "live-local": "Live local",
  "adapter-backed": "Adapter-backed",
  simulated: "Simulated",
  "needs-review": "Needs review",
};

const trialFilterOrder: TrialFilter[] = [
  "all",
  "live-local",
  "adapter-backed",
  "simulated",
  "needs-review",
];

const trialMatchesFilter = (trial: Trial, filter: TrialFilter) => {
  const runtimeMode = trial.runtimeProfile?.runtimeMode || trial.runtimeMode;
  const source = trial.runtimeProfile?.source || (runtimeMode === "simulated" ? "simulated" : "");

  if (filter === "all") {
    return true;
  }
  if (filter === "live-local") {
    return runtimeMode === "transformers";
  }
  if (filter === "adapter-backed") {
    return source === "adapter-backed";
  }
  if (filter === "simulated") {
    return runtimeMode === "simulated" || source === "simulated";
  }
  return trial.verdict === "needs-review";
};

const getReportTime = (report: ForgeEvaluationReport) => Date.parse(report.createdAt) || 0;

const getReadinessState = (report: ForgeEvaluationReport): ReadinessState => {
  if (report.rowCount < 10) {
    return "needs-more-data";
  }
  if (report.passRate >= 90 && report.failCount === 0) {
    return "ready-for-construct";
  }
  const acceptableFailures = Math.max(1, Math.floor(report.rowCount * 0.08));
  if (report.passRate >= 78 && report.failCount <= acceptableFailures) {
    return "candidate-artifact";
  }
  return "ready-for-forge";
};

const getReadinessReason = (report: ForgeEvaluationReport): string => {
  const readiness = getReadinessState(report);
  if (readiness === "needs-more-data") {
    return "Add more evaluation rows before trusting this score.";
  }
  if (readiness === "ready-for-construct") {
    return "High pass rate with no failed samples. This Artifact is ready for Construct testing.";
  }
  if (readiness === "candidate-artifact") {
    return "Good signal, but review weak samples before promotion.";
  }
  return "Use failed and needs-work rows to train another Artifact.";
};

const formatDelta = (value: number, suffix = "%"): string => {
  if (value === 0) {
    return `0${suffix}`;
  }
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
};

const weakSampleCount = (report: ForgeEvaluationReport): number =>
  report.samples.filter((sample) => sample.verdict !== "pass").length;

const isWeakVerdict = (
  verdict: TrialVerdict
): verdict is Exclude<ReviewedTrialVerdict, "pass"> =>
  verdict === "needs-work" || verdict === "fail";

const createReviewedSamples = (report: ForgeEvaluationReport): ReviewedWeakSample[] =>
  report.samples.flatMap((sample, index) => {
    if (!isWeakVerdict(sample.verdict)) {
      return [];
    }
    return [{
      id: `${report.forgeRunId}-${index}`,
      include: true,
      instruction: sample.instruction,
      expected: sample.expected,
      observed: sample.observed,
      verdict: sample.verdict,
      note: sample.note,
    }];
  });

const createForgePreset = (
  forgeRun: ForgeRun,
  materialSetId: string,
  purpose: StartForgeRequest["purpose"]
): StartForgeRequest => ({
  materialSetId,
  baseModel: forgeRun.baseModel || "mistralai/Mistral-7B-Instruct-v0.2",
  method: forgeRun.method === "LoRA" ? "LoRA" : "QLoRA",
  purpose,
  epochs: forgeRun.epoch?.total || 3,
  learningRate: forgeRun.learningRate || "2e-4",
  loadIn4Bit: Boolean(forgeRun.loadIn4Bit),
});

const TrialsWorkbench: React.FC<TrialsWorkbenchProps> = ({
  academyActions,
  repository,
  summary,
  workshop,
  onOpenAcademy,
  onOpenAcademyAction,
  onOpenForgePreset,
  onLoopEvidenceRefresh,
  loopFocus,
}) => {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [evaluationReports, setEvaluationReports] = useState<EvaluationReportSummary[]>([]);
  const [selectedTrialIds, setSelectedTrialIds] = useState<string[]>([]);
  const [exportName, setExportName] = useState(`${workshop.name} Trial Dataset`);
  const [isExporting, setIsExporting] = useState(false);
  const [activeReportActionId, setActiveReportActionId] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<EvaluationReportSummary | null>(null);
  const [reviewSamples, setReviewSamples] = useState<ReviewedWeakSample[]>([]);
  const trialsFocusTarget = useMemo(() => trialsLoopFocusTarget(loopFocus), [loopFocus]);
  const focusedComparisonPrompt = useMemo(
    () =>
      trialsFocusTarget === "comparison" && loopFocus?.targetPrompt
        ? normalizePrompt(loopFocus.targetPrompt)
        : null,
    [loopFocus?.targetPrompt, trialsFocusTarget]
  );
  const trialComparisonRef = useRef<HTMLElement | null>(null);
  const trialExportRef = useRef<HTMLDivElement | null>(null);
  const trialListRef = useRef<HTMLDivElement | null>(null);
  const [reviewExportOpensForge, setReviewExportOpensForge] = useState(false);
  const [isExportingReview, setIsExportingReview] = useState(false);
  const [reviewingTrialId, setReviewingTrialId] = useState<string | null>(null);
  const [activeTrialFilter, setActiveTrialFilter] = useState<TrialFilter>("all");

  useEffect(() => {
    if (!trialsFocusTarget || loopFocus?.section !== "trials") {
      return undefined;
    }

    const target =
      trialsFocusTarget === "comparison"
        ? trialComparisonRef.current
        : trialsFocusTarget === "export"
          ? trialExportRef.current
          : trialListRef.current;
    const timeoutId = window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    return () => window.clearTimeout(timeoutId);
  }, [loopFocus?.requestedAt, loopFocus?.section, trialsFocusTarget]);
  const [exportState, setExportState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setError(null);

    Promise.all([repository.listTrials(workshop.id), repository.listForgeRuns(workshop.id)])
      .then(async ([savedTrials, forgeRuns]) => {
        const completedEvaluationRuns = forgeRuns.filter(
          (run) => run.purpose === "evaluation" && run.status === "completed"
        );
        const reports = await Promise.all(
          completedEvaluationRuns.map(async (forgeRun) => {
            try {
              const workerState = await repository.getForgeWorkerState(forgeRun.id);
              const report = workerState.metrics.evaluationReport;
              return report ? { forgeRun, report } : null;
            } catch {
              return null;
            }
          })
        );
        if (isCurrent) {
          setTrials(savedTrials);
          setEvaluationReports(
            reports.filter((report): report is EvaluationReportSummary => Boolean(report))
          );
          setSelectedTrialIds(
            savedTrials
              .filter((trial) => trial.verdict === "pass")
              .map((trial) => trial.id)
          );
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load Trials.");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [repository, workshop.id]);

  useEffect(() => {
    setExportName(`${workshop.name} Trial Dataset`);
    setExportState(null);
  }, [workshop.name]);

  const verdictCounts = useMemo(
    () =>
      trials.reduce(
        (counts, trial) => ({
          ...counts,
          [trial.verdict]: counts[trial.verdict] + 1,
        }),
        { pass: 0, "needs-work": 0, fail: 0, "needs-review": 0 } as Record<TrialVerdict, number>
      ),
    [trials]
  );

  const selectedTrials = useMemo(
    () => trials.filter((trial) => selectedTrialIds.includes(trial.id)),
    [selectedTrialIds, trials]
  );
  const needsReviewTrials = useMemo(
    () => trials.filter((trial) => trial.verdict === "needs-review"),
    [trials]
  );
  const selectedHasUnreviewedTrials = selectedTrials.some(
    (trial) => trial.verdict === "needs-review"
  );
  const visibleTrials = useMemo(
    () => trials.filter((trial) => trialMatchesFilter(trial, activeTrialFilter)),
    [activeTrialFilter, trials]
  );
  const trialFilterCounts = useMemo(
    () =>
      trialFilterOrder.reduce(
        (counts, filter) => ({
          ...counts,
          [filter]: trials.filter((trial) => trialMatchesFilter(trial, filter)).length,
        }),
        {} as Record<TrialFilter, number>
      ),
    [trials]
  );

  const trialComparisons = useMemo(() => {
    const groups = new Map<string, Trial[]>();
    trials.forEach((trial) => {
      const key = normalizePrompt(trial.prompt);
      groups.set(key, [...(groups.get(key) || []), trial]);
    });

    return Array.from(groups.values())
      .filter((group) => group.length >= 2)
      .map((group) => {
        const variants = [...group].sort(
          (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        );
        const best = [...variants].sort(
          (left, right) =>
            verdictRank[right.verdict] - verdictRank[left.verdict] ||
            Date.parse(right.createdAt) - Date.parse(left.createdAt)
        )[0];
        const sources = Array.from(
          new Set(variants.map((trial) => trial.runtimeProfile?.source || trial.runtimeMode))
        );
        const artifacts = Array.from(new Set(variants.map((trial) => trial.artifactId)));
        const promptChains = variants
          .map(promptChainForTrial)
          .filter((promptChain): promptChain is ConstructPromptChain => Boolean(promptChain));
        const systemPromptVariants = Array.from(
          new Set(
            promptChains.map((promptChain) =>
              promptChain.systemPromptPresent ? promptChain.systemPrompt : "not set"
            )
          )
        );
        const libraryContextVariants = Array.from(
          new Set(promptChains.map((promptChain) => promptChain.includeLibraryContext))
        );
        const tokenCounts = variants.map((trial) => trial.tokenCount);
        return {
          key: normalizePrompt(variants[0].prompt),
          prompt: variants[0].prompt,
          variants,
          latest: variants[0],
          best,
          sources,
          artifacts,
          systemPromptVariants,
          libraryContextVariants,
          minTokens: Math.min(...tokenCounts),
          maxTokens: Math.max(...tokenCounts),
        };
      })
      .sort(
        (left, right) =>
          Date.parse(right.latest.createdAt) - Date.parse(left.latest.createdAt)
      );
  }, [trials]);

  const trialComparisonSummary = useMemo(() => {
    const comparedTrials = trialComparisons.reduce(
      (total, comparison) => total + comparison.variants.length,
      0
    );
    const adapterBacked = trials.filter(
      (trial) => trial.runtimeProfile?.source === "adapter-backed"
    ).length;
    const liveLocal = trials.filter(
      (trial) => (trial.runtimeProfile?.runtimeMode || trial.runtimeMode) === "transformers"
    ).length;
    const baseOnly = trials.filter((trial) => trial.runtimeProfile?.source === "base-only").length;
    const simulated = trials.filter(
      (trial) => trial.runtimeProfile?.source === "simulated" || !trial.runtimeProfile
    ).length;
    const promptChainTrials = trials.filter((trial) => promptChainForTrial(trial)).length;
    const promptVariantGroups = trialComparisons.filter(
      (comparison) =>
        comparison.systemPromptVariants.length > 1 ||
        comparison.libraryContextVariants.length > 1
    ).length;
    return {
      promptGroups: trialComparisons.length,
      comparedTrials,
      liveLocal,
      adapterBacked,
      baseOnly,
      simulated,
      promptChainTrials,
      promptVariantGroups,
    };
  }, [trialComparisons, trials]);

  const focusedTrialComparisons = useMemo(() => {
    if (!focusedComparisonPrompt) {
      return trialComparisons;
    }
    return [...trialComparisons].sort((left, right) => {
      if (left.key === focusedComparisonPrompt && right.key !== focusedComparisonPrompt) {
        return -1;
      }
      if (right.key === focusedComparisonPrompt && left.key !== focusedComparisonPrompt) {
        return 1;
      }
      return Date.parse(right.latest.createdAt) - Date.parse(left.latest.createdAt);
    });
  }, [focusedComparisonPrompt, trialComparisons]);

  const hasFocusedComparison = useMemo(
    () =>
      Boolean(focusedComparisonPrompt) &&
      trialComparisons.some((comparison) => comparison.key === focusedComparisonPrompt),
    [focusedComparisonPrompt, trialComparisons]
  );

  const trialsNextAction = useMemo(() => {
    if (!trialsFocusTarget) {
      return undefined;
    }
    if (trials.length === 0) {
      return "Run a Construct prompt and save a verdict so Trial evidence exists.";
    }
    if (trialsFocusTarget === "comparison") {
      if (focusedComparisonPrompt && !hasFocusedComparison) {
        return "The handoff prompt has not produced two saved Trials yet. Run the comparison recipe again.";
      }
      return trialComparisonSummary.promptGroups === 0
        ? "Run the same prompt across Artifacts or runtime modes to create a comparison group."
        : hasFocusedComparison
          ? "Review the highlighted comparison group and decide which prompt-chain behavior is strongest."
          : "Compare repeated prompts and decide which Artifact response is strongest.";
    }
    if (trialsFocusTarget === "export") {
      return selectedTrialIds.length === 0
        ? "Select Trial rows to promote into a JSONL Material."
        : selectedHasUnreviewedTrials
          ? "Review selected needs-review Trials before exporting them to JSONL."
        : "Export selected Trials so weak or proven examples can feed the Forge loop.";
    }
    return needsReviewTrials.length > 0
      ? "Review auto-captured Construct replies, then export useful verdicts back into Materials."
      : "Review saved verdicts and export useful failures back into Materials for the next Forge.";
  }, [
    needsReviewTrials.length,
    selectedTrialIds.length,
    selectedHasUnreviewedTrials,
    trialComparisonSummary.promptGroups,
    trials.length,
    trialsFocusTarget,
    focusedComparisonPrompt,
    hasFocusedComparison,
  ]);

  const sortedEvaluationReports = useMemo(
    () =>
      [...evaluationReports].sort(
        (left, right) => getReportTime(right.report) - getReportTime(left.report)
      ),
    [evaluationReports]
  );

  const latestReport = sortedEvaluationReports[0];
  const previousReport = sortedEvaluationReports[1];
  const evaluationAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.trialsOpenEvaluation
  );
  const weakSampleAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.trialsReviewWeakSamples
  );
  const runtimeSourceAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.trialsRuntimeSources
  );
  const promptComparisonAcademyAction = findAcademyAction(
    academyActions,
    ACADEMY_ACTION_IDS.trialsComparePrompts
  );

  const reportComparison = useMemo(() => {
    if (!latestReport || !previousReport) {
      return null;
    }

    const previousRubric = new Map(
      previousReport.report.rubric.map((item) => [item.label, item.score])
    );

    return {
      passRateDelta: latestReport.report.passRate - previousReport.report.passRate,
      failDelta: latestReport.report.failCount - previousReport.report.failCount,
      needsWorkDelta:
        latestReport.report.needsWorkCount - previousReport.report.needsWorkCount,
      rowDelta: latestReport.report.rowCount - previousReport.report.rowCount,
      rubricDeltas: latestReport.report.rubric.map((item) => ({
        label: item.label,
        score: item.score,
        delta: item.score - (previousRubric.get(item.label) ?? item.score),
      })),
    };
  }, [latestReport, previousReport]);

  const selectTrialsByVerdict = (verdict: TrialVerdict) => {
    setSelectedTrialIds(trials.filter((trial) => trial.verdict === verdict).map((trial) => trial.id));
  };

  const toggleTrialSelection = (trialId: string) => {
    setSelectedTrialIds((current) =>
      current.includes(trialId)
        ? current.filter((id) => id !== trialId)
        : [...current, trialId]
    );
  };

  const reviewTrial = async (trial: Trial, verdict: ReviewedTrialVerdict) => {
    setReviewingTrialId(trial.id);
    setError(null);
    setExportState(null);
    try {
      const reviewedTrial = await repository.createTrial(workshop.id, {
        artifactId: trial.artifactId,
        constructId: trial.constructId,
        messageId: trial.messageId,
        prompt: trial.prompt,
        response: trial.response,
        verdict,
        runtimeMode: trial.runtimeMode,
        tokenCount: trial.tokenCount,
        generationSettings: trial.generationSettings,
      });
      setTrials((current) =>
        current.map((item) => (item.id === reviewedTrial.id ? reviewedTrial : item))
      );
      setExportState(`Trial ${reviewedTrial.id} marked ${verdictLabels[reviewedTrial.verdict]}.`);
      if (reviewedTrial.verdict === "pass") {
        setSelectedTrialIds((current) =>
          current.includes(reviewedTrial.id) ? current : [...current, reviewedTrial.id]
        );
      }
      onLoopEvidenceRefresh?.();
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not review Trial.");
    } finally {
      setReviewingTrialId(null);
    }
  };

  const exportSelectedTrials = async () => {
    if (selectedTrialIds.length === 0) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setExportState(null);
    try {
      const exportResult = await repository.exportTrials(workshop.id, {
        trialIds: selectedTrialIds,
        name: exportName.trim() || `${workshop.name} Trial Dataset`,
      });
      setExportState(
        `Exported ${exportResult.trialCount.toLocaleString()} Trials to ${exportResult.exportUri}`
      );
      onLoopEvidenceRefresh?.();
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Could not export Trials.");
    } finally {
      setIsExporting(false);
    }
  };

  const openWeakSampleReview = (
    summary: EvaluationReportSummary,
    { openForge = false }: { openForge?: boolean } = {}
  ) => {
    if (weakSampleCount(summary.report) === 0) {
      setError("This Trial Report has no weak samples to export.");
      return;
    }

    setReviewTarget(summary);
    setReviewSamples(createReviewedSamples(summary.report));
    setReviewExportOpensForge(openForge);
    setError(null);
    setExportState(null);
  };

  const updateReviewedSample = <K extends keyof ReviewedWeakSample>(
    sampleId: string,
    key: K,
    value: ReviewedWeakSample[K]
  ) => {
    setReviewSamples((current) =>
      current.map((sample) => (sample.id === sampleId ? { ...sample, [key]: value } : sample))
    );
  };

  const closeWeakSampleReview = () => {
    if (isExportingReview) {
      return;
    }
    setReviewTarget(null);
    setReviewSamples([]);
    setReviewExportOpensForge(false);
  };

  const exportReviewedWeakSamples = async ({
    openForge,
  }: { openForge?: boolean } = {}) => {
    if (!reviewTarget) {
      return;
    }
    const includedSamples = reviewSamples.filter((sample) => sample.include);
    if (includedSamples.length === 0) {
      setError("Select at least one weak sample to export.");
      return;
    }

    setActiveReportActionId(reviewTarget.report.forgeRunId);
    setIsExportingReview(true);
    setError(null);
    setExportState(null);
    try {
      const exportResult = await repository.exportEvaluationWeakSamples(
        reviewTarget.report.forgeRunId,
        {
          name: `${workshop.name} Reviewed Weak Samples`,
          samples: includedSamples.map((sample) => ({
            instruction: sample.instruction,
            expected: sample.expected,
            observed: sample.observed,
            verdict: sample.verdict,
            note: sample.note,
          })),
        }
      );
      setExportState(
        `Exported ${exportResult.sampleCount.toLocaleString()} reviewed weak samples to ${exportResult.exportUri}`
      );
      setReviewTarget(null);
      setReviewSamples([]);
      setReviewExportOpensForge(false);
      onLoopEvidenceRefresh?.();
      if (openForge ?? reviewExportOpensForge) {
        onOpenForgePreset(
          createForgePreset(reviewTarget.forgeRun, exportResult.material.id, "training")
        );
      }
    } catch (exportError: unknown) {
      setError(
        exportError instanceof Error ? exportError.message : "Could not export weak samples."
      );
    } finally {
      setActiveReportActionId(null);
      setIsExportingReview(false);
    }
  };

  const runEvaluationAgain = (summary: EvaluationReportSummary) => {
    onOpenForgePreset(
      createForgePreset(summary.forgeRun, summary.report.materialId, "evaluation")
    );
  };

  return (
    <section className="workbench-page trials-workbench" aria-label="Trials">
      <div className="workbench-hero panel-glass">
        <p className="section-eyebrow">{summary.eyebrow}</p>
        <h1>{summary.title}</h1>
        <p>{summary.body}</p>
      </div>

      <LoopFocusCallout focus={loopFocus} nextAction={trialsNextAction} section="trials" />

      <div className="workbench-grid">
        <article className="stat-card panel-glass">
          <span>Saved Trials</span>
          <strong>{trials.length}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Trial Reports</span>
          <strong>{evaluationReports.length}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Pass</span>
          <strong>{verdictCounts.pass}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Needs work</span>
          <strong>{verdictCounts["needs-work"]}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Needs review</span>
          <strong>{verdictCounts["needs-review"]}</strong>
        </article>
        <article className="stat-card panel-glass">
          <span>Fail</span>
          <strong>{verdictCounts.fail}</strong>
        </article>
      </div>

      {error && <p className="save-state error-state">{error}</p>}
      {exportState && <p className="save-state success-state">{exportState}</p>}

      <section
        className={`trial-comparison-panel panel-glass ${trialsFocusTarget === "comparison" ? "is-loop-focused" : ""}`}
        aria-label="Saved Trial comparisons"
        ref={trialComparisonRef}
      >
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Saved Trial comparison</p>
            <h2>Prompt Variants</h2>
          </div>
          <div className="trial-comparison-actions">
            <span className="status-badge">
              {trialComparisonSummary.promptGroups} comparable prompts
            </span>
            <AcademyActionTooltip
              action={promptComparisonAcademyAction}
              label="Why compare prompts?"
            />
          </div>
        </div>
        <p className="trial-guidance">
          Compare repeated prompts across Artifacts, runtime sources, and prompt-chain settings
          before promoting an Artifact. The steadier the system and user prompts, the clearer the
          signal.
        </p>
        <div className="trial-comparison-summary">
          <div>
            <span>Compared Trials</span>
            <strong>{trialComparisonSummary.comparedTrials}</strong>
          </div>
          <div>
            <span>Live local</span>
            <strong>{trialComparisonSummary.liveLocal}</strong>
          </div>
          <div>
            <span>Adapter-backed</span>
            <strong>{trialComparisonSummary.adapterBacked}</strong>
          </div>
          <div>
            <span>Base-only</span>
            <strong>{trialComparisonSummary.baseOnly}</strong>
          </div>
          <div>
            <span>Simulated</span>
            <strong>{trialComparisonSummary.simulated}</strong>
          </div>
          <div>
            <span>Prompt chains</span>
            <strong>{trialComparisonSummary.promptChainTrials}</strong>
          </div>
          <div>
            <span>Prompt variants</span>
            <strong>{trialComparisonSummary.promptVariantGroups}</strong>
          </div>
        </div>
        {trialComparisons.length === 0 ? (
          <p className="empty-state">
            Save two or more Trials with the same user prompt to compare Artifacts, runtime sources,
            and system prompt changes.
          </p>
        ) : (
          <div className="trial-comparison-list">
            {focusedTrialComparisons.slice(0, 6).map((comparison) => {
              const isFocusedComparison = comparison.key === focusedComparisonPrompt;
              return (
                <article
                  className={`trial-comparison-card ${
                    isFocusedComparison ? "is-target-comparison" : ""
                  }`}
                  key={comparison.key}
                >
                  <div className="trial-comparison-header">
                    <div>
                      <p className="panel-kicker">
                        {isFocusedComparison
                          ? "Current handoff"
                          : `${comparison.variants.length} variants`}
                      </p>
                      <h3>{comparison.prompt}</h3>
                    </div>
                    <span className={`trial-verdict verdict-${comparison.best.verdict}`}>
                      Best {verdictLabels[comparison.best.verdict]}
                    </span>
                  </div>
                  <div className="trial-comparison-facts">
                    <span>{comparison.artifacts.length} Artifacts</span>
                    <span>{comparison.sources.map(runtimeSourceLabel).join(" / ")}</span>
                    <span>
                      {comparison.systemPromptVariants.length === 0
                        ? "prompt chain not recorded"
                        : `${comparison.systemPromptVariants.length} system prompt${
                            comparison.systemPromptVariants.length === 1 ? "" : "s"
                          }`}
                    </span>
                    <span>
                      {comparison.libraryContextVariants.length === 0
                        ? "Library not recorded"
                        : comparison.libraryContextVariants.length === 1
                          ? `Library ${comparison.libraryContextVariants[0] ? "included" : "off"}`
                          : "Library varied"}
                    </span>
                    <span>
                      {comparison.minTokens === comparison.maxTokens
                        ? `${comparison.minTokens} tokens`
                        : `${comparison.minTokens}-${comparison.maxTokens} tokens`}
                    </span>
                  </div>
                  <div className="trial-variant-list">
                    {comparison.variants.slice(0, 4).map((trial) => {
                      const promptChain = promptChainForTrial(trial);
                      return (
                        <div className="trial-variant-row" key={trial.id}>
                          <span className={`trial-verdict verdict-${trial.verdict}`}>
                            {verdictLabels[trial.verdict]}
                          </span>
                          <strong>
                            {runtimeModeLabel(trial.runtimeProfile?.runtimeMode || trial.runtimeMode)}
                          </strong>
                          <span>{runtimeSourceLabel(trial.runtimeProfile?.source)}</span>
                          <span>{shortValue(trial.artifactId, 22)}</span>
                          <span>
                            {trial.runtimeProfile?.adapterLoaded
                              ? shortValue(trial.runtimeProfile.adapterPath || "adapter", 32)
                              : "no adapter"}
                          </span>
                          <span>{promptChainSystemLabel(promptChain)}</span>
                          <span>Library {promptChainLibraryLabel(promptChain)}</span>
                          <span>{trial.tokenCount} tokens</span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="evaluation-report-panel panel-glass" aria-label="Forge Trial Reports">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Evaluation history</p>
            <h2>Forge Trial Reports</h2>
          </div>
          <span className="status-badge">{evaluationReports.length} reports</span>
        </div>
        {evaluationReports.length === 0 ? (
          <p className="empty-state">
            Complete an evaluation Forge to see pass rates, rubric scores, and sample checks here.
          </p>
        ) : (
          <>
            {latestReport && (
              <article className="evaluation-decision-card">
                <div>
                  <p className="panel-kicker">Promotion guidance</p>
                  <h3>{readinessLabels[getReadinessState(latestReport.report)]}</h3>
                  <p>{getReadinessReason(latestReport.report)}</p>
                </div>
                <div className="evaluation-decision-metrics">
                  <span>{latestReport.report.passRate}% pass</span>
                  <span>{latestReport.report.failCount} failed</span>
                  <span>{latestReport.report.rowCount.toLocaleString()} rows</span>
                </div>
                <div className="evaluation-action-row" aria-label="Suggested evaluation actions">
                  <button
                    disabled={
                      activeReportActionId === latestReport.report.forgeRunId ||
                      weakSampleCount(latestReport.report) === 0
                    }
                    onClick={() => openWeakSampleReview(latestReport)}
                    type="button"
                  >
                    Review weak samples
                  </button>
                  <button
                    disabled={
                      activeReportActionId === latestReport.report.forgeRunId ||
                      weakSampleCount(latestReport.report) === 0
                    }
                    onClick={() => openWeakSampleReview(latestReport, { openForge: true })}
                    type="button"
                  >
                    Train again
                  </button>
                  <button onClick={() => runEvaluationAgain(latestReport)} type="button">
                    Run evaluation again
                  </button>
                  <LearningAction
                    action={evaluationAcademyAction}
                    fallbackLabel="Open Academy: Evaluation"
                    onOpen={() =>
                      onOpenAcademyAction(ACADEMY_ACTION_IDS.trialsOpenEvaluation)
                    }
                  />
                </div>
              </article>
            )}

            {latestReport && previousReport && reportComparison && (
              <article className="evaluation-comparison-card">
                <div>
                  <p className="panel-kicker">Latest vs previous</p>
                  <h3>{latestReport.forgeRun.label}</h3>
                </div>
                <div className="evaluation-delta-grid">
                  <span className={reportComparison.passRateDelta >= 0 ? "is-positive" : "is-negative"}>
                    Pass rate {formatDelta(reportComparison.passRateDelta)}
                  </span>
                  <span className={reportComparison.failDelta <= 0 ? "is-positive" : "is-negative"}>
                    Failed {formatDelta(reportComparison.failDelta, "")}
                  </span>
                  <span className={reportComparison.needsWorkDelta <= 0 ? "is-positive" : "is-negative"}>
                    Needs work {formatDelta(reportComparison.needsWorkDelta, "")}
                  </span>
                  <span className={reportComparison.rowDelta >= 0 ? "is-positive" : "is-negative"}>
                    Rows {formatDelta(reportComparison.rowDelta, "")}
                  </span>
                </div>
                <div className="evaluation-rubric-strip">
                  {reportComparison.rubricDeltas.map((item) => (
                    <span key={item.label}>
                      {item.label}: {item.score}% ({formatDelta(item.delta)})
                    </span>
                  ))}
                </div>
              </article>
            )}

            <div className="evaluation-report-list">
              {sortedEvaluationReports.map((summary) => (
                <article className="evaluation-report-card" key={summary.report.forgeRunId}>
                  <div className="evaluation-report-card-header">
                    <div>
                      <p className="panel-kicker">{summary.forgeRun.method} evaluation</p>
                      <h3>{summary.forgeRun.label}</h3>
                      <span>
                        {summary.report.rowCount.toLocaleString()} rows /{" "}
                        {summary.report.materialId}
                      </span>
                    </div>
                    <strong>{summary.report.passRate}%</strong>
                  </div>
                  <span
                    className={`readiness-badge readiness-${getReadinessState(summary.report)}`}
                  >
                    {readinessLabels[getReadinessState(summary.report)]}
                  </span>
                  <div
                    className="forge-progress-track"
                    aria-label={`${summary.forgeRun.label} pass rate`}
                  >
                    <span style={{ width: `${summary.report.passRate}%` }} />
                  </div>
                  <div className="trial-report-counts">
                    <span className="verdict-pass">{summary.report.passCount} pass</span>
                    <span className="verdict-needs-work">
                      {summary.report.needsWorkCount} needs work
                    </span>
                    <span className="verdict-fail">{summary.report.failCount} fail</span>
                  </div>
                  <div className="evaluation-rubric-strip">
                    {summary.report.rubric.map((item) => (
                      <span key={item.label}>
                        {item.label}: {item.score}%
                      </span>
                    ))}
                  </div>
                  <p>{summary.report.recommendations[0]}</p>
                  <div className="evaluation-report-actions">
                    <button
                      className="button-secondary button-compact"
                      disabled={
                        activeReportActionId === summary.report.forgeRunId ||
                        weakSampleCount(summary.report) === 0
                      }
                      onClick={() => openWeakSampleReview(summary)}
                      type="button"
                    >
                      Review weak samples
                    </button>
                    <button
                      className="button-primary button-compact"
                      disabled={
                        activeReportActionId === summary.report.forgeRunId ||
                        weakSampleCount(summary.report) === 0
                      }
                      onClick={() => openWeakSampleReview(summary, { openForge: true })}
                      type="button"
                    >
                      Export and Train
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <div
        className={`trial-export-panel panel-glass ${trialsFocusTarget === "export" ? "is-loop-focused" : ""}`}
        ref={trialExportRef}
      >
        <div>
          <p className="panel-kicker">Trial export</p>
          <h2>Promote reviewed replies into Material</h2>
          <p>
            Export selected Trials as JSONL rows so the Forge can reuse vetted
            prompt-response examples as training or evaluation Material.
          </p>
        </div>
        <div className="trial-export-controls">
          <button className="button-secondary button-compact" onClick={() => selectTrialsByVerdict("pass")} type="button">
            Select pass
          </button>
          <button className="button-secondary button-compact" onClick={() => setSelectedTrialIds(visibleTrials.map((trial) => trial.id))} type="button">
            Select visible
          </button>
          <button className="button-secondary button-compact" onClick={() => setSelectedTrialIds([])} type="button">
            Clear
          </button>
        </div>
        <label className="field-label" htmlFor="trial-export-name">Material name</label>
        <input
          className="text-input"
          id="trial-export-name"
          onChange={(event) => setExportName(event.target.value)}
          value={exportName}
        />
        <button
          className="button-primary"
          disabled={selectedTrialIds.length === 0 || selectedHasUnreviewedTrials || isExporting}
          onClick={() => void exportSelectedTrials()}
          type="button"
        >
          <i className="fas fa-file-export" aria-hidden="true" />
          {isExporting ? "Exporting" : `Export ${selectedTrials.length} JSONL`}
        </button>
      </div>
      {selectedHasUnreviewedTrials && (
        <p className="save-state warning-state">
          Review selected needs-review Trials before exporting them as JSONL.
        </p>
      )}

      <div
        className={`trial-list ${trialsFocusTarget === "list" ? "is-loop-focused" : ""}`}
        ref={trialListRef}
      >
        {trials.length > 0 && (
          <LearningCard
            title="Read the runtime evidence"
            body="A Trial is strongest when it records the loaded base model, device, and whether the Artifact adapter was applied. Simulated Trials are useful for demos, but should not be treated as proof of model quality."
            academyAction={runtimeSourceAcademyAction}
            onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.trialsRuntimeSources)}
          />
        )}
        {trials.length > 0 && (
          <LearningCard
            title="Read the prompt chain"
            body="A repeated user prompt is only a clean comparison when the system prompt, Library context, and generation settings are visible too. Prompt-chain evidence shows which instruction changed."
            academyAction={promptComparisonAcademyAction}
            onAction={() => onOpenAcademyAction(ACADEMY_ACTION_IDS.trialsComparePrompts)}
          />
        )}
        {trials.length > 0 && (
          <div className="trial-filter-bar" role="group" aria-label="Filter Trials">
            {trialFilterOrder.map((filter) => (
              <button
                aria-pressed={activeTrialFilter === filter}
                className={`trial-filter-button ${activeTrialFilter === filter ? "is-active" : ""}`}
                key={filter}
                onClick={() => setActiveTrialFilter(filter)}
                type="button"
              >
                <span>{trialFilterLabels[filter]}</span>
                <strong>{trialFilterCounts[filter] ?? 0}</strong>
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
          <article className="trial-card panel-glass">
            <p className="empty-state">Loading saved Trials...</p>
          </article>
        ) : trials.length === 0 ? (
          <article className="trial-card panel-glass">
            <p className="panel-kicker">No Trials yet</p>
            <h2>Run a Construct prompt and mark the reply.</h2>
            <p>
              The prompt, generated response, runtime settings, and verdict will appear here as
              an evaluation record for the active Artifact.
            </p>
          </article>
        ) : visibleTrials.length === 0 ? (
          <article className="trial-card panel-glass">
            <p className="panel-kicker">No matching Trials</p>
            <h2>No {trialFilterLabels[activeTrialFilter]} evidence yet.</h2>
            <p>
              Change the filter or run another Construct prompt to capture this kind of Trial.
            </p>
          </article>
        ) : (
          visibleTrials.map((trial) => {
            const evidence = trialRuntimeEvidence(trial);
            const promptChain = promptChainForTrial(trial);
            return (
              <article className="trial-card panel-glass" key={trial.id}>
                <div className="trial-card-header">
                  <label className="trial-select" htmlFor={`trial-${trial.id}`}>
                    <input
                      checked={selectedTrialIds.includes(trial.id)}
                      id={`trial-${trial.id}`}
                      onChange={() => toggleTrialSelection(trial.id)}
                      type="checkbox"
                    />
                    <span className="sr-only">Select Trial {trial.id}</span>
                  </label>
                  <div>
                    <p className="panel-kicker">{evidence.kicker}</p>
                    <h2>{trial.prompt}</h2>
                  </div>
                  <span className={`trial-verdict verdict-${trial.verdict}`}>
                    {verdictLabels[trial.verdict]}
                  </span>
                </div>
                <p className="trial-response">{trial.response}</p>
                <div className={`trial-runtime-evidence evidence-${evidence.tone}`}>
                  <i className={`fas ${evidence.icon}`} aria-hidden="true" />
                  <div>
                    <strong>{evidence.title}</strong>
                    <span>{evidence.detail}</span>
                  </div>
                </div>
                <div className="trial-meta">
                  <span>Artifact {trial.artifactId}</span>
                  <span>{trial.tokenCount} tokens</span>
                  <span>{new Date(trial.createdAt).toLocaleString()}</span>
                </div>
                <div className="trial-prompt-chain">
                  <div>
                    <span>
                      Prompt chain
                      <AcademyActionTooltip
                        action={promptComparisonAcademyAction}
                        label="?"
                      />
                    </span>
                    <strong>{promptChainOrderLabel(promptChain)}</strong>
                  </div>
                  <div>
                    <span>System prompt</span>
                    <strong>{promptChainSystemLabel(promptChain)}</strong>
                  </div>
                  <div>
                    <span>User prompt</span>
                    <strong>
                      {shortValue(promptChain?.userPromptPreview || trial.prompt, 72)}
                    </strong>
                  </div>
                  <div>
                    <span>Library context</span>
                    <strong>{promptChainLibraryLabel(promptChain)}</strong>
                  </div>
                </div>
                {trial.runtimeProfile && (
                  <div className={`trial-runtime-profile source-${trial.runtimeProfile.source}`}>
                    <div>
                      <span>
                        Runtime source
                        <AcademyActionTooltip
                          action={runtimeSourceAcademyAction}
                          label="?"
                        />
                      </span>
                      <strong>{runtimeSourceLabel(trial.runtimeProfile.source)}</strong>
                    </div>
                    <div>
                      <span>Runtime</span>
                      <strong>{runtimeModeLabel(trial.runtimeProfile.runtimeMode)}</strong>
                    </div>
                    <div>
                      <span>Model</span>
                      <strong>
                        {trial.runtimeProfile.modelId || trial.runtimeProfile.baseModel || "unknown"}
                      </strong>
                    </div>
                    <div>
                      <span>Base model</span>
                      <strong>{trial.runtimeProfile.baseModel || "unknown"}</strong>
                    </div>
                    <div>
                      <span>Adapter</span>
                      <strong>
                        {trial.runtimeProfile.adapterLoaded
                          ? trial.runtimeProfile.adapterPath || trial.runtimeProfile.artifactId
                          : "not applied"}
                      </strong>
                    </div>
                    <div>
                      <span>Device</span>
                      <strong>{trial.runtimeProfile.device || "n/a"}</strong>
                    </div>
                  </div>
                )}
                {trial.verdict === "needs-review" && (
                  <div className="trial-review-queue" aria-label={`Review Trial ${trial.id}`}>
                    <div>
                      <strong>Review captured reply</strong>
                      <span>Choose a verdict before this Trial can become JSONL training Material.</span>
                    </div>
                    <div className="trial-review-actions">
                      {reviewedTrialVerdicts.map((verdict) => (
                        <button
                          className="button-secondary button-compact"
                          disabled={reviewingTrialId === trial.id}
                          key={verdict}
                          onClick={() => void reviewTrial(trial, verdict)}
                          type="button"
                        >
                          {reviewingTrialId === trial.id ? "Saving" : verdictLabels[verdict]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {reviewTarget && (
        <div className="weak-sample-backdrop" role="presentation" onClick={closeWeakSampleReview}>
          <aside
            className="weak-sample-drawer panel-glass"
            role="dialog"
            aria-modal="true"
            aria-label="Review weak samples"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="weak-sample-header">
              <div>
                <p className="panel-kicker">Weak sample review</p>
                <h2>{reviewTarget.forgeRun.label}</h2>
                <span>
                  {reviewSamples.filter((sample) => sample.include).length} selected /{" "}
                  {reviewSamples.length} weak samples
                </span>
              </div>
              <div className="weak-sample-header-actions">
                <LearningAction
                  action={weakSampleAcademyAction}
                  className="button-secondary button-compact"
                  fallbackLabel="Learn"
                  icon="fa-graduation-cap"
                  onOpen={() =>
                    onOpenAcademyAction(ACADEMY_ACTION_IDS.trialsReviewWeakSamples)
                  }
                />
                <button
                  className="icon-button"
                  type="button"
                  onClick={closeWeakSampleReview}
                  aria-label="Close weak sample review"
                  title="Close"
                >
                  <i className="fas fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="weak-sample-body">
              {reviewSamples.map((sample, index) => (
                <article className="weak-sample-card" key={sample.id}>
                  <div className="weak-sample-card-header">
                    <label className="toggle-row" htmlFor={`weak-sample-${sample.id}`}>
                      <input
                        id={`weak-sample-${sample.id}`}
                        type="checkbox"
                        checked={sample.include}
                        onChange={(event) =>
                          updateReviewedSample(sample.id, "include", event.target.checked)
                        }
                      />
                      <span>Include sample {index + 1}</span>
                    </label>
                    <span className={`trial-verdict verdict-${sample.verdict}`}>
                      {verdictLabels[sample.verdict]}
                    </span>
                  </div>
                  <div className="weak-sample-grid">
                    <div>
                      <span>Prompt</span>
                      <p>{sample.instruction}</p>
                    </div>
                    <div>
                      <span>Observed</span>
                      <p>{sample.observed || "No observed response recorded."}</p>
                    </div>
                  </div>
                  <label className="field-label" htmlFor={`weak-output-${sample.id}`}>
                    Corrected output
                  </label>
                  <textarea
                    id={`weak-output-${sample.id}`}
                    value={sample.expected}
                    onChange={(event) =>
                      updateReviewedSample(sample.id, "expected", event.target.value)
                    }
                    rows={5}
                  />
                  <label className="field-label" htmlFor={`weak-note-${sample.id}`}>
                    Review note
                  </label>
                  <input
                    className="text-input"
                    id={`weak-note-${sample.id}`}
                    value={sample.note}
                    onChange={(event) =>
                      updateReviewedSample(sample.id, "note", event.target.value)
                    }
                  />
                </article>
              ))}
            </div>

            <div className="weak-sample-footer">
              <button
                className="button-secondary"
                type="button"
                onClick={closeWeakSampleReview}
                disabled={isExportingReview}
              >
                Cancel
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => void exportReviewedWeakSamples()}
                disabled={isExportingReview}
              >
                <i className="fas fa-file-export" aria-hidden="true" />
                {isExportingReview ? "Exporting" : "Export Material"}
              </button>
              <button
                className="button-primary"
                type="button"
                onClick={() => void exportReviewedWeakSamples({ openForge: true })}
                disabled={isExportingReview}
              >
                <i className="fas fa-fire-flame-curved" aria-hidden="true" />
                {isExportingReview ? "Exporting" : "Export and Train"}
              </button>
            </div>
          </aside>
        </div>
      )}

      <LearningCard
        title={summary.concept.title}
        body={summary.concept.body}
        academyAction={evaluationAcademyAction}
        onAction={() => onOpenAcademy()}
      />
      <div className="dashboard-note">
        <AcademyActionTooltip action={evaluationAcademyAction} label="Why evaluate?" />
      </div>
    </section>
  );
};

export default TrialsWorkbench;
