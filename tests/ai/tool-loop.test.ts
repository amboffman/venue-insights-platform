// @vitest-environment node
// The loop is tested with a scripted fake Anthropic client and a real PGlite
// database: the model responses are canned, but every tool execution runs the
// real validate → SQL → typed-output path against the real seed data.
import type Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import type { ClaudeClient } from "@/lib/ai/tool-loop";
import { askQuestion } from "@/lib/ai/tool-loop";
import type { Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { generateSeedData } from "@/lib/db/seed-data";
import type { LocationSummary } from "@/lib/types/domain";

const seed = generateSeedData();
let db: Database;

beforeAll(async () => {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: "src/lib/db/migrations" });
  db = pglite as unknown as Database;

  for (const [table, rows] of [
    [schema.brands, seed.brands],
    [schema.locations, seed.locations],
    [schema.reviews, seed.reviews],
    [schema.dailyMetrics, seed.dailyMetrics],
  ] as const) {
    for (let i = 0; i < rows.length; i += 2000) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pglite.insert(table as any).values(rows.slice(i, i + 2000) as any);
    }
  }
}, 120_000);

function message(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.Message["stop_reason"],
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 } as Anthropic.Usage,
  } as Anthropic.Message;
}

function textBlock(text: string): Anthropic.TextBlock {
  return { type: "text", text, citations: null } as Anthropic.TextBlock;
}

function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as Anthropic.ToolUseBlock;
}

/** Fake client that returns queued responses and records every request. */
function fakeClient(responses: Anthropic.Message[]): {
  client: ClaudeClient;
  requests: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const queue = [...responses];
  return {
    requests,
    client: {
      messages: {
        create: (params) => {
          requests.push(params);
          const next = queue.shift();
          if (!next) throw new Error("fake client ran out of responses");
          return Promise.resolve(next);
        },
      },
    },
  };
}

describe("askQuestion", () => {
  it("runs a tool call and returns the grounded answer", async () => {
    const { client, requests } = fakeClient([
      message(
        [toolUseBlock("tu_1", "search_locations", { city: "Austin", limit: 100 })],
        "tool_use",
      ),
      message([textBlock("Austin has N locations.")], "end_turn"),
    ]);

    const result = await askQuestion({ client, db }, "How many locations are in Austin?");

    expect(result.answer).toBe("Austin has N locations.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toEqual([
      {
        name: "search_locations",
        input: { city: "Austin", limit: 100 },
        ok: true,
      },
    ]);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });

    // The second request must carry the real tool output back to the model.
    const secondRequest = requests[1]!;
    expect(secondRequest.messages).toHaveLength(3);
    const toolResultMessage = secondRequest.messages[2]!;
    expect(toolResultMessage.role).toBe("user");
    const blocks = toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(blocks[0]!.tool_use_id).toBe("tu_1");
    const rows = JSON.parse(blocks[0]!.content as string) as LocationSummary[];
    expect(rows).toHaveLength(seed.locations.filter((l) => l.city === "Austin").length);
  });

  it("sends tool spec definitions with every request", async () => {
    const { client, requests } = fakeClient([message([textBlock("Hi")], "end_turn")]);
    await askQuestion({ client, db }, "Hello");
    expect(requests[0]!.tools?.map((t) => t.name)).toEqual([
      "search_locations",
      "get_location_details",
      "aggregate_metrics",
      "compare_locations",
    ]);
    expect(requests[0]!.system).toBeTruthy();
  });

  it("feeds validation failures back as is_error tool results", async () => {
    const { client, requests } = fakeClient([
      message([toolUseBlock("tu_1", "get_location_details", { locationId: "abc" })], "tool_use"),
      message([toolUseBlock("tu_2", "get_location_details", { locationId: 1 })], "tool_use"),
      message([textBlock("Recovered.")], "end_turn"),
    ]);

    const result = await askQuestion({ client, db }, "Details for location 1");

    expect(result.answer).toBe("Recovered.");
    expect(result.toolCalls[0]!.ok).toBe(false);
    expect(result.toolCalls[0]!.error).toContain("Invalid input");
    expect(result.toolCalls[1]!.ok).toBe(true);

    const errorBlocks = requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(errorBlocks[0]!.is_error).toBe(true);
    // Successful results must NOT carry the flag.
    const okBlocks = requests[2]!.messages[4]!.content as Anthropic.ToolResultBlockParam[];
    expect(okBlocks[0]!.is_error).toBeUndefined();
  });

  it("returns all parallel tool results in a single user message", async () => {
    const { client, requests } = fakeClient([
      message(
        [
          toolUseBlock("tu_1", "get_location_details", { locationId: 1 }),
          toolUseBlock("tu_2", "get_location_details", { locationId: 2 }),
        ],
        "tool_use",
      ),
      message([textBlock("Both compared.")], "end_turn"),
    ]);

    await askQuestion({ client, db }, "Compare locations 1 and 2");

    const followup = requests[1]!.messages;
    expect(followup).toHaveLength(3); // question, assistant, ONE user message
    const blocks = followup[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(blocks.map((b) => b.tool_use_id)).toEqual(["tu_1", "tu_2"]);
  });

  it("stops at the tool-iteration limit instead of looping forever", async () => {
    const relentless = Array.from({ length: 5 }, (_, i) =>
      message([toolUseBlock(`tu_${i}`, "search_locations", {})], "tool_use"),
    );
    const { client, requests } = fakeClient(relentless);

    const result = await askQuestion({ client, db }, "Loop forever", {
      maxToolIterations: 3,
    });

    expect(requests).toHaveLength(3);
    expect(result.iterations).toBe(3);
    expect(result.stopReason).toBe("tool_use");
  });

  it("resumes after pause_turn by re-sending the assistant turn", async () => {
    const { client, requests } = fakeClient([
      message([textBlock("Partial…")], "pause_turn"),
      message([textBlock("Done.")], "end_turn"),
    ]);

    const result = await askQuestion({ client, db }, "Long task");

    expect(result.answer).toBe("Done.");
    expect(requests[1]!.messages).toHaveLength(2);
    expect(requests[1]!.messages[1]!.role).toBe("assistant");
  });
});
