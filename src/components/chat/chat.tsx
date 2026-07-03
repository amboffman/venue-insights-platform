"use client";

import { memo, useEffect, useRef, useState } from "react";

import { readNdjsonEvents } from "@/components/chat/read-ndjson";
import { formatCountExact } from "@/components/chat/tool-views/format";
import { renderToolResult } from "@/components/chat/tool-views/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_CHAT_TURNS, MAX_TURN_CHARS, type ChatTurn } from "@/lib/types/chat";

// Client half of the chat spine. The transcript lives here (ADR-0003: the
// server is stateless); each submit resends the visible text turns.

interface ToolActivity {
  name: string;
  /** null while running */
  ok: boolean | null;
  /** successful tool output — rendered through the tool-view registry */
  output?: unknown;
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  activities: ToolActivity[];
  usage?: { inputTokens: number; outputTokens: number };
  /** why the model stopped — anything but end_turn gets a truncation note */
  stopReason?: string | null;
  error?: string;
}

const TOOL_LABELS: Record<string, string> = {
  search_locations: "Searching locations",
  get_location_details: "Fetching location details",
  aggregate_metrics: "Aggregating metrics",
  compare_locations: "Comparing locations",
};

const SUGGESTIONS = [
  "Which Austin location has the highest revenue this year?",
  "Compare the top Copper Kettle Coffee locations by revenue.",
  "How is Verde Taqueria doing overall — revenue and customer ratings?",
];

/** Build the resend history: text turns only, capped, hard-truncated to the
 * wire contract, and guaranteed to start with a user turn (the API rejects
 * assistant-first histories). */
function buildTurns(messages: DisplayMessage[], question: string): ChatTurn[] {
  const turns: ChatTurn[] = [
    ...messages
      .filter((m) => m.content.length > 0 && !m.error)
      .map((m) => ({
        role: m.role,
        content: m.content.length > MAX_TURN_CHARS ? m.content.slice(0, MAX_TURN_CHARS) : m.content,
      })),
    { role: "user" as const, content: question },
  ].slice(-MAX_CHAT_TURNS);

  while (turns.length > 0 && turns[0]!.role !== "user") {
    turns.shift();
  }
  return turns;
}

function ActivityChip({ activity }: { activity: ToolActivity }) {
  const label = TOOL_LABELS[activity.name] ?? activity.name;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
        activity.ok === null && "border-border text-muted-foreground",
        activity.ok === true && "border-border text-foreground",
        activity.ok === false && "border-destructive/40 text-destructive",
      )}
    >
      {activity.ok === null && (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {activity.ok === true && <span aria-hidden>✓</span>}
      {activity.ok === false && <span aria-hidden>✗</span>}
      {label}
      {activity.ok === null ? "…" : ""}
    </span>
  );
}

// Memoized: updateAssistant replaces only the last message object, so every
// earlier row keeps its identity and skips re-rendering (and re-running
// renderToolResult) on each streamed delta or keystroke.
const MessageRow = memo(function MessageRow({ message }: { message: DisplayMessage }) {
  // Successful tool outputs render through the deterministic registry
  // (ADR-0004); tools without a view keep only their chip.
  const views = message.activities
    .filter((a) => a.ok === true && a.output !== undefined)
    .map((a, i) => ({ key: `${a.name}-${i}`, node: renderToolResult(a.name, a.output) }))
    .filter((view) => view.node !== null);

  const truncated =
    message.role === "assistant" && message.stopReason != null && message.stopReason !== "end_turn";

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-2xl",
        message.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm",
          views.length > 0 ? "w-full" : "max-w-[85%]",
          message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {message.activities.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.activities.map((activity, i) => (
              <ActivityChip key={i} activity={activity} />
            ))}
          </div>
        )}
        {views.length > 0 && (
          <div className="mb-2 space-y-2">
            {views.map((view) => (
              <div key={view.key}>{view.node}</div>
            ))}
          </div>
        )}
        {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
        {message.role === "assistant" &&
          !message.content &&
          !message.error &&
          message.activities.length === 0 && (
            <p className="animate-pulse text-muted-foreground">Thinking…</p>
          )}
        {message.error && <p className="text-destructive">Something went wrong: {message.error}</p>}
        {truncated && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            ⚠ The answer stopped early ({message.stopReason}) and may be incomplete.
          </p>
        )}
        {message.usage && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {formatCountExact(message.usage.inputTokens)} in /{" "}
            {formatCountExact(message.usage.outputTokens)} out tokens
          </p>
        )}
      </div>
    </div>
  );
});

export function Chat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Replaces the last (assistant) message with a NEW object — never mutate:
  // updater functions must be pure, and prior state snapshots share the
  // activity objects.
  function updateAssistant(update: (message: DisplayMessage) => DisplayMessage) {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role !== "assistant") return current;
      return [...current.slice(0, -1), update(last)];
    });
  }

  function resolveActivity(
    message: DisplayMessage,
    name: string,
    ok: boolean,
    output?: unknown,
  ): DisplayMessage {
    const index = message.activities.findLastIndex((a) => a.name === name && a.ok === null);
    if (index < 0) return message;
    const activities = message.activities.map((activity, i) =>
      i === index ? { ...activity, ok, ...(ok ? { output } : {}) } : activity,
    );
    return { ...message, activities };
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    const turns = buildTurns(messages, trimmed);

    setMessages((current) => [
      ...current,
      { role: "user", content: trimmed, activities: [] },
      { role: "assistant", content: "", activities: [] },
    ]);
    setInput("");
    setStreaming(true);

    // A stream that ends without done/error was severed (network drop,
    // serverless timeout) — flag it instead of presenting a silent half answer.
    let sawTerminalEvent = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!response.ok || !response.body) {
        const detail = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => undefined);
        throw new Error(detail || `Request failed (${response.status})`);
      }

      for await (const event of readNdjsonEvents(response.body)) {
        switch (event.type) {
          case "text_delta":
            updateAssistant((m) => ({ ...m, content: m.content + event.text }));
            break;
          case "tool_start":
            updateAssistant((m) => ({
              ...m,
              activities: [...m.activities, { name: event.name, ok: null }],
            }));
            break;
          case "tool_result":
            updateAssistant((m) => resolveActivity(m, event.name, event.ok, event.output));
            break;
          case "done":
            sawTerminalEvent = true;
            updateAssistant((m) => ({
              ...m,
              usage: event.usage,
              stopReason: event.stopReason,
            }));
            break;
          case "error":
            sawTerminalEvent = true;
            updateAssistant((m) => ({ ...m, error: event.message }));
            break;
        }
      }

      if (!sawTerminalEvent) {
        updateAssistant((m) => ({
          ...m,
          error: "the connection ended before the answer finished",
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAssistant((m) => ({ ...m, error: message }));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-lg flex-col gap-3 pt-16 text-center">
            <p className="text-sm text-muted-foreground">
              Ask anything about the portfolio — revenue, foot traffic, reviews, comparisons.
              Answers are grounded in live tool calls against the database.
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  className="h-auto justify-start whitespace-normal py-2 text-left"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageRow key={index} message={message} />
        ))}
      </div>

      <form
        className="border-t bg-background px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="mx-auto flex w-full max-w-2xl gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='e.g. "Compare downtown locations by revenue"'
            disabled={streaming}
            maxLength={MAX_TURN_CHARS}
            aria-label="Ask a question"
            autoFocus
          />
          <Button type="submit" disabled={streaming || !input.trim()}>
            {streaming ? "Answering…" : "Ask"}
          </Button>
        </div>
      </form>
    </div>
  );
}
