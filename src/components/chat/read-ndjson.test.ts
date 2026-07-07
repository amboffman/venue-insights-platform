// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readNdjsonEvents } from "./read-ndjson";

function streamOfChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of readNdjsonEvents(body)) events.push(event);
  return events;
}

describe("readNdjsonEvents", () => {
  it("parses events even when chunk boundaries split a JSON line", async () => {
    // One event split across three chunks, one chunk carrying two events.
    const events = await collect(
      streamOfChunks([
        '{"type":"text_de',
        'lta","text":"Hel',
        'lo"}\n{"type":"text_delta","text":"!"}\n{"type":"tool_start","id":"tu_1",',
        '"name":"search_locations","input":{}}\n',
      ]),
    );

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: "!" },
      { type: "tool_start", id: "tu_1", name: "search_locations", input: {} },
    ]);
  });

  it("parses a final line that has no trailing newline", async () => {
    const events = await collect(streamOfChunks(['{"type":"error","message":"cut off"}']));
    expect(events).toEqual([{ type: "error", message: "cut off" }]);
  });

  it("skips malformed or non-event lines instead of killing the stream", async () => {
    // A proxy-injected HTML fragment, a bare JSON null, then a valid done —
    // everything after the garbage must still arrive.
    const events = await collect(
      streamOfChunks([
        '{"type":"text_delta","text":"Hi"}\n',
        "<html>502 Bad Gateway</html>\n",
        "null\n",
        '{"type":"done","usage":{"inputTokens":1,"outputTokens":2},"stopReason":"end_turn"}\n',
      ]),
    );

    expect(events).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "done", usage: { inputTokens: 1, outputTokens: 2 }, stopReason: "end_turn" },
    ]);
  });

  it("skips a malformed tail with no trailing newline", async () => {
    const events = await collect(
      streamOfChunks(['{"type":"text_delta","text":"Hi"}\n{"type":"done","usa']),
    );
    expect(events).toEqual([{ type: "text_delta", text: "Hi" }]);
  });
});
