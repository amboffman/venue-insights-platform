import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../mcp/tools";
import { buildGoldenCases } from "./golden";
import { buildReport, synthesizeMissingResults } from "./runner";
import { reportToMarkdown } from "./report";
import type { CaseResult } from "./types";

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
          facts: { score: 1, details: [] },
        },
        usage: { inputTokens: 100, outputTokens: 20 },
        durationMs: 1234,
        iterations: 2,
        stopReason: "end_turn",
      },
    ]);

    expect(report.summary.meanScores.toolSelection).toBe(1);
    expect(report.summary.meanScores.argumentCorrectness).toBe(0.5);
    expect(report.summary.meanScores.facts).toBe(1);
    // scorer that never ran contributes no mean at all
    expect(report.summary.meanScores.groundedness).toBeUndefined();

    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("| a | 1.00 | 0.50 | — | 1.00 | 2 | 1234 |");
    expect(markdown).toContain("from: wrong");
  });
});

describe("synthesizeMissingResults", () => {
  const caseA = { id: "a", question: "qa?", expectedTools: [], expectedFacts: [] };
  const caseB = { id: "b", question: "qb?", expectedTools: [], expectedFacts: [] };
  const resultA: CaseResult = {
    caseId: "a",
    question: "qa?",
    answer: "fine",
    toolCalls: [],
    scores: {},
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1,
    iterations: 1,
    stopReason: "end_turn",
  };

  it("synthesizes an error row for every case that never reported", () => {
    // A vitest timeout fails the case without rejecting runCase, so no row
    // is pushed — the diff is the only way the report keeps its denominator.
    const missing = synthesizeMissingResults([caseA, caseB], [resultA]);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.caseId).toBe("b");
    expect(missing[0]!.question).toBe("qb?");
    expect(missing[0]!.error).toContain("never completed");
    expect(missing[0]!.scores).toEqual({});
    expect(missing[0]!.stopReason).toBeNull();
  });

  it("synthesizes nothing when every case reported", () => {
    expect(synthesizeMissingResults([caseA], [resultA])).toHaveLength(0);
  });
});
