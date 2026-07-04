// The chat wire contract (ADR-0003). Produced by lib/ai's streaming loop,
// serialized as NDJSON by the /api/chat route, parsed back by the chat UI.
// Week 4's generative-UI registry renders `tool_result` events as components,
// so tool outputs travel as structured data, never as markup.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// The transcript limits are part of the wire contract: the client trims and
// truncates to these BEFORE sending, and the route validates with the SAME
// constants — one source of truth, so the two layers cannot drift apart.
export const MAX_CHAT_TURNS = 20;
export const MAX_TURN_CHARS = 8000;

// ── dashboard view context (ADR-0009) ────────────────────────────────────
// The dashboard's filter state travels WITH each chat request so the AI
// sees what the stakeholder sees. It rides the last user turn, not the
// system prompt — the system prompt must stay byte-stable for caching.

export interface DashboardViewContext {
  /** ISO dates (YYYY-MM-DD), inclusive */
  from: string;
  to: string;
  brandSlug: string | null;
  city: string | null;
}

/** Deterministic context line the route prefixes onto the last user turn.
 * Lives in the wire-contract module so client and route can never drift. */
export function formatViewContext(view: DashboardViewContext): string {
  const parts = [`dates ${view.from} to ${view.to}`];
  if (view.brandSlug) parts.push(`brand "${view.brandSlug}"`);
  if (view.city) parts.push(`city "${view.city}"`);
  return (
    `[Dashboard context: the user is looking at data filtered to ` +
    `${parts.join(", ")}. Answer for this view unless they ask otherwise.]`
  );
}

export type ChatStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | {
      type: "tool_result";
      name: string;
      ok: boolean;
      output?: unknown;
      error?: string;
    }
  | {
      type: "done";
      usage: { inputTokens: number; outputTokens: number };
      stopReason: string | null;
    }
  | { type: "error"; message: string };
