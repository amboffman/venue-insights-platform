import { and, count, desc, isNull, sql } from "drizzle-orm";

import {
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_MLIP_COST_MICROUSD,
  ATTR_MLIP_EVAL_CASE_ID,
  ATTR_MLIP_EVAL_RUN_ID,
} from "../telemetry/attributes";
import type { EvalRunSummary, SpanRecord, TurnSummary } from "../types/telemetry";
import type { Database } from "./client";
import { spans } from "./schema";

/** Persist a batch of finished spans (the exporter path). Idempotent on
 * span id: a retried export must not fail the whole batch on rows that
 * already landed. */
export async function insertSpans(db: Database, records: SpanRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(spans)
    .values(
      records.map((record) => ({
        spanId: record.spanId,
        traceId: record.traceId,
        parentSpanId: record.parentSpanId,
        name: record.name,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        durationMs: record.durationMs,
        status: record.status,
        statusMessage: record.statusMessage,
        attributes: record.attributes,
      })),
    )
    .onConflictDoNothing({ target: spans.spanId });
}

// ── dashboard aggregates ────────────────────────────────────────────────
// Attributes live in jsonb (ADR-0006: one generic table, keys extracted at
// query time). ->> returns text; ::numeric + mapWith(Number) mirrors the
// bigint-as-string discipline in queries.ts.

// Keys are inlined as SQL literals, NOT bind parameters: Postgres can't
// prove `attributes->>$1` (select) and `attributes->>$6` (group by) are the
// same expression, so parameterized keys fail GROUP BY queries. Safe here
// because every key is a compile-time constant from telemetry/attributes —
// never user input (single quotes escaped anyway, defensively).
const attrKey = (key: string) => sql.raw(`'${key.replace(/'/g, "''")}'`);

const attrText = (key: string) => sql<string | null>`${spans.attributes}->>${attrKey(key)}`;

const attrNumberOrZero = (key: string) =>
  sql<number>`coalesce((${spans.attributes}->>${attrKey(key)})::numeric, 0)`.mapWith(Number);

/** Cost is genuinely nullable (unknown model → no estimate), so null must
 * survive the trip instead of being coalesced into a fake $0. */
const attrNumberOrNull = (key: string) =>
  sql<number | null>`(${spans.attributes}->>${attrKey(key)})::numeric`.mapWith((value) =>
    value === null ? null : Number(value),
  );

const attrSumOrZero = (key: string) =>
  sql<number>`coalesce(sum((${spans.attributes}->>${attrKey(key)})::numeric), 0)`.mapWith(Number);

function kindOf(name: string): TurnSummary["kind"] {
  if (name === "mlip.ask") return "ask";
  if (name === "mlip.chat_turn") return "chat";
  return "other";
}

/** Newest-first root spans (one per turn/question) with their per-trace
 * tool-call counts. Two simple queries merged in JS beat one clever lateral
 * join at dashboard scale — and each is independently testable. */
export async function listTurnSummaries(db: Database, limit = 50): Promise<TurnSummary[]> {
  const roots = await db
    .select({
      traceId: spans.traceId,
      name: spans.name,
      startedAt: spans.startedAt,
      durationMs: spans.durationMs,
      status: spans.status,
      inputTokens: attrNumberOrZero(ATTR_GEN_AI_USAGE_INPUT_TOKENS),
      outputTokens: attrNumberOrZero(ATTR_GEN_AI_USAGE_OUTPUT_TOKENS),
      costMicroUsd: attrNumberOrNull(ATTR_MLIP_COST_MICROUSD),
      evalRunId: attrText(ATTR_MLIP_EVAL_RUN_ID),
      evalCaseId: attrText(ATTR_MLIP_EVAL_CASE_ID),
    })
    .from(spans)
    .where(isNull(spans.parentSpanId))
    .orderBy(desc(spans.startedAt))
    .limit(limit);

  const toolCounts = await db
    .select({ traceId: spans.traceId, toolCalls: count() })
    .from(spans)
    .where(sql`${spans.name} like 'execute_tool %'`)
    .groupBy(spans.traceId);
  const toolsByTrace = new Map(toolCounts.map((row) => [row.traceId, row.toolCalls]));

  return roots.map((row) => ({
    traceId: row.traceId,
    kind: kindOf(row.name),
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicroUsd: row.costMicroUsd,
    toolCalls: toolsByTrace.get(row.traceId) ?? 0,
    evalRunId: row.evalRunId,
    evalCaseId: row.evalCaseId,
  }));
}

/** Eval runs, newest first: root spans carrying a run id, grouped and
 * summed in SQL. */
export async function listEvalRunSummaries(db: Database): Promise<EvalRunSummary[]> {
  const runId = attrText(ATTR_MLIP_EVAL_RUN_ID);
  const rows = await db
    .select({
      runId: sql<string>`${runId}`,
      startedAt: sql<Date>`min(${spans.startedAt})`.mapWith((value) =>
        value instanceof Date ? value : new Date(value as string),
      ),
      caseCount: count(),
      totalInputTokens: attrSumOrZero(ATTR_GEN_AI_USAGE_INPUT_TOKENS),
      totalOutputTokens: attrSumOrZero(ATTR_GEN_AI_USAGE_OUTPUT_TOKENS),
      totalCostMicroUsd: attrSumOrZero(ATTR_MLIP_COST_MICROUSD),
      totalDurationMs: sql<number>`coalesce(sum(${spans.durationMs}), 0)`.mapWith(Number),
    })
    .from(spans)
    .where(and(isNull(spans.parentSpanId), sql`${runId} is not null`))
    .groupBy(runId)
    .orderBy(desc(sql`min(${spans.startedAt})`));

  return rows;
}
