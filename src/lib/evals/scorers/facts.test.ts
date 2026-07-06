import { describe, expect, it } from "vitest";

import type { EvalCase, ExpectedFact } from "../types";
import { factsScorer } from "./facts";

function makeCase(expectedFacts: ExpectedFact[]): EvalCase {
  return { id: "fixture", question: "q", expectedTools: [], expectedFacts };
}

// The scorer only reads the answer text — tool calls are groundedness'
// concern — so every fixture can pass an empty transcript side.
function score(answer: string, facts: ExpectedFact[]) {
  return factsScorer.score(makeCase(facts), { answer, toolCalls: [] });
}

describe("factsScorer", () => {
  it("is vacuous when the case has no expected facts", () => {
    const result = score("Anything at all — even 42 wrong numbers.", []);
    expect(result.score).toBe(1);
  });

  it("scores 1 when the answer states the expected number", () => {
    const result = score("There are 12 locations in Austin.", [
      { label: "Austin locations", value: 12, kind: "count" },
    ]);
    expect(result.score).toBe(1);
    expect(result.details).toHaveLength(0);
  });

  it("scores 0 and names the miss when the answer states a different number", () => {
    // The groundedness blind spot this scorer exists for: 14 could be a
    // perfectly grounded number and still be the answer to a different
    // question.
    const result = score("There are 14 locations in Austin.", [
      { label: "Austin locations", value: 12, kind: "count" },
    ]);
    expect(result.score).toBe(0);
    expect(result.details.join(" ")).toContain("Austin locations");
  });

  it("matches cents facts against dollar answers in any written format", () => {
    const fact: ExpectedFact = { label: "revenue", value: 49547911, kind: "cents" };
    expect(score("Revenue was $495,479.11.", [fact]).score).toBe(1);
    expect(score("Revenue was about $495,000.", [fact]).score).toBe(1);
    expect(score("Revenue came to roughly $495K.", [fact]).score).toBe(1);
  });

  it("matches spelled-out magnitudes", () => {
    const result = score("Total revenue was $3.5 million.", [
      { label: "revenue", value: 350000000, kind: "cents" },
    ]);
    expect(result.score).toBe(1);
  });

  it("holds ratings to their written precision", () => {
    const fact: ExpectedFact = { label: "rating", value: 4.21, kind: "rating" };
    expect(score("Its average rating is 4.21 stars.", [fact]).score).toBe(1);
    expect(score("Its average rating is 4.5 stars.", [fact]).score).toBe(0);
  });

  it("scores the matched fraction across several facts", () => {
    const result = score("Verde earned $100.00 while Bluebird earned $999.00.", [
      { label: "verde revenue", value: 10000, kind: "cents" },
      { label: "bluebird revenue", value: 20000, kind: "cents" },
    ]);
    expect(result.score).toBe(0.5);
    expect(result.details.join(" ")).toContain("bluebird revenue");
  });
});
