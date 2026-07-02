import type { Scorer } from "../types";

// Did the agent pass the arguments the case pins? For each expected call
// that declares args, find the actual same-name call that satisfies the
// most keys (the model may legitimately call a tool more than once) and
// score the fraction of pinned keys matched. Keys the case doesn't pin are
// never compared — you can only score what the question determines.

// Key-order-independent serialization: {from, to} and {to, from} must
// compare equal, or object-valued args would produce false misses.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
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
