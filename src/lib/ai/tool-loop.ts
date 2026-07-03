import type Anthropic from "@anthropic-ai/sdk";
import type { Attributes } from "@opentelemetry/api";

import type { Database } from "../db/client";
import { SPAN_NAME_ASK } from "../telemetry/attributes";
import {
  endClaudeCallSpan,
  endTurnSpan,
  failSpan,
  markSpanError,
  startClaudeCallSpan,
  startTurnSpan,
} from "../telemetry/spans";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  anthropicTools,
  executeToolUses,
  type ToolCallRecord,
} from "./shared";

// pause_turn resumes don't consume the tool budget, but a pathological
// pause loop must still terminate.
const MAX_PAUSE_ROUNDS = 8;

function textOf(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

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
  /** extra attributes for the turn's root span — the eval runner passes
   * run/case ids here so the dashboard can group spans per eval run */
  telemetryAttributes?: Attributes;
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
  let pauseRounds = 0;
  // Text emitted before a pause_turn — resumed responses contain only the
  // continuation, so this must be prepended to the final answer.
  let pausedText = "";

  // Root span for the whole turn; API rounds and tool runs hang off `ctx`
  // explicitly (ADR-0006). All of this is a no-op unless initTelemetry ran.
  const { span: turnSpan, ctx } = startTurnSpan(SPAN_NAME_ASK, options.telemetryAttributes);

  try {
    while (iterations - pauseRounds < maxToolIterations && pauseRounds <= MAX_PAUSE_ROUNDS) {
      iterations++;
      const callSpan = startClaudeCallSpan(ctx, model);
      try {
        response = await deps.client.messages.create({
          model,
          max_tokens: maxTokens,
          system: SYSTEM_PROMPT,
          tools,
          messages,
        });
      } catch (error) {
        failSpan(callSpan, error);
        throw error;
      }
      endClaudeCallSpan(callSpan, {
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      });
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      // Server-side pause: append the assistant turn as-is and let the API
      // resume where it left off.
      if (response.stop_reason === "pause_turn") {
        pauseRounds++;
        const text = textOf(response.content);
        if (text) pausedText += text + "\n";
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason !== "tool_use") break;

      // Executing tools we can never report back (budget exhausted) is wasted
      // DB work and misleading UI — stop before running them.
      if (iterations - pauseRounds >= maxToolIterations) break;

      // Append the FULL assistant content (including thinking blocks — the API
      // requires them back verbatim on the next request).
      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      const executed = await executeToolUses(deps.db, toolUseBlocks, ctx);
      toolCalls.push(...executed.map((e) => e.record));

      // All results for one assistant turn go back in ONE user message —
      // splitting them across messages breaks parallel tool use.
      messages.push({ role: "user", content: executed.map((e) => e.resultBlock) });
    }

    const answer = pausedText + (response ? textOf(response.content) : "");

    return {
      answer,
      toolCalls,
      usage,
      stopReason: response?.stop_reason ?? null,
      iterations,
    };
  } catch (error) {
    markSpanError(turnSpan, error);
    throw error;
  } finally {
    // Totals land even on the error path; end() is here so no return/throw
    // can leak an open span.
    endTurnSpan(turnSpan, { model, ...usage, iterations });
  }
}
