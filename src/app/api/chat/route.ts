import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { eventsToNdjsonStream } from "@/lib/ai/ndjson";
import { anthropicStreamingClient, streamAnswer } from "@/lib/ai/stream-loop";
import { getDb } from "@/lib/db/client";
import { flushTelemetry, initTelemetry } from "@/lib/telemetry/provider";
import type { ChatStreamEvent } from "@/lib/types/chat";
import { MAX_CHAT_TURNS, MAX_TURN_CHARS } from "@/lib/types/chat";

// postgres-js needs Node APIs — this route cannot run on the edge runtime.
export const runtime = "nodejs";
// Streaming answers with tool round-trips can exceed Vercel's default limit.
export const maxDuration = 60;

/** Serverless functions freeze right after the response finishes — awaiting
 * the span exports INSIDE the stream (before it closes) is what guarantees
 * the turn's telemetry lands. Runs on abandonment too (cancel → finally). */
async function* withTelemetryFlush(
  events: AsyncGenerator<ChatStreamEvent>,
): AsyncGenerator<ChatStreamEvent> {
  try {
    yield* events;
  } finally {
    await flushTelemetry();
  }
}

// Limits come from the shared wire contract — the client trims/truncates to
// the same constants before sending, so a well-behaved client never 400s.
const bodySchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_TURN_CHARS),
      }),
    )
    .min(1)
    .max(MAX_CHAT_TURNS),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid request: ${z.prettifyError(parsed.error)}` },
      { status: 400 },
    );
  }
  const { turns } = parsed.data;
  if (turns.at(-1)?.role !== "user") {
    return Response.json({ error: "The last turn must be a user message." }, { status: 400 });
  }

  if (turns[0]?.role !== "user") {
    return Response.json({ error: "The first turn must be a user message." }, { status: 400 });
  }

  const db = getDb();
  // Spans → Postgres (ADR-0006). Idempotent; first request pays the setup.
  initTelemetry(db);

  const events = streamAnswer(
    { client: anthropicStreamingClient(new Anthropic()), db },
    turns,
    // Client disconnect aborts the in-flight Anthropic request instead of
    // letting it stream (and bill) to completion.
    { signal: request.signal },
  );

  return new Response(eventsToNdjsonStream(withTelemetryFlush(events)), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
