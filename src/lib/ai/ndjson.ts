import type { ChatStreamEvent } from "../types/chat";

// Serializes the streaming loop's events as newline-delimited JSON — the
// chat wire format (ADR-0003). Pull-based: the generator is only advanced
// when the client is ready for more, so backpressure works for free.

export function eventsToNdjsonStream(
  events: AsyncGenerator<ChatStreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        // A generator that throws mid-stream still ends with a parseable
        // error event rather than an aborted connection.
        const message = error instanceof Error ? error.message : String(error);
        const event: ChatStreamEvent = { type: "error", message };
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — stop the loop instead of burning tokens.
      void events.return(undefined);
    },
  });
}
