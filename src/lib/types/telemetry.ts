// Crosses the lib/telemetry → lib/db boundary: the span exporter produces
// these, the db layer persists them, the observability page queries them
// back. Mirrors the OTel span model, not any driver's row shape.

export type SpanStatus = "unset" | "ok" | "error";

export interface SpanRecord {
  /** 32-hex OTel trace id — one turn/question = one trace */
  traceId: string;
  /** 16-hex OTel span id */
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  status: SpanStatus;
  statusMessage: string | null;
  attributes: Record<string, unknown>;
}

/** One root span (= one question/turn), aggregated for the dashboard. */
export interface TurnSummary {
  traceId: string;
  /** which loop produced it — "ask" (terminal/evals) or "chat" (web UI) */
  kind: "ask" | "chat" | "other";
  startedAt: Date;
  durationMs: number;
  status: SpanStatus;
  inputTokens: number;
  outputTokens: number;
  /** null when the model had no pricing entry — shown as "—", never guessed */
  costMicroUsd: number | null;
  toolCalls: number;
  evalRunId: string | null;
  evalCaseId: string | null;
}

/** One `pnpm eval` invocation, aggregated across its case turns. */
export interface EvalRunSummary {
  runId: string;
  startedAt: Date;
  caseCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostMicroUsd: number;
  /** summed model time across cases (they run concurrently, so this is
   * compute time, not wall clock — same semantics as the eval report) */
  totalDurationMs: number;
}
