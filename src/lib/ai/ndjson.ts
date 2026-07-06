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
    async cancel() {
      // Client disconnected — stop the loop instead of burning tokens. (The
      // route also aborts the in-flight API request via request.signal.)
      // RETURNING the promise matters: the generator's finally chain ends
      // the turn span and awaits the telemetry flush, and a serverless
      // function may freeze the moment cancellation settles. Fire-and-forget
      // here silently dropped abandoned turns' spans (and their cost) on
      // deploys — the one path where route.ts's "runs on abandonment too"
      // guarantee didn't actually hold.
      cancelled = true;
      await events.return(undefined);
    },
  });
}
