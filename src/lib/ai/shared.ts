import type Anthropic from "@anthropic-ai/sdk";

import type { Database } from "../db/client";
import { SEED_END_DATE, SEED_START_DATE } from "../db/seed-data";
import { getToolSpecs, runTool } from "../mcp/tools";

// Constants and helpers shared by the non-streaming loop (tool-loop.ts) and
// the streaming loop (stream-loop.ts) so the two cannot drift apart.

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_MAX_TOKENS = 16000;
// Guard against a model that never stops calling tools; generous enough for
// legitimate multi-step questions (search → details → compare).
export const DEFAULT_MAX_TOOL_ITERATIONS = 8;

// Fixed and deterministic — no clock, no per-request content — so eval runs
// are reproducible and the prompt prefix stays cacheable.
export const SYSTEM_PROMPT =
  "You are a business-intelligence assistant for a multi-location franchise " +
  "portfolio (5 brands, 50 US locations). Answer questions using the " +
  "provided tools. Ground every number in tool results — never estimate or " +
  "invent values, and say so plainly when the data cannot answer the " +
  "question. Monetary values from tools are integer cents; present them in " +
  `dollars. Daily metrics cover ${SEED_START_DATE} through ${SEED_END_DATE}; ` +
  `treat ${SEED_END_DATE} as today when interpreting phrases like "last ` +
  'month". Keep answers concise and lead with the direct answer.';

// Memoized: the tool set is static, so the zod→JSON-Schema derivation runs
// once per process instead of once per request.
let cachedTools: Anthropic.Tool[] | undefined;

export function anthropicTools(): Anthropic.Tool[] {
  cachedTools ??= getToolSpecs().map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema as Anthropic.Tool.InputSchema,
  }));
  return cachedTools;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
  error?: string;
  /** typed domain output on success — the eval scorers ground answers in it */
  output?: unknown;
}

export interface ExecutedToolUse {
  /** single source of truth for the call, including output on success */
  record: ToolCallRecord;
  /** what goes back to the model — is_error on failure (ADR-002) */
  resultBlock: Anthropic.ToolResultBlockParam;
}

export async function executeToolUse(
  db: Database,
  block: Anthropic.ToolUseBlock,
): Promise<ExecutedToolUse> {
  const result = await runTool(db, block.name, block.input);
  return {
    record: {
      name: block.name,
      input: block.input,
      ok: result.ok,
      ...(result.ok ? { output: result.output } : { error: result.error }),
    },
    resultBlock: {
      type: "tool_result",
      tool_use_id: block.id,
      content: result.ok ? JSON.stringify(result.output) : result.error,
      ...(result.ok ? {} : { is_error: true }),
    },
  };
}

/** Execute all tool_use blocks of one assistant turn concurrently — they are
 * read-only queries, and Anthropic guidance is to run parallel calls in
 * parallel. Result order matches block order, so the single user message of
 * tool_results keeps its pairing. */
export function executeToolUses(
  db: Database,
  blocks: Anthropic.ToolUseBlock[],
): Promise<ExecutedToolUse[]> {
  return Promise.all(blocks.map((block) => executeToolUse(db, block)));
}
