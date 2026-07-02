import { describe, expect, it } from "vitest";

import type { EvalCase } from "../types";
import { argumentCorrectnessScorer } from "./argument-correctness";
import { toolSelectionScorer } from "./tool-selection";

function makeCase(expectedTools: EvalCase["expectedTools"]): EvalCase {
  return { id: "fixture", question: "q", expectedTools, expectedFacts: [] };
}

const call = (name: string, input: Record<string, unknown> = {}) => ({
  name,
  input,
  ok: true,
});

describe("toolSelectionScorer", () => {
  it("scores the fraction of expected tools that were called", () => {
    const result = toolSelectionScorer.score(
      makeCase([{ name: "search_locations" }, { name: "compare_locations" }]),
      { answer: "", toolCalls: [call("search_locations")] },
    );
    expect(result.score).toBe(0.5);
    expect(result.details.join(" ")).toContain("compare_locations");
  });

  it("notes extra calls without penalizing them", () => {
    const result = toolSelectionScorer.score(makeCase([{ name: "search_locations" }]), {
      answer: "",
      toolCalls: [call("search_locations"), call("get_location_details")],
    });
    expect(result.score).toBe(1);
    expect(result.details.join(" ")).toContain("get_location_details");
  });

  it("is vacuous when the case expects nothing", () => {
    expect(toolSelectionScorer.score(makeCase([]), { answer: "", toolCalls: [] }).score).toBe(1);
  });
});

describe("argumentCorrectnessScorer", () => {
  it("scores matched pinned keys and names each miss", () => {
    const result = argumentCorrectnessScorer.score(
      makeCase([
        {
          name: "aggregate_metrics",
          args: { from: "2026-01-01", to: "2026-06-30" },
        },
      ]),
      {
        answer: "",
        toolCalls: [call("aggregate_metrics", { from: "2026-01-01", to: "2026-07-02" })],
      },
    );
    expect(result.score).toBe(0.5);
    expect(result.details.join(" ")).toContain("2026-07-02");
  });

  it("picks the best-matching call when a tool ran more than once", () => {
    const result = argumentCorrectnessScorer.score(
      makeCase([{ name: "aggregate_metrics", args: { brandSlug: "verde-taqueria" } }]),
      {
        answer: "",
        toolCalls: [
          call("aggregate_metrics", { brandSlug: "bluebird-bakery" }),
          call("aggregate_metrics", { brandSlug: "verde-taqueria" }),
        ],
      },
    );
    expect(result.score).toBe(1);
  });

  it("matches multiple expectations of the same tool independently", () => {
    const result = argumentCorrectnessScorer.score(
      makeCase([
        { name: "aggregate_metrics", args: { brandSlug: "a" } },
        { name: "aggregate_metrics", args: { brandSlug: "b" } },
      ]),
      {
        answer: "",
        toolCalls: [
          call("aggregate_metrics", { brandSlug: "a" }),
          call("aggregate_metrics", { brandSlug: "b" }),
        ],
      },
    );
    expect(result.score).toBe(1);
  });

  it("scores zero keys when the expected tool was never called", () => {
    const result = argumentCorrectnessScorer.score(
      makeCase([{ name: "compare_locations", args: { from: "x", to: "y" } }]),
      { answer: "", toolCalls: [call("search_locations")] },
    );
    expect(result.score).toBe(0);
    expect(result.details.join(" ")).toContain("never called");
  });

  it("is vacuous when no expectation pins args", () => {
    expect(
      argumentCorrectnessScorer.score(makeCase([{ name: "search_locations" }]), {
        answer: "",
        toolCalls: [],
      }).score,
    ).toBe(1);
  });
});
