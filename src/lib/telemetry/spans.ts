import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";

import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_MLIP_COST_MICROUSD,
  ATTR_MLIP_ITERATIONS,
  ATTR_MLIP_TOOL_OK,
} from "./attributes";
import { estimateCostMicroUsd, type TokenUsage } from "./cost";

// Domain-named span helpers for the two tool loops. Parent contexts are
// passed EXPLICITLY (as values) instead of through a global context
// manager: streamAnswer is an async generator, and AsyncLocalStorage-based
// propagation does not reliably survive yield boundaries (ADR-0006).
// Explicit passing is deterministic and shows exactly how propagation works.

// The API returns a proxy that binds to the real provider when (if) one is
// installed — safe to resolve at module load.
const tracer = trace.getTracer("mlip");

export interface TurnSpan {
  span: Span;
  /** hand this to child spans as their parent */
  ctx: Context;
}

/** Root span for one question/turn — the trace every other span hangs off. */
export function startTurnSpan(name: string, attributes?: Attributes): TurnSpan {
  const span = tracer.startSpan(name, { attributes });
  return { span, ctx: trace.setSpan(context.active(), span) };
}

export interface TurnOutcome extends TokenUsage {
  model: string;
  iterations: number;
}

/** Totals + cost on the way out. Status is left alone: UNSET is the normal
 * success state; markSpanError sets ERROR before this runs (in a finally). */
export function endTurnSpan(span: Span, outcome: TurnOutcome): void {
  span.setAttributes({
    [ATTR_MLIP_ITERATIONS]: outcome.iterations,
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: outcome.inputTokens,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: outcome.outputTokens,
  });
  const cost = estimateCostMicroUsd(outcome.model, outcome);
  if (cost !== null) span.setAttribute(ATTR_MLIP_COST_MICROUSD, cost);
  span.end();
}

/** One Claude API round-trip (GenAI semconv "chat" operation). */
export function startClaudeCallSpan(ctx: Context, model: string): Span {
  return tracer.startSpan(
    `chat ${model}`,
    {
      attributes: {
        [ATTR_GEN_AI_OPERATION_NAME]: "chat",
        [ATTR_GEN_AI_PROVIDER_NAME]: "anthropic",
        [ATTR_GEN_AI_REQUEST_MODEL]: model,
      },
    },
    ctx,
  );
}

export interface ClaudeCallOutcome extends TokenUsage {
  model: string;
  stopReason: string | null;
}

export function endClaudeCallSpan(span: Span, outcome: ClaudeCallOutcome): void {
  span.setAttributes({
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: outcome.inputTokens,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: outcome.outputTokens,
    ...(outcome.stopReason === null
      ? {}
      : { [ATTR_GEN_AI_RESPONSE_FINISH_REASONS]: [outcome.stopReason] }),
  });
  const cost = estimateCostMicroUsd(outcome.model, outcome);
  if (cost !== null) span.setAttribute(ATTR_MLIP_COST_MICROUSD, cost);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/** Mark ERROR without ending — for spans whose attributes are finalized
 * elsewhere (the turn span's totals land in a finally). */
export function markSpanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/** Record the failure and end — for spans cut short by a thrown error or an
 * abandoned stream. */
export function failSpan(span: Span, error: unknown): void {
  markSpanError(span, error);
  span.end();
}

/** Tool invocation (GenAI semconv "execute_tool" operation). */
export function startToolSpan(ctx: Context | undefined, toolName: string): Span {
  return tracer.startSpan(
    `execute_tool ${toolName}`,
    {
      attributes: {
        [ATTR_GEN_AI_OPERATION_NAME]: "execute_tool",
        [ATTR_GEN_AI_TOOL_NAME]: toolName,
      },
    },
    ctx,
  );
}

/** A failed tool run is a real outcome, not an exception — runTool never
 * throws (lib/mcp boundary rule); ERROR status here records the outcome
 * the model saw as is_error. */
export function endToolSpan(span: Span, outcome: { ok: boolean; error?: string }): void {
  span.setAttribute(ATTR_MLIP_TOOL_OK, outcome.ok);
  if (!outcome.ok) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.error });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}
