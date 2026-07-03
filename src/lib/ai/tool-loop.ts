import type Anthropic from "@anthropic-ai/sdk";

import type { Database } from "../db/client";
import { SEED_END_DATE, SEED_START_DATE } from "../db/seed-data";
import { getToolSpecs, runTool } from "../mcp/tools";

// The hand-rolled tool-use loop (ADR-002): question → Claude → tool calls →
// tool results → grounded answer. Non-streaming; the Week 3 streaming route
// builds on the same shape.

export const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 16000;
// Guard against a model that never stops calling tools; generous enough for
// legitimate multi-step questions (search → details → compare).
const DEFAULT_MAX_TOOL_ITERATIONS = 8;

// Fixed and deterministic — no clock, no per-request content — so eval runs
// are reproducible and the prompt prefix stays cacheable.
const SYSTEM_PROMPT =
  "You are a business-intelligence assistant for a multi-location franchise " +
  "portfolio (5 brands, 50 US locations). Answer questions using the " +
  "provided tools. Ground every number in tool results — never estimate or " +
  "invent values, and say so plainly when the data cannot answer the " +
  "question. Monetary values from tools are integer cents; present them in " +
  `dollars. Daily metrics cover ${SEED_START_DATE} through ${SEED_END_DATE}; ` +
  `treat ${SEED_END_DATE} as today when interpreting phrases like "last ` +
  'month". Keep answers concise and lead with the direct answer.';

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

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  error?: string;
}

export interface AskResult {
  answer: string;
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: Anthropic.Message["stop_reason"];
  /** number of API round-trips made */
  iterations: number;
}

function anthropicTools(): Anthropic.Tool[] {
  return getToolSpecs().map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema as Anthropic.Tool.InputSchema,
  }));
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
      const result = await runTool(deps.db, block.name, block.input);
      toolCalls.push({
        name: block.name,
        input: block.input,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
      // Failures go back to the model as is_error tool results so it can
      // retry with fixed arguments or explain the limitation (ADR-002).
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.ok ? JSON.stringify(result.output) : result.error,
        ...(result.ok ? {} : { is_error: true }),
      });
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
