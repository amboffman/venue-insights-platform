// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StreamingClaudeClient } from "@/lib/ai/stream-loop";
import { streamAnswer } from "@/lib/ai/stream-loop";
import type { Database } from "@/lib/db/client";
import type { ChatStreamEvent, ChatTurn } from "@/lib/types/chat";
import {
  fakeStreamingClient,
  message as finalMessage,
  textBlock,
  toolUseBlock,
  type FakeRound,
} from "../helpers/anthropic-fixtures";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

let seeded: SeededDb;
let db: Database;

beforeAll(async () => {
  seeded = await createSeededDb();
  db = seeded.db;
}, 120_000);

afterAll(() => seeded.close());

async function collect(generator: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

const ask = (content: string): ChatTurn[] => [{ role: "user", content }];

describe("streamAnswer", () => {
  it("yields text deltas, tool activity, and a final done event in order", async () => {
    const searchInput = { city: "Austin", limit: 100 };
    const { client } = fakeStreamingClient([
      {
        deltas: ["Let me check."],
        final: finalMessage(
          [textBlock("Let me check."), toolUseBlock("tu_1", "search_locations", searchInput)],
          "tool_use",
        ),
      },
      {
        deltas: ["Austin has ", "N locations."],
        final: finalMessage([textBlock("Austin has N locations.")], "end_turn"),
      },
    ]);

    const events = await collect(
      streamAnswer({ client, db }, ask("How many locations in Austin?")),
    );

    expect(events.map((e) => e.type)).toEqual([
      "text_delta",
      "tool_start",
      "tool_result",
      "text_delta",
      "text_delta",
      "done",
    ]);

    const toolStart = events[1] as Extract<ChatStreamEvent, { type: "tool_start" }>;
    expect(toolStart.name).toBe("search_locations");
    expect(toolStart.input).toEqual(searchInput);

    const toolResult = events[2] as Extract<ChatStreamEvent, { type: "tool_result" }>;
    expect(toolResult.ok).toBe(true);
    expect(Array.isArray(toolResult.output)).toBe(true);

    const done = events.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
    expect(done.stopReason).toBe("end_turn");
  });

  it("maps the client transcript into API messages", async () => {
    const { client, requests } = fakeStreamingClient([
      { deltas: [], final: finalMessage([textBlock("Sure.")], "end_turn") },
    ]);
    const turns: ChatTurn[] = [
      { role: "user", content: "How many locations are in Austin?" },
      { role: "assistant", content: "Austin has 5 locations." },
      { role: "user", content: "And which earns the most?" },
    ];

    await collect(streamAnswer({ client, db }, turns));

    expect(requests[0]!.messages).toEqual([
      { role: "user", content: "How many locations are in Austin?" },
      { role: "assistant", content: "Austin has 5 locations." },
      { role: "user", content: "And which earns the most?" },
    ]);
  });

  it("reports tool failures as non-ok results and lets the model recover", async () => {
    const { client } = fakeStreamingClient([
      {
        deltas: [],
        final: finalMessage(
          [toolUseBlock("tu_1", "get_location_details", { locationId: "x" })],
          "tool_use",
        ),
      },
      {
        deltas: ["Recovered."],
        final: finalMessage([textBlock("Recovered.")], "end_turn"),
      },
    ]);

    const events = await collect(streamAnswer({ client, db }, ask("Details for location x")));

    const toolResult = events.find((e) => e.type === "tool_result") as Extract<
      ChatStreamEvent,
      { type: "tool_result" }
    >;
    expect(toolResult.ok).toBe(false);
    expect(toolResult.error).toContain("Invalid input");
    expect(events.at(-1)!.type).toBe("done");
  });

  it("ends with an error event instead of throwing when the API fails", async () => {
    const client: StreamingClaudeClient = {
      streamMessage() {
        throw new Error("rate limited");
      },
    };

    const events = await collect(streamAnswer({ client, db }, ask("Hi")));

    expect(events).toEqual([{ type: "error", message: "rate limited" }]);
  });

  it("stops at the iteration limit with done rather than looping", async () => {
    const rounds: FakeRound[] = Array.from({ length: 5 }, (_, i) => ({
      deltas: [],
      final: finalMessage([toolUseBlock(`tu_${i}`, "search_locations", {})], "tool_use"),
    }));
    const { client, requests } = fakeStreamingClient(rounds);

    const events = await collect(
      streamAnswer({ client, db }, ask("Loop"), { maxToolIterations: 2 }),
    );

    expect(requests).toHaveLength(2);
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done.stopReason).toBe("tool_use");
  });
});
