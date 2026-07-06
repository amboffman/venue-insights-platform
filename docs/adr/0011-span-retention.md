# 011. Span retention: 90-day opportunistic purge + scoped aggregates

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The spans table (ADR-0006) was insert-only: every public chat turn and
every eval case appended rows forever, and nothing anywhere deleted them.
The 2026-07-03 audit flagged the compounding effect — the observability
page's tool-count query grouped EVERY execute_tool span ever recorded to
annotate the 50 rows it shows, and the eval-run summary re-aggregated the
full root-span history (which grows with public traffic, not eval usage)
per page view. Cost grew linearly with lifetime traffic for a fixed-size
page.

## Options considered

1. **Query scoping only** — bound each aggregate to what the page shows
   (trace-id `inArray`, started_at floor, LIMIT). Fixes page latency but
   the table still grows forever.
2. **Scoping + a retention purge** — same, plus delete spans older than
   N days. Needs a trigger point; a cron is infrastructure this project
   doesn't otherwise have.
3. **Scheduled job (Vercel cron)** for the purge — cleaner separation but
   adds deployment surface for a demo-scale table.

## Decision

Option 2. All observability aggregates are bounded to what they display
(the tool-count query joins only the listed traces; eval summaries floor
at the retention window and LIMIT 50), and `deleteExpiredSpans` purges
rows older than **90 days**, called opportunistically from the
observability page — the same piggyback pattern the rate limiter already
uses (`rate-limit.ts` purges expired windows on each hit). The operator
visiting the dashboard is exactly the moment staleness matters.

90 days keeps far more history than the demo ever shows (50 turns) while
capping the table at a season of traffic.

## Consequences

- /observability latency is now O(page size), not O(lifetime traffic).
- Spans older than 90 days are gone — acceptable for a demo; a real
  deployment would archive rather than delete.
- If the page is never visited, nothing purges — bounded harm (the purge
  also caps the very queries that would slow down), and a cron can be
  added later without changing the function.
- `started_at` is already indexed, so the purge is a cheap no-op when
  nothing is expired.
