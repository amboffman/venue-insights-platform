import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { eventsToNdjsonStream } from "@/lib/ai/ndjson";
import { anthropicStreamingClient, streamAnswer } from "@/lib/ai/stream-loop";
import { getDb } from "@/lib/db/client";
import { MAX_CHAT_TURNS, MAX_TURN_CHARS } from "@/lib/types/chat";

// postgres-js needs Node APIs — this route cannot run on the edge runtime.
export const runtime = "nodejs";
// Streaming answers with tool round-trips can exceed Vercel's default limit.
export const maxDuration = 60;

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

  const events = streamAnswer(
    { client: anthropicStreamingClient(new Anthropic()), db: getDb() },
    turns,
    // Client disconnect aborts the in-flight Anthropic request instead of
    // letting it stream (and bill) to completion.
    { signal: request.signal },
  );

  return new Response(eventsToNdjsonStream(events), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
