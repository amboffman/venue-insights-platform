import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { eventsToNdjsonStream } from "@/lib/ai/ndjson";
import { anthropicStreamingClient, streamAnswer } from "@/lib/ai/stream-loop";
import { getDb } from "@/lib/db/client";

// postgres-js needs Node APIs — this route cannot run on the edge runtime.
export const runtime = "nodejs";
// Streaming answers with tool round-trips can exceed Vercel's default limit.
export const maxDuration = 60;

const bodySchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
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

  const events = streamAnswer(
    { client: anthropicStreamingClient(new Anthropic()), db: getDb() },
    turns,
  );

  return new Response(eventsToNdjsonStream(events), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
