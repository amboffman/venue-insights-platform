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

    // Multiset matching: a case expecting the same tool twice (e.g. one
    // aggregate_metrics per brand) needs two distinct calls to satisfy it —
    // set membership would let one call count for both.
    const remainingCalls = new Map<string, number>();
    for (const call of transcript.toolCalls) {
      remainingCalls.set(call.name, (remainingCalls.get(call.name) ?? 0) + 1);
    }

    const details: string[] = [];
    let hit = 0;

    for (const expected of evalCase.expectedTools) {
      const available = remainingCalls.get(expected.name) ?? 0;
      if (available > 0) {
        hit++;
        remainingCalls.set(expected.name, available - 1);
      } else {
        details.push(`expected tool not called (enough times): ${expected.name}`);
      }
    }

    const expectedNames = new Set(evalCase.expectedTools.map((t) => t.name));
    const extras = [...new Set(transcript.toolCalls.map((c) => c.name))].filter(
      (name) => !expectedNames.has(name),
    );
    if (extras.length > 0) {
      details.push(`extra tools called (not penalized): ${extras.join(", ")}`);
    }

    return { score: hit / evalCase.expectedTools.length, details };
  },
};
