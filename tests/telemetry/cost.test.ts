import { describe, expect, it } from "vitest";

import { estimateCostMicroUsd } from "@/lib/telemetry/cost";

describe("estimateCostMicroUsd", () => {
  it("prices claude-sonnet-5 at 3µ$/15µ$ per token", () => {
    // 1000 in + 100 out → 1000×3 + 100×15 = 4500 µ$ (= $0.0045)
    expect(estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 1000, outputTokens: 100 })).toBe(
      4500,
    );
  });

  it("recovers the sticker price at exactly one megatoken", () => {
    // The unit identity the design leans on: $/MTok ≡ µ$/token, so 1MTok of
    // input must cost exactly $3 = 3,000,000 µ$.
    expect(
      estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(3_000_000);
    expect(
      estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBe(15_000_000);
  });

  it("returns zero for zero usage", () => {
    expect(estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("returns null for a model not in the table — never guesses", () => {
    expect(estimateCostMicroUsd("claude-opus-4-8", { inputTokens: 10, outputTokens: 10 })).toBe(
      null,
    );
  });
});
