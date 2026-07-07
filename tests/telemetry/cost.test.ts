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

  it("prices cache writes at 1.25x and cache reads at 0.1x the input rate", () => {
    // 1000 written → 1000 × 3 × 5/4 = 3750 µ$; 1000 read → 1000 × 3 / 10 = 300 µ$
    expect(
      estimateCostMicroUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 1000,
      }),
    ).toBe(3750);
    expect(
      estimateCostMicroUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1000,
      }),
    ).toBe(300);
  });

  it("rounds fractional cache costs to whole microdollars", () => {
    // 1 read token → 0.3 µ$ → rounds to 0; 2 write tokens → 7.5 µ$ → rounds to 8
    expect(
      estimateCostMicroUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1,
      }),
    ).toBe(0);
    expect(
      estimateCostMicroUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 2,
      }),
    ).toBe(8);
  });

  it("treats absent cache counts as zero (pre-caching spans keep their cost)", () => {
    expect(estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 1000, outputTokens: 100 })).toBe(
      4500,
    );
  });
});
