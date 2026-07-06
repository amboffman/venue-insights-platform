import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import {
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_MLIP_COST_MICROUSD,
  ATTR_MLIP_EVAL_CASE_ID,
  ATTR_MLIP_EVAL_RUN_ID,
  SPAN_NAME_ASK,
  SPAN_NAME_CHAT_TURN,
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
  if (name === SPAN_NAME_ASK) return "ask";
  if (name === SPAN_NAME_CHAT_TURN) return "chat";
  return "other";
}

/** Total public-chat spend since `since` — the daily-budget sensor
 * (ADR-0007). Counts only finished chat turns: eval runs (mlip.ask) spend
 * the operator's own money, and in-flight turns haven't exported yet, so
 * the gate is eventually-consistent by design — the Anthropic Console
 * spend cap is the hard backstop. */
export async function sumChatCostMicroUsdSince(db: Database, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: attrSumOrZero(ATTR_MLIP_COST_MICROUSD) })
    .from(spans)
    .where(
      and(
        isNull(spans.parentSpanId),
        eq(spans.name, SPAN_NAME_CHAT_TURN),
        gte(spans.startedAt, since),
      ),
    );
  return row?.total ?? 0;
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

  // Scoped to the roots actually shown: unscoped, this grouped EVERY
  // execute_tool span ever recorded (the table only grows — see
  // deleteSpansOlderThan) to serve a fixed 50-row page. inArray keeps it on
  // the trace_id index and bounded by `limit` regardless of table size.
  const traceIds = roots.map((row) => row.traceId);
  const toolCounts =
    traceIds.length === 0
      ? []
      : await db
          .select({ traceId: spans.traceId, toolCalls: count() })
          .from(spans)
          .where(and(sql`${spans.name} like 'execute_tool %'`, inArray(spans.traceId, traceIds)))
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
 * summed in SQL. Bounded two ways: a started_at floor (indexed) so the
 * jsonb-extracted run-id filter never walks the full root-span history —
 * which grows with PUBLIC chat traffic, not eval usage — and a LIMIT on
 * the grouped output. */
export async function listEvalRunSummaries(
  db: Database,
  options: { limit?: number; now?: Date } = {},
): Promise<EvalRunSummary[]> {
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();
  const floor = new Date(now.getTime() - SPAN_RETENTION_DAYS * DAY_MS);
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
    .where(
      and(isNull(spans.parentSpanId), sql`${runId} is not null`, gte(spans.startedAt, floor)),
    )
    .groupBy(runId)
    .orderBy(desc(sql`min(${spans.startedAt})`))
    .limit(limit);

  return rows;
}

// ── retention (ADR-0011) ────────────────────────────────────────────────
// The spans table was insert-only with no purge anywhere: every public chat
// turn and every eval case grew it forever, and the observability
// aggregates re-scanned that whole history per page view. 90 days keeps
// far more than the demo ever shows (the dashboard displays 50 turns).

export const SPAN_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Purge spans older than the retention window. Called opportunistically
 * from the observability page (the same piggyback pattern as the
 * rate-limit purge) — cheap when there is nothing to delete because
 * started_at is indexed. */
export async function deleteExpiredSpans(
  db: Database,
  now: Date = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - SPAN_RETENTION_DAYS * DAY_MS);
  await db.delete(spans).where(lt(spans.startedAt, cutoff));
}
