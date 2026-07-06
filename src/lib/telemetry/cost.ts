// Cost estimation in integer microdollars (µ$, 1e-6 USD). The unit is
// chosen because $/MTok ≡ µ$/token — the sticker price per megatoken IS the
// integer per-token rate — so estimates are pure integer arithmetic, same
// no-floats money discipline as ADR-001.
//
// Prices are the current sticker rates (verified against live docs
// 2026-07-03, not memory). claude-sonnet-5 has an intro price ($2/$10)
// that expires 2026-08-31 — the day before the demo — so the durable
// sticker rate is used.

interface ModelPricing {
  /** µ$ per input token (numerically equal to USD per MTok) */
  inputMicroUsdPerToken: number;
  /** µ$ per output token */
  outputMicroUsdPerToken: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5": { inputMicroUsdPerToken: 3, outputMicroUsdPerToken: 15 },
};

// Prompt-cache multipliers are uniform across models (Anthropic docs,
// verified 2026-07-06): writes bill at 1.25× the input rate, reads at 0.1×.
// Kept as integer ratios so the arithmetic stays exact until the single
// rounding step at the end.
const CACHE_WRITE_NUM = 5; // 1.25× == 5/4
const CACHE_WRITE_DEN = 4;
const CACHE_READ_NUM = 1; // 0.1× == 1/10
const CACHE_READ_DEN = 10;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** tokens written to the prompt cache this call (billed at 1.25× input) */
  cacheCreationInputTokens?: number;
  /** tokens served from the prompt cache this call (billed at 0.1× input) */
  cacheReadInputTokens?: number;
}

/** Integer microdollars, or null when the model is not in the table — a
 * missing estimate is honest; a guessed one poisons the dashboard.
 * input_tokens excludes cached tokens, so the cache terms are additive,
 * not double-counted. */
export function estimateCostMicroUsd(model: string, usage: TokenUsage): number | null {
  const pricing = PRICING[model];
  if (!pricing) return null;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  return Math.round(
    usage.inputTokens * pricing.inputMicroUsdPerToken +
      usage.outputTokens * pricing.outputMicroUsdPerToken +
      (cacheWrite * pricing.inputMicroUsdPerToken * CACHE_WRITE_NUM) / CACHE_WRITE_DEN +
      (cacheRead * pricing.inputMicroUsdPerToken * CACHE_READ_NUM) / CACHE_READ_DEN,
  );
}
