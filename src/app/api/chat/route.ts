import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { eventsToNdjsonStream } from "@/lib/ai/ndjson";
import { anthropicStreamingClient, streamAnswer } from "@/lib/ai/stream-loop";
import { getDb } from "@/lib/db/client";
import { hitRateLimit } from "@/lib/db/rate-limit";
import { sumChatCostMicroUsdSince } from "@/lib/db/spans";
import { flushTelemetry, initTelemetry } from "@/lib/telemetry/provider";
import type { ChatStreamEvent } from "@/lib/types/chat";
import { MAX_CHAT_TURNS, MAX_TURN_CHARS, formatViewContext } from "@/lib/types/chat";

// postgres-js needs Node APIs — this route cannot run on the edge runtime.
export const runtime = "nodejs";
// Headroom for multi-round tool turns. Vercel kills the function at this
// wall with no terminal event and no telemetry flush, so it must comfortably
// exceed a worst-case turn (8 rounds × CHAT_MAX_TOKENS + DB latency); 300s
// is the platform default ceiling on all plans since Fluid Compute.
export const maxDuration = 300;

// Chat answers are grounded rollups — a few paragraphs plus tool calls, not
// 16k-token essays. A smaller per-round budget bounds worst-case wall clock
// (and worst-case spend) without touching DEFAULT_MAX_TOKENS, which the
// terminal harness and evals still use.
const CHAT_MAX_TOKENS = 4096;

// ── public-endpoint cost protection (ADR-0007) ──────────────────────────
// This route spends real money per request, so it is gated twice: a per-IP
// fixed-window limit (fairness), then a daily spend ceiling read from the
// spans table (the Week 6 telemetry doubling as a circuit-breaker sensor).
// The Anthropic Console spend cap is the hard backstop behind both.

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const RATE_LIMIT_MAX = envInt("CHAT_RATE_LIMIT_MAX", 8);
const RATE_LIMIT_WINDOW_MS = envInt("CHAT_RATE_LIMIT_WINDOW_MINUTES", 10) * 60_000;
const DAILY_BUDGET_MICROUSD = envInt("CHAT_DAILY_BUDGET_MICROUSD", 2_000_000);

/** First hop of x-forwarded-for — set by Vercel's proxy, not the client,
 * so it is trustworthy on the platform we deploy to. The "unknown" fallback
 * only fires on hosts that set no proxy headers at all; every such caller
 * then shares ONE rate-limit bucket (8 req/window collectively). Acceptable
 * fail-closed default for a cost-gated demo — raise CHAT_RATE_LIMIT_MAX if
 * running somewhere without proxy headers. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function tooManyRequests(error: string, retryAfterSeconds: number): Response {
  return Response.json(
    { error },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

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
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
  // Dashboard filter state (ADR-0009) — optional; plain chat sends none.
  viewContext: z
    .object({
      from: isoDate,
      to: isoDate,
      brandSlug: z.string().min(1).max(100).nullable(),
      city: z.string().min(1).max(100).nullable(),
    })
    .optional(),
});

export async function POST(request: Request) {
  // Fail fast on the one env var this route cannot work without. Checked
  // before the paid gates: constructing the SDK client without a key used
  // to throw AFTER the request had already burned a rate-limit slot and
  // 2-3 DB roundtrips, then surfaced as an anonymous 500.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY — set it and redeploy." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid request: ${z.prettifyError(parsed.error)}` },
      { status: 400 },
    );
  }
  const { turns, viewContext } = parsed.data;
  if (turns.at(-1)?.role !== "user") {
    return Response.json({ error: "The last turn must be a user message." }, { status: 400 });
  }

  if (turns[0]?.role !== "user") {
    return Response.json({ error: "The first turn must be a user message." }, { status: 400 });
  }

  const db = getDb();
  // Spans → Postgres (ADR-0006). Idempotent; first request pays the setup.
  initTelemetry(db);

  // Cheapest check first: one upsert per request, scoped to the caller.
  const now = new Date();
  const hit = await hitRateLimit(db, `chat:${clientIp(request)}`, now, RATE_LIMIT_WINDOW_MS);
  if (hit.count > RATE_LIMIT_MAX) {
    return tooManyRequests(
      "You're sending messages too quickly — give it a few minutes.",
      hit.retryAfterSeconds,
    );
  }

  // Then the shared ceiling: today's finished chat turns, in microdollars.
  const startOfUtcDay = new Date(now);
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const spentToday = await sumChatCostMicroUsdSince(db, startOfUtcDay);
  if (spentToday >= DAILY_BUDGET_MICROUSD) {
    const utcMidnight = startOfUtcDay.getTime() + 24 * 60 * 60 * 1000;
    return tooManyRequests(
      "The public demo's daily budget is used up — come back tomorrow.",
      Math.max(1, Math.ceil((utcMidnight - now.getTime()) / 1000)),
    );
  }

  // The dashboard's filter state rides the LAST user turn — never the
  // system prompt, which must stay byte-stable for caching (ADR-0002).
  // The prefix is ~150 chars, injected after validation on purpose: the
  // wire-contract turn cap applies to what the CLIENT sends.
  let promptTurns = turns;
  if (viewContext) {
    const last = turns[turns.length - 1]!;
    promptTurns = [
      ...turns.slice(0, -1),
      { ...last, content: `${formatViewContext(viewContext)}\n\n${last.content}` },
    ];
  }

  const events = streamAnswer(
    { client: anthropicStreamingClient(new Anthropic()), db },
    promptTurns,
    // Client disconnect aborts the in-flight Anthropic request instead of
    // letting it stream (and bill) to completion.
    { signal: request.signal, maxTokens: CHAT_MAX_TOKENS },
  );

  return new Response(eventsToNdjsonStream(withTelemetryFlush(events)), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
