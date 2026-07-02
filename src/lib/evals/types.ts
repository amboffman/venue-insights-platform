import type { ToolCallRecord } from "../ai/shared";

// The eval contract. Cases are data, scorers are pure functions over a
// case + the agent's transcript — so the whole scoring layer unit-tests
// without a model in the loop.

export interface ExpectedToolCall {
  name: string;
  /** subset match: only the listed keys are compared, deep-equal per key */
  args?: Record<string, unknown>;
}

export interface ExpectedFact {
  label: string;
  /** cents for money, raw value otherwise */
  value: number;
  kind: "cents" | "count" | "rating";
}

export interface EvalCase {
  id: string;
  question: string;
  expectedTools: ExpectedToolCall[];
  /** key facts the answer should contain — consumed by a stretch scorer
   * once groundedness lands (they share number-matching) */
  expectedFacts: ExpectedFact[];
}

export interface ScorerResult {
  /** 0..1, or null when the scorer could not run */
  score: number | null;
  /** human-readable misses/notes — the "where it fails" in the report */
  details: string[];
}

export interface AgentTranscript {
  answer: string;
  toolCalls: ToolCallRecord[];
}

export interface Scorer {
  name: string;
  score(evalCase: EvalCase, transcript: AgentTranscript): ScorerResult;
}

export interface CaseResult {
  caseId: string;
  question: string;
  answer: string;
  toolCalls: ToolCallRecord[];
  scores: Record<string, ScorerResult>;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  iterations: number;
  stopReason: string | null;
}

export interface EvalReport {
  runAt: string;
  model: string;
  caseCount: number;
  cases: CaseResult[];
  summary: {
    /** mean per scorer across cases where the scorer ran */
    meanScores: Record<string, number>;
    totalUsage: { inputTokens: number; outputTokens: number };
    totalDurationMs: number;
  };
}
