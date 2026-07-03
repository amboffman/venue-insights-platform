"use client";

import { useEffect, useRef, useState } from "react";

import { readNdjsonEvents } from "@/components/chat/read-ndjson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatTurn } from "@/lib/types/chat";

// Client half of the chat spine. The transcript lives here (ADR-0003: the
// server is stateless); each submit resends the visible text turns.

interface ToolActivity {
  name: string;
  /** null while running */
  ok: boolean | null;
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  activities: ToolActivity[];
  usage?: { inputTokens: number; outputTokens: number };
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

export function Chat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function updateAssistant(update: (message: DisplayMessage) => void) {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        const copy: DisplayMessage = {
          ...last,
          activities: [...last.activities],
        };
        update(copy);
        next[next.length - 1] = copy;
      }
      return next;
    });
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    // Prior text turns + the new question — this IS the conversation state.
    const turns: ChatTurn[] = [
      ...messages
        .filter((m) => m.content.length > 0 && !m.error)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: trimmed },
    ].slice(-20);

    setMessages((current) => [
      ...current,
      { role: "user", content: trimmed, activities: [] },
      { role: "assistant", content: "", activities: [] },
    ]);
    setInput("");
    setStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Request failed (${response.status})`);
      }

      for await (const event of readNdjsonEvents(response.body)) {
        switch (event.type) {
          case "text_delta":
            updateAssistant((m) => {
              m.content += event.text;
            });
            break;
          case "tool_start":
            updateAssistant((m) => {
              m.activities.push({ name: event.name, ok: null });
            });
            break;
          case "tool_result":
            updateAssistant((m) => {
              const running = m.activities.findLast((a) => a.name === event.name && a.ok === null);
              if (running) running.ok = event.ok;
            });
            break;
          case "done":
            updateAssistant((m) => {
              m.usage = event.usage;
            });
            break;
          case "error":
            updateAssistant((m) => {
              m.error = event.message;
            });
            break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAssistant((m) => {
        m.error = message;
      });
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
          <div
            key={index}
            className={cn(
              "mx-auto flex w-full max-w-2xl",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
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
              {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
              {message.role === "assistant" &&
                !message.content &&
                !message.error &&
                message.activities.length === 0 && (
                  <p className="animate-pulse text-muted-foreground">Thinking…</p>
                )}
              {message.error && (
                <p className="text-destructive">Something went wrong: {message.error}</p>
              )}
              {message.usage && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {message.usage.inputTokens.toLocaleString()} in /{" "}
                  {message.usage.outputTokens.toLocaleString()} out tokens
                </p>
              )}
            </div>
          </div>
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
