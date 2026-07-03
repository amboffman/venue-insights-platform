import type { Scorer } from "../types";

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  AUTHOR-OWNED SCORER (Week 5 slice — see LEARNING.md, "Week 5: your   ║
// ║  build" for the full design brief, hints, and acceptance criteria).   ║
// ║                                                                        ║
// ║  Contract: every numeric claim in the answer must be traceable to     ║
// ║  the tool outputs of the same run. Score = grounded / total claims;   ║
// ║  1.0 when the answer makes no numeric claims. List each ungrounded    ║
// ║  number in details — that's the hallucination report.                 ║
// ║                                                                        ║
// ║  Start by unskipping the tests in groundedness.test.ts and making     ║
// ║  them pass one by one.                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const groundednessScorer: Scorer = {
  name: "groundedness",
  score(_evalCase, _transcript) {
    throw new Error(
      "groundedness scorer not implemented yet — author-owned (see LEARNING.md Week 5 brief)",
    );
  },
};
