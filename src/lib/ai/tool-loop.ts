import type Anthropic from "@anthropic-ai/sdk";

import type { Database } from "../db/client";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  anthropicTools,
  executeToolUse,
  type ToolCallRecord,
} from "./shared";

// The hand-rolled non-streaming tool-use loop (ADR-002): question → Claude →
// tool calls → tool results → grounded answer. Used by the terminal harness
// and the Week 5 eval runner; the chat route uses stream-loop.ts.

export type { ToolCallRecord } from "./shared";

/** The narrow slice of the Anthropic client the loop needs — tests inject a
 * fake; production injects a real `new Anthropic()`. */
export interface ClaudeClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface AskDeps {
  client: ClaudeClient;
  db: Database;
}

export interface AskOptions {
  model?: string;
  maxTokens?: number;
  maxToolIterations?: number;
}

export interface AskResult {
  answer: string;
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: Anthropic.Message["stop_reason"];
  /** number of API round-trips made */
  iterations: number;
}

export async function askQuestion(
  deps: AskDeps,
  question: string,
  options: AskOptions = {},
): Promise<AskResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  const tools = anthropicTools();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCalls: ToolCallRecord[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  let response: Anthropic.Message | null = null;
  let iterations = 0;

  while (iterations < maxToolIterations) {
    iterations++;
    response = await deps.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    // Server-side pause: append the assistant turn as-is and let the API
    // resume where it left off.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason !== "tool_use") break;

    // Append the FULL assistant content (including thinking blocks — the API
    // requires them back verbatim on the next request).
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const executed = await executeToolUse(deps.db, block);
      toolCalls.push(executed.record);
      results.push(executed.resultBlock);
    }

    // All results for one assistant turn go back in ONE user message —
    // splitting them across messages breaks parallel tool use.
    messages.push({ role: "user", content: results });
  }

  const answer =
    response?.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? "";

  return {
    answer,
    toolCalls,
    usage,
    stopReason: response?.stop_reason ?? null,
    iterations,
  };
}
