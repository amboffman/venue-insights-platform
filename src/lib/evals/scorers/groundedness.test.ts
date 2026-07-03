import { describe, expect, it } from "vitest";

import type { EvalCase } from "../types";
import { groundednessScorer } from "./groundedness";

// ═══════════════════════════════════════════════════════════════════════
//  AUTHOR: this is your Week 5 TDD guide. Change `describe.skip` to
//  `describe` and make these pass top-to-bottom — they're ordered from
//  fundamentals to edge cases. The full design brief (approach, hints,
//  pitfalls) is in LEARNING.md under "Week 5: your build".
// ═══════════════════════════════════════════════════════════════════════

const anyCase: EvalCase = {
  id: "fixture",
  question: "irrelevant to this scorer",
  expectedTools: [],
  expectedFacts: [],
};

function score(answer: string, outputs: unknown[]) {
  return groundednessScorer.score(anyCase, {
    answer,
    toolCalls: outputs.map((output, i) => ({
      name: `tool_${i}`,
      input: {},
      ok: true,
      output,
    })),
  });
}

describe("groundednessScorer (AUTHOR: unskip and implement)", () => {
  it("scores 1.0 when the answer makes no numeric claims", () => {
    const result = score("The portfolio is doing well overall.", [{ totalRevenueCents: 12345 }]);
    expect(result.score).toBe(1);
  });

  it("grounds a plain integer that appears in an output", () => {
    const result = score("There are 8 locations in Austin.", [
      [{ id: 1 }, { id: 2 }], // note: 8 is NOT here…
    ]);
    expect(result.score).toBe(0); // …so this claim is ungrounded
    expect(result.details.join(" ")).toContain("8");

    const grounded = score("There are 8 locations in Austin.", [{ matchCount: 8 }]);
    expect(grounded.score).toBe(1);
  });

  it("grounds a comma-separated number against a raw output value", () => {
    const result = score("They processed 28,296 transactions.", [{ totalTransactions: 28296 }]);
    expect(result.score).toBe(1);
  });

  it("converts dollars in the answer to cents before matching", () => {
    // Output is integer cents (ADR-001); answers speak dollars.
    const result = score("Revenue was $495,479.11 for the period.", [
      { totalRevenueCents: 49547911 },
    ]);
    expect(result.score).toBe(1);
  });

  it("matches rounded dollar amounts within tolerance", () => {
    // The model often rounds: $495,479 for 49547911 cents. Within 0.5%.
    const result = score("Revenue was about $495,479.", [{ totalRevenueCents: 49547911 }]);
    expect(result.score).toBe(1);
  });

  it("expands compact suffixes ($495.5K, $3.1M) before matching", () => {
    const result = score("Revenue came to $495.5K, roughly.", [{ totalRevenueCents: 49547911 }]);
    expect(result.score).toBe(1);

    const millions = score("Total revenue was $3.1M.", [{ totalRevenueCents: 314159265 }]);
    expect(millions.score).toBe(1);
  });

  it("flags a hallucinated number and names it in details", () => {
    const result = score("Revenue was $495,479.11 across 31,000 transactions.", [
      { totalRevenueCents: 49547911, totalTransactions: 28296 },
    ]);
    expect(result.score).toBe(0.5);
    expect(result.details.join(" ")).toContain("31,000");
  });

  it("finds grounding numbers nested anywhere in the output JSON", () => {
    const result = score("Its rating is 3.79 from 24 reviews.", [
      {
        location: {
          reviewStats: { avgRating: 3.79, reviewCount: 24 },
        },
      },
    ]);
    expect(result.score).toBe(1);
  });

  it("grounds numbers that live inside output strings (addresses, phones)", () => {
    const result = score("It's at 8332 Market St — call (713) 555-0131.", [
      { addressLine1: "8332 Market St", phone: "(713) 555-0131" },
    ]);
    expect(result.score).toBe(1);
  });

  it("does not treat dates and years as numeric claims", () => {
    // "2026", "01", "30" from a date range are not hallucination material —
    // without this exemption every answer that names its date range fails.
    const result = score("Between 2026-01-01 and 2026-06-30, revenue was $100.00.", [
      { totalRevenueCents: 10000 },
    ]);
    expect(result.score).toBe(1);
  });

  it("handles failed tool calls by scoring only against successful outputs", () => {
    const result = groundednessScorer.score(anyCase, {
      answer: "Revenue was $100.00.",
      toolCalls: [
        { name: "aggregate_metrics", input: {}, ok: false, error: "boom" },
        {
          name: "aggregate_metrics",
          input: {},
          ok: true,
          output: { totalRevenueCents: 10000 },
        },
      ],
    });
    expect(result.score).toBe(1);
  });
});
