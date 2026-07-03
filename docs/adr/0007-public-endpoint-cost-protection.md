# 007. Public-endpoint cost protection

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

The Vercel deployment makes `POST /api/chat` public, and every valid
request spends real Anthropic credits (up to 8 tool iterations × 16K max
output tokens). Scrapers actively hunt exposed LLM endpoints on
`*.vercel.app`. The data itself is safe — tools are read-only over
synthetic seed data — so the only asset at risk is API spend, which also
means the mitigation only has to bound dollars, not repel intrusion.

## Options considered

1. **Anthropic Console spend cap only** — zero code, bounds the worst
   case, but one abuser silently exhausts the cap and the demo is dead for
   the month, likely unnoticed.
2. **Vercel WAF rate-limit rules** — needs the Pro plan; Hobby only gets
   baseline DDoS protection.
3. **Deployment password / CAPTCHA** — protects, but adds friction for
   exactly the recruiters the portfolio URL exists for.
4. **In-app gates: per-IP rate limit + daily budget breaker** — small code
   (one table, one query, route-level checks), no new services, and the
   budget sensor is the Week 6 spans table we already maintain.

## Decision

Option 4 in the app, with option 1 kept as the hard backstop (operator
action in the Console; a code-level gate can never bound spend by itself
because bugs in the gate fail open).

- **Per-IP fixed-window counter in Postgres** (`rate_limits` table, one
  upsert per request, expired windows purged opportunistically on each
  hit). Serverless instances share no memory, so the counter must live in
  a store — and we already operate exactly one store. Fixed windows admit
  a 2× burst at a boundary; acceptable for cost control. The IP comes from
  `x-forwarded-for`'s first hop, which Vercel's proxy sets.
- **Daily budget breaker fed by telemetry**: before running a turn, sum
  today's `mlip.cost_microusd` over root `mlip.chat_turn` spans; at the
  ceiling, return 429 with Retry-After until UTC midnight. Eval spans
  (`mlip.ask`) are excluded — the operator's own runs don't spend the
  public budget. The sensor is eventually-consistent (in-flight turns
  haven't exported), which under-counts by at most the concurrent-turn
  cost — the Console cap absorbs that gap.
- **Gates live in the route handler, not lib/ai.** Abuse policy is an
  HTTP-boundary concern; the loops stay policy-free so evals are never
  throttled.
- Limits are env vars with safe defaults (`CHAT_RATE_LIMIT_MAX`,
  `CHAT_RATE_LIMIT_WINDOW_MINUTES`, `CHAT_DAILY_BUDGET_MICROUSD`),
  mirrored in `.env.example`.

## Consequences

- Worst case per day is a chosen number; abuse shows up on
  `/observability` because attackers are billed to the same spans table
  that powers the breaker.
- Two extra Postgres round-trips per chat request (~ms, dwarfed by the
  model call).
- Shared IPs (offices, CGNAT) share a window — the limit is deliberately
  per-IP-generous.
- If telemetry ever fails open (no spans → sum 0), the budget gate goes
  blind; the rate limit and the Console cap still stand — layered on
  purpose.
