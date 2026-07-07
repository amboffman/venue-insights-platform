import type { ChatStreamEvent } from "@/lib/types/chat";

// Client-side half of the NDJSON wire format (ADR-0003): turns the fetch
// response body back into typed events. Chunk boundaries are arbitrary — a
// JSON line can be split across reads — so lines are only parsed once a
// newline lands in the buffer.

/** One line → one event, defensively. A proxy-injected fragment, a
 * truncated flush, or a valid-JSON-but-not-an-event line (`null`) used to
 * throw out of the generator and kill the whole stream — discarding every
 * valid event still buffered behind it, including `done`. A bad line is
 * skipped instead; a genuinely severed stream is still reported by the
 * caller's saw-terminal-event check. */
function parseEventLine(line: string): ChatStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      return parsed as ChatStreamEvent;
    }
  } catch {
    /* not JSON — skip */
  }
  return null;
}

export async function* readNdjsonEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const event = parseEventLine(line);
          if (event) yield event;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
    // Flush the decoder: a multi-byte UTF-8 character split at the final
    // chunk boundary is still buffered inside it.
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const event = parseEventLine(tail);
      if (event) yield event;
    }
  } finally {
    // Cancel (not just release): if the consumer exits early, this tears the
    // HTTP body down so the server's stream cancel fires and the tool loop
    // stops. On a fully-read stream it's a no-op.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
