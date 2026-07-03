import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  insertSpans,
  listEvalRunSummaries,
  listTurnSummaries,
  sumChatCostMicroUsdSince,
} from "@/lib/db/spans";
import type { SpanRecord } from "@/lib/types/telemetry";

import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// Dashboard aggregate queries against real migrations in PGlite. Expected
// numbers are computed by hand from the fixture spans below — two
// implementations agreeing (SQL vs arithmetic), same pattern as
// queries.test.ts.

let nextSpan = 0;
function span(partial: Partial<SpanRecord> & { traceId: string; name: string }): SpanRecord {
  nextSpan++;
  return {
    spanId: `span${String(nextSpan).padStart(12, "0")}`,
    parentSpanId: null,
    startedAt: new Date("2026-07-03T10:00:00Z"),
    endedAt: new Date("2026-07-03T10:00:01Z"),
    durationMs: 1000,
    status: "unset",
    statusMessage: null,
    attributes: {},
    ...partial,
  };
}

// Trace A: a chat turn (newest) — 2 API rounds, 2 tool calls, priced.
// Traces B, C: eval-run turns (older) — one with a tool call, one without;
// C has no cost attribute (unknown-model path).
const TRACE_A = "a".repeat(32);
const TRACE_B = "b".repeat(32);
const TRACE_C = "c".repeat(32);

const fixtures: SpanRecord[] = [
  span({
    traceId: TRACE_A,
    name: "mlip.chat_turn",
    startedAt: new Date("2026-07-03T12:00:00Z"),
    durationMs: 3200,
    attributes: {
      "gen_ai.usage.input_tokens": 300,
      "gen_ai.usage.output_tokens": 120,
      "mlip.cost_microusd": 2700,
      "mlip.iterations": 2,
    },
  }),
  span({ traceId: TRACE_A, name: "chat claude-sonnet-5", parentSpanId: "x1" }),
  span({ traceId: TRACE_A, name: "chat claude-sonnet-5", parentSpanId: "x1" }),
  span({ traceId: TRACE_A, name: "execute_tool search_locations", parentSpanId: "x1" }),
  span({ traceId: TRACE_A, name: "execute_tool aggregate_metrics", parentSpanId: "x1" }),

  span({
    traceId: TRACE_B,
    name: "mlip.ask",
    startedAt: new Date("2026-07-03T11:00:00Z"),
    durationMs: 2000,
    status: "error",
    attributes: {
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
      "mlip.cost_microusd": 1050,
      "mlip.eval.run_id": "run-2026-07-03",
      "mlip.eval.case_id": "case-austin",
    },
  }),
  span({ traceId: TRACE_B, name: "execute_tool search_locations", parentSpanId: "x2" }),

  span({
    traceId: TRACE_C,
    name: "mlip.ask",
    startedAt: new Date("2026-07-03T11:00:05Z"),
    durationMs: 1500,
    attributes: {
      "gen_ai.usage.input_tokens": 80,
      "gen_ai.usage.output_tokens": 40,
      // no cost attribute — model without a pricing entry
      "mlip.eval.run_id": "run-2026-07-03",
      "mlip.eval.case_id": "case-revenue",
    },
  }),
];

describe("span dashboard queries", () => {
  let seeded: SeededDb;

  beforeAll(async () => {
    seeded = await createSeededDb();
    await insertSpans(seeded.db, fixtures);
  });

  afterAll(async () => {
    await seeded.close();
  });

  it("lists turn summaries newest-first with tool counts and attrs", async () => {
    const turns = await listTurnSummaries(seeded.db);

    expect(turns.map((t) => t.traceId)).toEqual([TRACE_A, TRACE_C, TRACE_B]);

    const [chat, evalNoCost, evalWithTool] = turns;
    expect(chat!.kind).toBe("chat");
    expect(chat!.toolCalls).toBe(2);
    expect(chat!.inputTokens).toBe(300);
    expect(chat!.outputTokens).toBe(120);
    expect(chat!.costMicroUsd).toBe(2700);
    expect(chat!.evalRunId).toBeNull();
    expect(chat!.status).toBe("unset");

    expect(evalWithTool!.kind).toBe("ask");
    expect(evalWithTool!.toolCalls).toBe(1);
    expect(evalWithTool!.status).toBe("error");
    expect(evalWithTool!.evalRunId).toBe("run-2026-07-03");
    expect(evalWithTool!.evalCaseId).toBe("case-austin");

    // Absent cost stays null (unknown model) — not coalesced into $0.
    expect(evalNoCost!.costMicroUsd).toBeNull();
    expect(evalNoCost!.toolCalls).toBe(0);
  });

  it("respects the limit", async () => {
    const turns = await listTurnSummaries(seeded.db, 1);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.traceId).toBe(TRACE_A);
  });

  it("sums only chat-turn spend for the budget gate", async () => {
    // Trace A is the only mlip.chat_turn (2700µ$); B/C are mlip.ask and
    // child spans carry no cost — none of them may leak into the budget.
    const sinceMorning = await sumChatCostMicroUsdSince(
      seeded.db,
      new Date("2026-07-03T00:00:00Z"),
    );
    expect(sinceMorning).toBe(2700);

    // `since` is respected: a cutoff after trace A's start excludes it.
    const sinceLater = await sumChatCostMicroUsdSince(seeded.db, new Date("2026-07-03T12:30:00Z"));
    expect(sinceLater).toBe(0);
  });

  it("aggregates eval runs across their case turns", async () => {
    const runs = await listEvalRunSummaries(seeded.db);

    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.runId).toBe("run-2026-07-03");
    expect(run.caseCount).toBe(2);
    expect(run.totalInputTokens).toBe(180); // 100 + 80
    expect(run.totalOutputTokens).toBe(90); // 50 + 40
    expect(run.totalCostMicroUsd).toBe(1050); // missing cost sums as 0
    expect(run.totalDurationMs).toBe(3500); // 2000 + 1500
    expect(run.startedAt.toISOString()).toBe("2026-07-03T11:00:00.000Z");
  });
});
