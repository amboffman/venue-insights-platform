# 0001. Data model, Drizzle as DB toolkit, PGlite for query tests

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

The platform's intelligence tools (Week 2+) answer questions about
multi-location franchise businesses: "which downtown locations underperform
on revenue?", "compare review sentiment across the Austin stores". Per the
2026-06-17 decision, the data is **synthetic seeded Postgres on Supabase** —
deterministic, reproducible, no external APIs — so evals can assert exact
numbers.

Three sub-decisions land together here: the schema itself, the DB toolkit
(the roadmap tentatively locked Drizzle, to be confirmed), and how to unit
test `lib/db` before a live database exists (as of Day 1 there is no
Supabase project yet, and tests must stay credential-free and CI-safe
regardless).

The author has 6 years building enterprise locator apps and reviewed the
schema for domain realism.

## Options considered

### Schema

1. **Four tables: `brands` → `locations` → `reviews` + `daily_metrics`
   (chosen)** — the minimum shape that makes every planned tool interesting:
   search needs locations with geo + status, details need reviews,
   aggregation/comparison need a metrics time series at (location, day)
   grain. ~5 brands / ~50 locations / ~18k metric rows.
2. **Add operational tables (hours, menus, staff, promotions)** — more
   realistic, but no planned tool reads them; pure seed-script cost.
3. **Multi-tenant (orgs/users)** — realistic for SaaS but doubles every
   query's surface for a demo with one implicit tenant. Explicitly
   single-tenant per the roadmap.

Schema-level calls, each deliberate:

- **Integer identity PKs, not UUIDs** — with a deterministic seed, stable
  small IDs make tool outputs, eval fixtures, and demo conversations
  readable ("location 12"). UUID realism buys nothing in a single-tenant
  demo.
- **Money as integer cents** (`revenue_cents`) — floating-point money is a
  classic correctness trap; evals assert exact sums.
- **Plain `lat`/`lng` numeric columns, no PostGIS** — city/state filters
  and (if ever needed) Haversine-in-SQL cover the planned tools. PostGIS is
  a real extension on Supabase but adds migration/testing complexity we'd
  never demo. Revisit only if a "locations near me" tool becomes scope.
- **Status enum on locations** (`open` / `closed` / `coming_soon`) — the
  lifecycle detail real locator datasets always carry; makes "how many open
  locations…" questions answerable.
- **Review `source` enum** (`google` / `yelp` / `in_app`) — mirrors how
  franchise review data actually arrives (aggregated from platforms).
- **`daily_metrics` unique on (location_id, date)** — the invariant that
  makes aggregation trustworthy; upserts in the seed are idempotent.

### DB toolkit

1. **Drizzle (chosen)** — thin, SQL-transparent (you can read the emitted
   SQL, which serves the "explain every layer" interview goal), first-class
   TypeScript inference, `drizzle-kit` migrations, works with both the
   `postgres` driver (Supabase) and PGlite through the same schema.
2. **Prisma** — bigger ecosystem, but hides SQL behind a query engine and a
   separate schema DSL; weaker for the learning goal, heavier runtime.
3. **Kysely + hand-written SQL migrations** — maximum transparency, but no
   integrated migration story; more plumbing than learning.

### Testing `lib/db`

1. **PGlite in-memory (chosen)** — real Postgres compiled to WASM, runs
   inside Vitest. Tests push the actual generated migrations and run real
   SQL against the real schema: deterministic, credential-free, CI-safe.
   One dev dependency.
2. **Live Supabase test schema** — highest fidelity but requires
   credentials, is slow and stateful, and would block Day 1 entirely.
3. **Mocking the Drizzle client** — tests would only assert we called the
   mock; zero confidence in the SQL. Not worth writing.

## Decision

Four-table single-tenant schema (`brands`, `locations`, `reviews`,
`daily_metrics`) with the calls listed above; **Drizzle** confirmed as the
DB toolkit with `drizzle-kit` migrations checked into
`src/lib/db/migrations/`; **PGlite** for `lib/db` unit tests, running the
same generated migrations the live database uses.

Seed generation is split from seed IO: pure deterministic generators in
`src/lib/db/seed-data.ts` (seeded RNG, no I/O) and a thin
`scripts/seed.ts` that connects and writes. Tests and the live seed share
one data source, so eval fixtures match production data exactly.

## Consequences

- Evals (Week 5) can assert exact numbers because seed data is a pure
  function of a fixed RNG seed.
- Query tests double as **migration tests** — PGlite applies the same SQL
  files Supabase will.
- PGlite's Postgres version can drift from Supabase's; we stay on vanilla
  SQL (no extensions), so risk is low. If a query ever behaves differently
  live, that becomes an explicit integration test.
- No PostGIS means any future radius-search tool does Haversine math in
  SQL or app code — acceptable at 50 rows, worth an ADR revision at real
  scale.
- Domain types live in `src/lib/types`; `lib/db` maps rows to them at the
  boundary, so nothing downstream imports Drizzle types.
