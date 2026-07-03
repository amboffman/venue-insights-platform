import type Anthropic from "@anthropic-ai/sdk";

import type { Database } from "../db/client";
import type { ChatStreamEvent, ChatTurn } from "../types/chat";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  anthropicTools,
  executeToolUses,
} from "./shared";

// Streaming variant of the tool loop: same wire contract as tool-loop.ts
// (full assistant content appended back, one user message per round of tool
// results, is_error feedback, pause_turn resume, iteration cap), but text
// arrives as deltas and tool activity is surfaced as it happens. Consumed by
// the /api/chat route, which serializes the events as NDJSON (ADR-0003).

// pause_turn resumes don't consume the tool budget, but a pathological
// pause loop must still terminate.
const MAX_PAUSE_ROUNDS = 8;

/** One in-flight streaming API round: text deltas while the model talks,
 * then the complete message. Tests fake this; production wraps the SDK's
 * `client.messages.stream()` (see anthropicStreamingClient). */
export interface MessageStreamHandle {
  textDeltas: AsyncIterable<string>;
  finalMessage(): Promise<Anthropic.Message>;
}

export interface StreamRequestOptions {
  /** aborts the underlying HTTP request (client disconnected) */
  signal?: AbortSignal;
}

export interface StreamingClaudeClient {
  streamMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: StreamRequestOptions,
  ): MessageStreamHandle;
}

/** Adapts a real Anthropic client to the loop's narrow interface. */
export function anthropicStreamingClient(client: Anthropic): StreamingClaudeClient {
  return {
    streamMessage(params, options) {
      // Forwarding the signal lets a client disconnect abort the in-flight
      // API request instead of letting it stream (and bill) to completion.
      const stream = client.messages.stream(params, { signal: options?.signal });
      return {
        textDeltas: (async function* () {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              yield event.delta.text;
            }
          }
        })(),
        finalMessage: () => stream.finalMessage(),
      };
    },
  };
}

export interface StreamDeps {
  client: StreamingClaudeClient;
  db: Database;
}

export interface StreamOptions {
  model?: string;
  maxTokens?: number;
  maxToolIterations?: number;
  /** propagated to every API round; abort ends the loop */
  signal?: AbortSignal;
}

/** History is client-supplied text turns (ADR-0003): the server is
 * stateless, prior tool blocks are not replayed. */
function turnsToMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  return turns.map((turn) => ({ role: turn.role, content: turn.content }));
}

export async function* streamAnswer(
  deps: StreamDeps,
  turns: ChatTurn[],
  options: StreamOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  const tools = anthropicTools();
  const messages = turnsToMessages(turns);
  const usage = { inputTokens: 0, outputTokens: 0 };

  let response: Anthropic.Message | null = null;
  let iterations = 0;
  let pauseRounds = 0;

  try {
    while (iterations - pauseRounds < maxToolIterations && pauseRounds <= MAX_PAUSE_ROUNDS) {
      iterations++;
      const stream = deps.client.streamMessage(
        {
          model,
          max_tokens: maxTokens,
          system: SYSTEM_PROMPT,
          tools,
          messages,
        },
        { signal: options.signal },
      );

      for await (const text of stream.textDeltas) {
        yield { type: "text_delta", text };
      }
      response = await stream.finalMessage();
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      if (response.stop_reason === "pause_turn") {
        pauseRounds++;
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason !== "tool_use") break;

      // Executing tools we can never report back (budget exhausted) is
      // wasted DB work and misleading UI — stop before running them.
      if (iterations - pauseRounds >= maxToolIterations) break;

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      // Announce every call up front, execute them concurrently (read-only
      // queries), then report results in block order.
      for (const block of toolUseBlocks) {
        yield { type: "tool_start", name: block.name, input: block.input };
      }
      const executed = await executeToolUses(deps.db, toolUseBlocks);
      for (const { record } of executed) {
        yield {
          type: "tool_result",
          name: record.name,
          ok: record.ok,
          ...(record.ok ? { output: record.output } : { error: record.error }),
        };
      }

      messages.push({ role: "user", content: executed.map((e) => e.resultBlock) });
    }

    yield {
      type: "done",
      usage,
      stopReason: response?.stop_reason ?? null,
    };
  } catch (error) {
    // API failures (rate limit, network, overload) end the stream with a
    // clean event instead of a broken connection — the lib/ai boundary owns
    // these failure modes.
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", message };
  }
}
