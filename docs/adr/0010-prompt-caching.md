# 010. Turn on Anthropic prompt caching (explicit cache_control breakpoints)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0002 deliberately kept the prompt prefix byte-stable — fixed system
prompt, deterministic tool schemas — "so the prefix stays cacheable." But
Anthropic prompt caching is opt-in: without an explicit `cache_control`
marker, nothing is ever cached, and the 2026-07-03 audit confirmed the repo
contains zero markers. Every round of a multi-round tool turn re-billed the
~1600-token static prefix plus the full accumulated history (tool results
included — a single search can return 50 locations of JSON) at the full
input rate. On the budget-gated public demo (ADR-0007, default $2/day),
that burns the daily ceiling measurably faster than the design intended.

Caching mechanics that shaped the decision (current Anthropic docs,
consulted 2026-07-06): caching is a strict prefix match; the prompt renders
tools → system → messages; max 4 breakpoints per request; there is a
model-dependent minimum cacheable prefix below which a marker silently does
nothing; cache writes bill at 1.25× the input rate and reads at 0.1×; cache
activity is reported per response in `usage.cache_creation_input_tokens` /
`usage.cache_read_input_tokens`.

## Options considered

1. **Single breakpoint on the system block.** One marker caches tools +
   system together (render order). Simplest — but our static prefix is only
   ~1600 tokens, likely below the model's minimum cacheable prefix, so the
   marker alone may buy nothing. And history (the expensive part on
   multi-round turns) is never cached.
2. **System breakpoint + a moving breakpoint on the last message block.**
   Round N+1 of a tool turn re-reads round N's entire history at 0.1×.
   The combined prefix passes the minimum as soon as one tool result lands.
   Slightly more code: the marker must move, not accumulate (4-max rule).
3. **Top-level auto-caching.** Least code, but keys the cache to whatever
   block happens to be last, and makes the breakpoint placement implicit —
   worse teaching value and less control than 2 at nearly the same cost.

## Decision

Option 2. `systemBlocks()` returns the system prompt as a cache-marked
block array (covers tools + system); `messagesWithCacheBreakpoint()`
non-destructively re-marks only the final content block of the request per
round, so markers never accumulate. Both loops (streaming and
non-streaming) share the helpers, so they cannot drift.

Cache tokens are billed at different rates, so the cost model learned about
them: `cost.ts` prices writes at 5/4 and reads at 1/10 of the input rate
(integer ratios, single rounding step), and the per-call/turn spans record
`cache_read`/`cache_creation` token counts. Without this the budget breaker
would systematically misprice cached turns.

## Consequences

- Rounds 2..N of a tool turn re-read the prefix + history at ~0.1× — the
  ADR-0002 byte-stability rationale finally pays out; the ADR-0007 daily
  budget stretches further.
- We pay the 1.25× write premium on first rounds; break-even is the second
  request against the same prefix (well inside a normal tool turn).
- Cross-request caching (a user's next chat turn) only hits when the
  rebuilt text-turn history matches a previous request's prefix — partial
  by design (ADR-0003's stateless text-only history), not a regression.
- Verification is observable, not assumed: if the observability page shows
  `cache_read_input_tokens` stuck at zero across consecutive rounds, a
  silent invalidator crept into the prefix (the audit checklist lives in
  the Anthropic caching docs).
- The `done` wire event still carries only input/output tokens — cache
  counts are a server-side cost detail, visible per span.
