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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Integer microdollars, or null when the model is not in the table — a
 * missing estimate is honest; a guessed one poisons the dashboard. */
export function estimateCostMicroUsd(model: string, usage: TokenUsage): number | null {
  const pricing = PRICING[model];
  if (!pricing) return null;
  return (
    usage.inputTokens * pricing.inputMicroUsdPerToken +
    usage.outputTokens * pricing.outputMicroUsdPerToken
  );
}
