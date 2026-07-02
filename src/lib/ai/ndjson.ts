import type { ChatStreamEvent } from "../types/chat";

// Serializes the streaming loop's events as newline-delimited JSON — the
// chat wire format (ADR-0003). Pull-based: the generator is only advanced
// when the client is ready for more, so backpressure works for free.

export function eventsToNdjsonStream(
  events: AsyncGenerator<ChatStreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (cancelled) return; // resolved after cancel — nothing to write to
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        if (cancelled) return;
        // A generator that throws mid-stream still ends with a parseable
        // error event rather than an aborted connection. enqueue can itself
        // throw if the stream tore down between checks — nothing left to do.
        try {
          const message = error instanceof Error ? error.message : String(error);
          const event: ChatStreamEvent = { type: "error", message };
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          controller.close();
        } catch {
          /* stream already closed/cancelled */
        }
      }
    },
    cancel() {
      // Client disconnected — stop the loop instead of burning tokens. (The
      // route also aborts the in-flight API request via request.signal.)
      cancelled = true;
      void events.return(undefined);
    },
  });
}
