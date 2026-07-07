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

  it("cancel() settles only after the generator's finally chain completes", async () => {
    // The abandonment path (client disconnect) must AWAIT the generator's
    // teardown: that finally chain is where the turn span ends and telemetry
    // flushes, and a serverless function can freeze the moment cancellation
    // settles. This pins the ordering: teardown first, then cancel resolves.
    const order: string[] = [];
    async function* slowTeardown(): AsyncGenerator<ChatStreamEvent> {
      try {
        yield { type: "text_delta", text: "first" };
        yield { type: "text_delta", text: "never read" };
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("teardown finished");
      }
    }

    const reader = eventsToNdjsonStream(slowTeardown()).getReader();
    await reader.read(); // consume one event so the generator is mid-flight
    await reader.cancel();
    order.push("cancel settled");

    expect(order).toEqual(["teardown finished", "cancel settled"]);
  });
});
