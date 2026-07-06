import type Anthropic from "@anthropic-ai/sdk";
import type { Context } from "@opentelemetry/api";

import type { Database } from "../db/client";
import { SEED_END_DATE, SEED_START_DATE } from "../db/seed-data";
import { getToolSpecs, runTool } from "../mcp/tools";
import { endToolSpan, startToolSpan } from "../telemetry/spans";

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

// ── prompt caching (ADR-0010) ────────────────────────────────────────────
// The byte-stable prefix was always DESIGNED to be cacheable (ADR-0002),
// but Anthropic caching is opt-in: without explicit cache_control markers
// every round re-billed the full prefix + history at the full input rate.
// Two breakpoints (max 4 allowed):
//   1. the system block — the prompt renders tools → system → messages, so
//      this one marker caches the tool schemas AND the system prompt;
//   2. the last content block of the last message — so round N+1 of a tool
//      turn re-reads round N's entire history at ~0.1× instead of 1×.

const EPHEMERAL_CACHE = { type: "ephemeral" as const };

/** The system prompt as a cache-marked content block array. */
export function systemBlocks(): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: SYSTEM_PROMPT, cache_control: EPHEMERAL_CACHE }];
}

// Block types that accept a cache_control marker. Thinking/redacted-thinking
// blocks do not — they never appear in our payloads (no thinking param, only
// custom client-side tools), but the guard keeps this total instead of
// trusting that invariant forever.
const CACHEABLE_BLOCK_TYPES = new Set(["text", "image", "tool_use", "tool_result", "document"]);

/** Non-mutating: returns the request's message array with the moving cache
 * breakpoint on the final content block. Only the returned copies carry the
 * marker — the loop's own messages array stays clean, so breakpoints never
 * accumulate across rounds (the API allows at most 4 per request). */
export function messagesWithCacheBreakpoint(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : [...last.content];
  const finalBlock = blocks[blocks.length - 1];
  if (!finalBlock || !CACHEABLE_BLOCK_TYPES.has(finalBlock.type)) return messages;
  // Cast: the runtime guard above establishes what the type system can't —
  // spread over the full ContentBlockParam union trips on the thinking
  // variants, which are excluded by the Set check.
  blocks[blocks.length - 1] = {
    ...finalBlock,
    cache_control: EPHEMERAL_CACHE,
  } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { role: last.role, content: blocks }];
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
  telemetryCtx?: Context,
): Promise<ExecutedToolUse> {
  // No try/catch: runTool never throws (lib/mcp boundary rule) — a failure
  // is a value, and the span records it as the outcome.
  const span = startToolSpan(telemetryCtx, block.name);
  const result = await runTool(db, block.name, block.input);
  endToolSpan(span, result.ok ? { ok: true } : { ok: false, error: result.error });
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
  telemetryCtx?: Context,
): Promise<ExecutedToolUse[]> {
  return Promise.all(blocks.map((block) => executeToolUse(db, block, telemetryCtx)));
}
