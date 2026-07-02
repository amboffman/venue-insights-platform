import type { ChatStreamEvent } from "@/lib/types/chat";

// Client-side half of the NDJSON wire format (ADR-0003): turns the fetch
// response body back into typed events. Chunk boundaries are arbitrary — a
// JSON line can be split across reads — so lines are only parsed once a
// newline lands in the buffer.

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
        if (line) yield JSON.parse(line) as ChatStreamEvent;
        newlineIndex = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as ChatStreamEvent;
  } finally {
    reader.releaseLock();
  }
}
