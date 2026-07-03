// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "../types/chat";
import { eventsToNdjsonStream } from "./ndjson";

async function* generatorOf(events: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const event of events) yield event;
}

describe("eventsToNdjsonStream", () => {
  it("writes one JSON line per event", async () => {
    const stream = eventsToNdjsonStream(
      generatorOf([
        { type: "text_delta", text: "Hello" },
        { type: "done", usage: { inputTokens: 1, outputTokens: 2 }, stopReason: "end_turn" },
      ]),
    );

    const body = await new Response(stream).text();
    const lines = body.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ type: "text_delta", text: "Hello" });
    expect(body.endsWith("\n")).toBe(true);
  });

  it("converts a mid-stream generator crash into a parseable error event", async () => {
    async function* crashing(): AsyncGenerator<ChatStreamEvent> {
      yield { type: "text_delta", text: "partial" };
      throw new Error("boom");
    }

    const body = await new Response(eventsToNdjsonStream(crashing())).text();
    const lines = body.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toEqual({ type: "error", message: "boom" });
  });
});
