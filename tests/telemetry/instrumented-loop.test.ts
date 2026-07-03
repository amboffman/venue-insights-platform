import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { askQuestion } from "@/lib/ai/tool-loop";
import { installTelemetry, shutdownTelemetry } from "@/lib/telemetry/provider";

import { fakeClient, message, textBlock, toolUseBlock } from "../helpers/anthropic-fixtures";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// End-to-end instrumentation check: the loop runs with a scripted fake
// client but REAL telemetry (global provider + in-memory exporter) and REAL
// tool execution against PGlite. Asserts the span TREE the loop emits —
// names, parentage, GenAI attributes, cost — not just that something ran.

describe("instrumented tool loop", () => {
  let seeded: SeededDb;
  const exporter = new InMemorySpanExporter();

  beforeAll(async () => {
    seeded = await createSeededDb();
    installTelemetry(exporter);
  });

  afterAll(async () => {
    await shutdownTelemetry();
    await seeded.close();
  });

  it("emits a turn → {chat, execute_tool} span tree with usage and cost", async () => {
    const { client } = fakeClient([
      message(
        [toolUseBlock("tu_1", "search_locations", { city: "Austin", limit: 100 })],
        "tool_use",
      ),
      message([textBlock("Austin has locations.")], "end_turn"),
    ]);

    await askQuestion({ client, db: seeded.db }, "How many locations in Austin?", {
      telemetryAttributes: { "mlip.eval.case_id": "case-1" },
    });

    const spans = exporter.getFinishedSpans().map((s) => ({
      name: s.name,
      attributes: { ...s.attributes } as Record<string, unknown>,
      spanId: s.spanContext().spanId,
      traceId: s.spanContext().traceId,
      parentSpanId: s.parentSpanContext?.spanId,
    }));

    // 1 turn + 2 API rounds + 1 tool run.
    expect(spans).toHaveLength(4);
    const turn = spans.find((s) => s.name === "mlip.ask")!;
    const chats = spans.filter((s) => s.name === "chat claude-sonnet-5");
    const tool = spans.find((s) => s.name === "execute_tool search_locations")!;
    expect(chats).toHaveLength(2);

    // Everything shares the turn's trace, and hangs directly off the turn.
    for (const span of [...chats, tool]) {
      expect(span.traceId).toBe(turn.traceId);
      expect(span.parentSpanId).toBe(turn.spanId);
    }

    // The correlation attribute the eval runner will pass lands on the root.
    expect(turn.attributes["mlip.eval.case_id"]).toBe("case-1");

    // Turn totals: fixtures bill 100 in / 50 out per round × 2 rounds.
    expect(turn.attributes["mlip.iterations"]).toBe(2);
    expect(turn.attributes["gen_ai.usage.input_tokens"]).toBe(200);
    expect(turn.attributes["gen_ai.usage.output_tokens"]).toBe(100);
    // 200×3 + 100×15 µ$
    expect(turn.attributes["mlip.cost_microusd"]).toBe(2100);

    // Each API round carries GenAI semconv attributes + its own cost.
    for (const chat of chats) {
      expect(chat.attributes["gen_ai.operation.name"]).toBe("chat");
      expect(chat.attributes["gen_ai.provider.name"]).toBe("anthropic");
      expect(chat.attributes["gen_ai.request.model"]).toBe("claude-sonnet-5");
      expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(100);
      expect(chat.attributes["gen_ai.usage.output_tokens"]).toBe(50);
      expect(chat.attributes["mlip.cost_microusd"]).toBe(1050);
    }
    const finishReasons = chats.map(
      (chat) => (chat.attributes["gen_ai.response.finish_reasons"] as string[])[0],
    );
    expect(finishReasons).toEqual(["tool_use", "end_turn"]);

    // Tool span records the semconv operation and the outcome.
    expect(tool.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(tool.attributes["gen_ai.tool.name"]).toBe("search_locations");
    expect(tool.attributes["mlip.tool.ok"]).toBe(true);
  });

  it("marks a failed tool run as an error outcome, not an exception", async () => {
    exporter.reset();
    const { client } = fakeClient([
      // locationId must be a number — zod rejects this, runTool returns ok:false.
      message([toolUseBlock("tu_1", "get_location_details", { locationId: "abc" })], "tool_use"),
      message([textBlock("Could not find it.")], "end_turn"),
    ]);

    await askQuestion({ client, db: seeded.db }, "Details for location abc?");

    const spans = exporter.getFinishedSpans();
    const tool = spans.find((s) => s.name === "execute_tool get_location_details")!;
    expect(tool).toBeDefined();
    expect(tool.attributes["mlip.tool.ok"]).toBe(false);
    // status code 2 = ERROR; the zod error text is the message.
    expect(tool.status.code).toBe(2);
    expect(tool.status.message).toBeTruthy();
  });

  it("attaches no attributes and breaks nothing when options are omitted", async () => {
    exporter.reset();
    const { client } = fakeClient([message([textBlock("Fine, thanks.")], "end_turn")]);

    const result = await askQuestion({ client, db: seeded.db }, "How are you?");

    expect(result.answer).toBe("Fine, thanks.");
    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual(["chat claude-sonnet-5", "mlip.ask"]);
  });
});
