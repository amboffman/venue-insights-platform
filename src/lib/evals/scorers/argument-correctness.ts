import type { Scorer } from "../types";

// Did the agent pass the arguments the case pins? For each expected call
// that declares args, find the actual same-name call that satisfies the
// most keys (the model may legitimately call a tool more than once) and
// score the fraction of pinned keys matched. Keys the case doesn't pin are
// never compared — you can only score what the question determines.

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const argumentCorrectnessScorer: Scorer = {
  name: "argumentCorrectness",
  score(evalCase, transcript) {
    const withArgs = evalCase.expectedTools.filter((t) => t.args && Object.keys(t.args).length > 0);
    if (withArgs.length === 0) {
      return { score: 1, details: ["no argument expectations"] };
    }

    const details: string[] = [];
    let matchedKeys = 0;
    let totalKeys = 0;

    for (const expected of withArgs) {
      const keys = Object.entries(expected.args!);
      totalKeys += keys.length;

      const candidates = transcript.toolCalls.filter((c) => c.name === expected.name);
      if (candidates.length === 0) {
        details.push(`${expected.name}: never called, all args missed`);
        continue;
      }

      // Best-matching candidate wins; greedy per expectation is enough at
      // this scale (a case pins at most a handful of calls).
      let best = 0;
      let bestMisses: string[] = [];
      for (const candidate of candidates) {
        const input = (candidate.input ?? {}) as Record<string, unknown>;
        const misses: string[] = [];
        let hits = 0;
        for (const [key, value] of keys) {
          if (deepEqual(input[key], value)) {
            hits++;
          } else {
            misses.push(
              `${expected.name}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(input[key])}`,
            );
          }
        }
        if (hits >= best) {
          best = hits;
          bestMisses = misses;
        }
      }
      matchedKeys += best;
      details.push(...bestMisses);
    }

    return { score: totalKeys === 0 ? 1 : matchedKeys / totalKeys, details };
  },
};
