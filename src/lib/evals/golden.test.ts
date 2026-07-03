import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../mcp/tools";
import { buildGoldenCases } from "./golden";
import { buildReport } from "./runner";
import { reportToMarkdown } from "./report";

describe("golden dataset", () => {
  const cases = buildGoldenCases();

  it("has ~25 well-formed cases with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.question.length).toBeGreaterThan(10);
      expect(c.expectedTools.length).toBeGreaterThan(0);
    }
  });

  it("only expects tools that actually exist", () => {
    for (const c of cases) {
      for (const tool of c.expectedTools) {
        expect(TOOL_NAMES).toContain(tool.name);
      }
    }
  });

  it("is deterministic — two builds produce identical cases", () => {
    expect(JSON.stringify(buildGoldenCases())).toBe(JSON.stringify(cases));
  });

  it("derives facts with real values (no zeros from broken pickers)", () => {
    for (const c of cases) {
      for (const fact of c.expectedFacts) {
        expect(fact.value).toBeGreaterThan(0);
      }
    }
  });
});

describe("report", () => {
  it("renders means, per-case rows, and failure details", () => {
    const report = buildReport([
      {
        caseId: "a",
        question: "q?",
        answer: "ans",
        toolCalls: [],
        scores: {
          toolSelection: { score: 1, details: [] },
          argumentCorrectness: { score: 0.5, details: ["from: wrong"] },
          groundedness: { score: null, details: ["scorer error: todo"] },
        },
        usage: { inputTokens: 100, outputTokens: 20 },
        durationMs: 1234,
        iterations: 2,
        stopReason: "end_turn",
      },
    ]);

    expect(report.summary.meanScores.toolSelection).toBe(1);
    expect(report.summary.meanScores.argumentCorrectness).toBe(0.5);
    // scorer that never ran contributes no mean at all
    expect(report.summary.meanScores.groundedness).toBeUndefined();

    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("| a | 1.00 | 0.50 | — | 2 | 1234 |");
    expect(markdown).toContain("from: wrong");
  });
});
