import type { Scorer } from "../types";

// Did the agent call the tools the case expected? Score = fraction of
// expected tool names that were actually (successfully or not) called.
// Extra calls are noted but not penalized — re-checking data is legitimate
// agent behavior; missing a required tool is not.

export const toolSelectionScorer: Scorer = {
  name: "toolSelection",
  score(evalCase, transcript) {
    if (evalCase.expectedTools.length === 0) {
      return { score: 1, details: ["no tool expectations"] };
    }

    const calledNames = new Set(transcript.toolCalls.map((c) => c.name));
    const details: string[] = [];
    let hit = 0;

    for (const expected of evalCase.expectedTools) {
      if (calledNames.has(expected.name)) {
        hit++;
      } else {
        details.push(`expected tool not called: ${expected.name}`);
      }
    }

    const expectedNames = new Set(evalCase.expectedTools.map((t) => t.name));
    const extras = [...calledNames].filter((name) => !expectedNames.has(name));
    if (extras.length > 0) {
      details.push(`extra tools called (not penalized): ${extras.join(", ")}`);
    }

    return { score: hit / evalCase.expectedTools.length, details };
  },
};
