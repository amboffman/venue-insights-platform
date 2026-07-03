import type { AgentTranscript, Scorer } from "../types";

// Every numeric claim in the answer must be traceable to the tool outputs
// of the same run. Score = grounded claims / total claims; an answer with
// no numeric claims scores 1.0. Each ungrounded number lands in details
// with its text as written — that's the hallucination report.
//
// Originally the author-owned Week 5 slice; handed back to Claude on
// 2026-07-03 after the author built the extract/match core through the
// money tests. Design notes and drill live in LEARNING.md ("Slice 5").

// ── claim extraction (the answer side) ──────────────────────────────────

// ISO dates and bare years are not numeric claims: an answer that names its
// date range ("between 2026-01-01 and 2026-06-30") is quoting the question's
// time window, not asserting a fact about the data. Without this exemption
// every answer that mentions its date range would fail.
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const BARE_YEAR = /^(?:19|20)\d{2}$/;

// One number-like token: optional $, comma-grouped or plain digits, optional
// decimals, optional compact suffix glued to the number ($495.5K, $3.1M).
// The comma branch requires at least one ",ddd" group — with `*` instead of
// `+` it would match bare integers too, and since alternation is
// first-match-wins (not longest-match), it would shatter 28296 into 282 + 96.
const CLAIM_TOKEN = /\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[kKmM]?/g;

// Re-parse of a single token into its parts. Deliberately no sign: the
// domain has no negative values (cents, counts, ratings), and treating "-"
// as a minus would corrupt phone numbers ("555-0131") into negative claims.
const CLAIM_PARTS = /^(\$?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([kKmM])?$/;

const SUFFIX_MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6 };

interface NumericClaim {
  /** as written in the answer — what the report shows on a miss */
  text: string;
  value: number;
  /** Half the place value of the last written digit (suffix included): the
   * rounding step that produced the text. "$3.1M" earns ±50,000 — one
   * decimal of millions is a coarse statement; "28,296" earns ±0.5. A flat
   * percentage can't serve both: 0.5% rejects legitimately compact numbers
   * ($3.1M vs $3,141,592.65 is 1.3% off), and anything loose enough for
   * them would wave real hallucinations through on exact numbers. */
  tolerance: number;
}

function parseClaim(token: string): NumericClaim | null {
  const parts = CLAIM_PARTS.exec(token);
  if (!parts) return null;
  const [, dollar = "", digits = "", decimals, suffix] = parts;

  // Bare 4-digit years are date furniture, not claims about the data.
  if (!dollar && !suffix && decimals === undefined && BARE_YEAR.test(digits)) {
    return null;
  }

  const multiplier = suffix ? (SUFFIX_MULTIPLIER[suffix.toUpperCase()] ?? 1) : 1;
  const value =
    Number(`${digits.replace(/,/g, "")}${decimals === undefined ? "" : `.${decimals}`}`) *
    multiplier;
  return {
    text: token,
    value,
    tolerance: (multiplier * 10 ** -(decimals?.length ?? 0)) / 2,
  };
}

// Every occurrence is its own claim: an answer that repeats a hallucinated
// number asserted it twice, and repeats of grounded numbers cost nothing.
function extractClaims(answer: string): NumericClaim[] {
  const withoutDates = answer.replace(ISO_DATE, " ");
  const tokens = withoutDates.match(CLAIM_TOKEN) ?? [];
  return tokens.map(parseClaim).filter((claim): claim is NumericClaim => claim !== null);
}

// ── the grounded set (the tool-output side) ─────────────────────────────

// JSON.stringify flattens each successful output — nesting, strings,
// everything — into one string, so numbers inside addresses and phone
// strings ground for free. JSON numbers never carry commas, "$", or
// suffixes, so a bare numeric token is enough here.
//
// Every value is also offered at ÷100: outputs store integer cents
// (ADR-001) while answers speak dollars, and the scorer can't know which
// fields are money. Offering both interpretations for every number is
// deliberately generous — the cost is a false grounding at exactly 100×,
// which the eval report would surface as a suspiciously perfect score, not
// a hidden miss.
function collectGroundedValues(toolCalls: AgentTranscript["toolCalls"]): number[] {
  const values: number[] = [];
  for (const call of toolCalls) {
    if (!call.ok) continue; // failed calls returned no data to ground against
    const json = JSON.stringify(call.output);
    if (typeof json !== "string") continue; // ok call with undefined output
    for (const token of json.match(/\d+(?:\.\d+)?/g) ?? []) {
      const value = Number(token);
      values.push(value, value / 100);
    }
  }
  return values;
}

// ── the scorer ──────────────────────────────────────────────────────────

export const groundednessScorer: Scorer = {
  name: "groundedness",
  score(_evalCase, transcript) {
    const claims = extractClaims(transcript.answer);
    if (claims.length === 0) {
      return { score: 1, details: ["no numeric claims in answer"] };
    }

    const grounded = collectGroundedValues(transcript.toolCalls);
    const details: string[] = [];
    let hits = 0;

    for (const claim of claims) {
      if (grounded.some((value) => Math.abs(claim.value - value) <= claim.tolerance)) {
        hits++;
      } else {
        details.push(`ungrounded number in answer: "${claim.text}"`);
      }
    }

    return { score: hits / claims.length, details };
  },
};
