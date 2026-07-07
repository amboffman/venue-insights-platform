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

// Prose dates need the same exemption: "June 30, 2026" or "06/30/2026"
// would otherwise leak "30" (and a slash date's "1") as small-integer
// claims that nothing in the tool outputs happens to ground. Month-name
// dates take an optional ordinal day and optional year; slash dates take an
// optional 2–4 digit year. The lookbehind on the slash shape keeps
// "4.2/5"-style ratios intact — a digit after a decimal point is a
// fraction, not a month.
const MONTH_NAME_DATE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
const SLASH_DATE = /(?<![.\d])\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;

// One number-like token: optional $, comma-grouped or plain digits, optional
// decimals, optional magnitude suffix — compact and glued ($495.5K, $3.1M)
// or spelled out with an optional space ("$3.5 million"). The comma branch
// requires at least one ",ddd" group — with `*` instead of `+` it would
// match bare integers too, and since alternation is first-match-wins (not
// longest-match), it would shatter 28296 into 282 + 96. The \b after the
// word suffix stops "3 millionaire" from eating "million".
const CLAIM_TOKEN =
  /\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[kKmM]|\s?(?:thousand|million|billion)\b)?/gi;

// Re-parse of a single token into its parts. Deliberately no sign: the
// domain has no negative values (cents, counts, ratings), and treating "-"
// as a minus would corrupt phone numbers ("555-0131") into negative claims.
const CLAIM_PARTS =
  /^(\$?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:([kKmM])|\s?(thousand|million|billion))?$/i;

const SUFFIX_MULTIPLIER: Record<string, number> = {
  K: 1e3,
  M: 1e6,
  THOUSAND: 1e3,
  MILLION: 1e6,
  BILLION: 1e9,
};

export interface NumericClaim {
  /** as written in the answer — what the report shows on a miss */
  text: string;
  value: number;
  /** Half the place value of the last SIGNIFICANT written digit (suffix
   * included): the rounding step that produced the text. "$3.1M" earns
   * ±50,000 — one decimal of millions is a coarse statement; "28,296" earns
   * ±0.5. A flat percentage can't serve both: 0.5% rejects legitimately
   * compact numbers ($3.1M vs $3,141,592.65 is 1.3% off), and anything
   * loose enough for them would wave real hallucinations through on exact
   * numbers. */
  tolerance: number;
}

// The rounding step a token's spelling implies, before the suffix scales it.
// With decimals it's the place of the last decimal digit ("479.11" → 0.005).
// Without, trailing zeros ARE the rounding: "495,000" was rounded to the
// thousand and earns ±500 — the same claim as "$495K" — while "495,479"
// wrote every digit and keeps ±0.5. An all-zero token ("0") carries no
// rounding signal and stays exact.
function writtenTolerance(digits: string, decimals: string | undefined): number {
  if (decimals !== undefined) return 10 ** -decimals.length / 2;
  const bare = digits.replace(/,/g, "");
  const zeros = /0+$/.exec(bare)?.[0].length ?? 0;
  return (bare.length > zeros ? 10 ** zeros : 1) / 2;
}

function parseClaim(token: string): NumericClaim | null {
  const parts = CLAIM_PARTS.exec(token);
  if (!parts) return null;
  const [, dollar = "", digits = "", decimals, glued, word] = parts;
  const suffix = glued ?? word;

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
    tolerance: multiplier * writtenTolerance(digits, decimals),
  };
}

// Every occurrence is its own claim: an answer that repeats a hallucinated
// number asserted it twice, and repeats of grounded numbers cost nothing.
// Exported for the facts scorer, which checks expected values against the
// same claims (one tokenizer, one tolerance rule — they must never drift).
export function extractClaims(answer: string): NumericClaim[] {
  const withoutDates = answer
    .replace(ISO_DATE, " ")
    .replace(MONTH_NAME_DATE, " ")
    .replace(SLASH_DATE, " ");
  const tokens = withoutDates.match(CLAIM_TOKEN) ?? [];
  return tokens.map(parseClaim).filter((claim): claim is NumericClaim => claim !== null);
}

/** The single matching rule: a claim covers a value when the value sits
 * inside the claim's written-precision tolerance. Shared with the facts
 * scorer so "does this number appear?" means the same thing everywhere. */
export function claimMatchesValue(claim: NumericClaim, value: number): boolean {
  return Math.abs(claim.value - value) <= claim.tolerance;
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
      if (grounded.some((value) => claimMatchesValue(claim, value))) {
        hits++;
      } else {
        details.push(`ungrounded number in answer: "${claim.text}"`);
      }
    }

    return { score: hits / claims.length, details };
  },
};
