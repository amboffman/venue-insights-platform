// @vitest-environment node
// The loop is tested with a scripted fake Anthropic client and a real PGlite
// database: the model responses are canned, but every tool execution runs the
// real validate → SQL → typed-output path against the real seed data.
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { askQuestion } from "@/lib/ai/tool-loop";
import type { Database } from "@/lib/db/client";
import { generateSeedData } from "@/lib/db/seed-data";
import type { LocationSummary } from "@/lib/types/domain";
import { fakeClient, message, textBlock, toolUseBlock } from "../helpers/anthropic-fixtures";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

const seed = generateSeedData();
let seeded: SeededDb;
let db: Database;

beforeAll(async () => {
  seeded = await createSeededDb();
  db = seeded.db;
}, 120_000);

afterAll(() => seeded.close());

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
        // typed domain output is recorded for the eval scorers (Week 5)
        output: expect.any(Array),
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

  it("resumes after pause_turn, keeping text from before the pause", async () => {
    const { client, requests } = fakeClient([
      message([textBlock("Partial…")], "pause_turn"),
      message([textBlock("Done.")], "end_turn"),
    ]);

    const result = await askQuestion({ client, db }, "Long task");

    // Resumed responses contain only the continuation — the pre-pause text
    // must survive into the final answer.
    expect(result.answer).toBe("Partial…\nDone.");
    expect(requests[1]!.messages).toHaveLength(2);
    expect(requests[1]!.messages[1]!.role).toBe("assistant");
  });

  it("does not duplicate the final pause's text when the pause cap is hit", async () => {
    // 10 pause responses > MAX_PAUSE_ROUNDS (8): the loop exits ON a pause.
    // That last pause's text is already folded into pausedText — the old
    // code appended it a second time.
    const pauses = Array.from({ length: 10 }, (_, i) =>
      message([textBlock(`fragment ${i}`)], "pause_turn"),
    );
    const { client } = fakeClient(pauses);

    const result = await askQuestion({ client, db }, "Pause forever");

    const lastFragment = /fragment 8/g;
    expect(result.answer.match(lastFragment)).toHaveLength(1);
  });

  it("does not execute tools requested on the final permitted round", async () => {
    const { client } = fakeClient([
      message([toolUseBlock("tu_1", "search_locations", {})], "tool_use"),
      message([toolUseBlock("tu_2", "search_locations", {})], "tool_use"),
    ]);

    const result = await askQuestion({ client, db }, "Loop", {
      maxToolIterations: 2,
    });

    // Round 1 executes; round 2's request happens but its tools are skipped —
    // their results could never be sent back to the model.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
  });
});
