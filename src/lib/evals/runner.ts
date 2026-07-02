import { askQuestion, type AskDeps } from "../ai/tool-loop";
import { DEFAULT_MODEL } from "../ai/shared";
import { argumentCorrectnessScorer } from "./scorers/argument-correctness";
import { groundednessScorer } from "./scorers/groundedness";
import { toolSelectionScorer } from "./scorers/tool-selection";
import type { CaseResult, EvalCase, EvalReport, Scorer, ScorerResult } from "./types";

export const SCORERS: Scorer[] = [
  toolSelectionScorer,
  argumentCorrectnessScorer,
  groundednessScorer,
];

/** A scorer that throws (e.g. the not-yet-implemented author scorer) must
 * not sink the run — it reports score null and the error text. */
function applyScorer(
  scorer: Scorer,
  evalCase: EvalCase,
  transcript: { answer: string; toolCalls: CaseResult["toolCalls"] },
): ScorerResult {
  try {
    return scorer.score(evalCase, transcript);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { score: null, details: [`scorer error: ${message}`] };
  }
}

export async function runCase(deps: AskDeps, evalCase: EvalCase): Promise<CaseResult> {
  const started = performance.now();
  const result = await askQuestion(deps, evalCase.question);
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

export function buildReport(cases: CaseResult[]): EvalReport {
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
