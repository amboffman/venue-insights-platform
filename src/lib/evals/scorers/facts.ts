import type { Scorer } from "../types";
import { claimMatchesValue, extractClaims } from "./groundedness";

// Groundedness answers "did every number come FROM the tools?" — this
// scorer answers the complement: "did the RIGHT numbers make it INTO the
// answer?" A confidently wrong answer built from plausible tool-derived
// numbers scores perfect groundedness; only checking the case's expected
// facts catches it. Score = matched facts / total facts; a case with no
// expectedFacts scores 1.0 — absence of facts is not a failure.
//
// Matching reuses groundedness' tokenizer and written-precision tolerance
// (one rule for "does this number appear?", so the two scorers can never
// drift): the answer satisfies a fact when any of its numeric claims covers
// the fact's value. "$3.5 million", "$495K", and "495,000" all carry the
// tolerance their spelling implies.

export const factsScorer: Scorer = {
  name: "facts",
  score(evalCase, transcript) {
    if (evalCase.expectedFacts.length === 0) {
      return { score: 1, details: ["no expected facts"] };
    }

    const claims = extractClaims(transcript.answer);
    const details: string[] = [];
    let hits = 0;

    for (const fact of evalCase.expectedFacts) {
      // Cents facts are also offered in dollars — outputs store integer
      // cents (ADR-001) but answers speak dollars. The mirror image of
      // groundedness offering every tool-output number at ÷100.
      const targets = fact.kind === "cents" ? [fact.value, fact.value / 100] : [fact.value];
      if (claims.some((claim) => targets.some((target) => claimMatchesValue(claim, target)))) {
        hits++;
      } else {
        details.push(`expected fact missing from answer: ${fact.label} = ${fact.value}`);
      }
    }

    return { score: hits / evalCase.expectedFacts.length, details };
  },
};
