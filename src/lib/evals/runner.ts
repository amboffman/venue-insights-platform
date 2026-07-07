import { askQuestion, type AskDeps } from "../ai/tool-loop";
import { DEFAULT_MODEL } from "../ai/shared";
import { ATTR_MLIP_EVAL_CASE_ID, ATTR_MLIP_EVAL_RUN_ID } from "../telemetry/attributes";
import { argumentCorrectnessScorer } from "./scorers/argument-correctness";
import { factsScorer } from "./scorers/facts";
import { groundednessScorer } from "./scorers/groundedness";
import { toolSelectionScorer } from "./scorers/tool-selection";
import type {
  AgentTranscript,
  CaseResult,
  EvalCase,
  EvalReport,
  Scorer,
  ScorerResult,
} from "./types";

export const SCORERS: Scorer[] = [
  toolSelectionScorer,
  argumentCorrectnessScorer,
  groundednessScorer,
  factsScorer,
];

/** A scorer that throws (e.g. the not-yet-implemented author scorer) must
 * not sink the run — it reports score null and the error text. */
function applyScorer(
  scorer: Scorer,
  evalCase: EvalCase,
  transcript: AgentTranscript,
): ScorerResult {
  try {
    return scorer.score(evalCase, transcript);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { score: null, details: [`scorer error: ${message}`] };
  }
}

export async function runCase(
  deps: AskDeps,
  evalCase: EvalCase,
  runId?: string,
): Promise<CaseResult> {
  const started = performance.now();
  // Correlation via span attributes, not context plumbing (ADR-0006): the
  // observability page groups spans per eval run / case with a WHERE clause.
  const result = await askQuestion(deps, evalCase.question, {
    telemetryAttributes: {
      [ATTR_MLIP_EVAL_CASE_ID]: evalCase.id,
      ...(runId === undefined ? {} : { [ATTR_MLIP_EVAL_RUN_ID]: runId }),
    },
  });
  const durationMs = Math.round(performance.now() - started);

  const transcript = { answer: result.answer, toolCalls: result.toolCalls };
  const scores: Record<string, ScorerResult> = {};
  for (const scorer of SCORERS) {
    scores[scorer.name] = applyScorer(scorer, evalCase, transcript);
  }

  return {
    caseId: evalCase.id,
    question: evalCase.question,
    answer: result.answer,
    toolCalls: result.toolCalls,
    scores,
    usage: result.usage,
    durationMs,
    iterations: result.iterations,
    stopReason: result.stopReason,
  };
}

/** A vitest test timeout fails a case WITHOUT rejecting runCase's promise,
 * so the eval file's catch never runs and no row lands in `results` — the
 * report's denominator silently shrinks. Diffing the golden set against
 * what actually reported lets afterAll synthesize an error row (same shape
 * as a pipeline failure: empty scores, error text) for every missing case
 * before the report is built. */
export function synthesizeMissingResults(cases: EvalCase[], results: CaseResult[]): CaseResult[] {
  const reported = new Set(results.map((r) => r.caseId));
  return cases
    .filter((c) => !reported.has(c.id))
    .map((c) => ({
      caseId: c.id,
      question: c.question,
      answer: "",
      toolCalls: [],
      scores: {},
      usage: { inputTokens: 0, outputTokens: 0 },
      durationMs: 0,
      iterations: 0,
      stopReason: null,
      error: "case never completed (timeout?)",
    }));
}

export function buildReport(unsorted: CaseResult[]): EvalReport {
  // Concurrent cases complete in nondeterministic order — sort by id so
  // run-over-run report diffs stay meaningful.
  const cases = [...unsorted].sort((a, b) => a.caseId.localeCompare(b.caseId));
  const meanScores: Record<string, number> = {};
  for (const scorer of SCORERS) {
    const ran = cases
      .map((c) => c.scores[scorer.name]?.score)
      .filter((s): s is number => s !== null && s !== undefined);
    if (ran.length > 0) {
      meanScores[scorer.name] =
        Math.round((ran.reduce((a, b) => a + b, 0) / ran.length) * 1000) / 1000;
    }
  }

  return {
    runAt: new Date().toISOString(),
    model: DEFAULT_MODEL,
    caseCount: cases.length,
    cases,
    summary: {
      meanScores,
      totalUsage: cases.reduce(
        (acc, c) => ({
          inputTokens: acc.inputTokens + c.usage.inputTokens,
          outputTokens: acc.outputTokens + c.usage.outputTokens,
        }),
        { inputTokens: 0, outputTokens: 0 },
      ),
      totalDurationMs: cases.reduce((acc, c) => acc + c.durationMs, 0),
    },
  };
}
