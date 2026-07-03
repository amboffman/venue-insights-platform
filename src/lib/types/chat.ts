// The chat wire contract (ADR-0003). Produced by lib/ai's streaming loop,
// serialized as NDJSON by the /api/chat route, parsed back by the chat UI.
// Week 4's generative-UI registry renders `tool_result` events as components,
// so tool outputs travel as structured data, never as markup.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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
