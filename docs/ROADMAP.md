# Roadmap

**This file is the source of truth for what to build and in what order.**
Agents: at the start of every session, find the first unchecked item in the
current week and work on that. Update checkboxes as work lands. Do not start
a later slice while an earlier one is unfinished, and do not expand a slice's
scope beyond what its acceptance criteria require.

## Goal and constraints

- **Dual goal, in priority order:** (1) teach the author how to design and
  build AI tools and stacks, (2) produce a demonstrable portfolio artifact for
  senior IC / AI-augmented full-stack applications at multi-location SaaS
  companies (Cloudbeds, Toast, CoStar).
- **Deadline:** demoable by **Sept 1, 2026** (firm — interviews in September).
- **Budget:** 5–8 hours/week (~2 sessions), ~55–65 hours total from Jul 1.
- **Trim bias (author's call, 2026-07-01):** when time runs short, protect the
  chat spine and the eval/observability layer at full depth. The MCP server
  and dashboard charts are cut first. Breadth loses to depth.
- **Work style:** tutor mode with mixed ownership — see
  [AGENTS.md](../AGENTS.md#tutor-mode-the-working-contract).

## Locked-in decisions (context for every slice)

Full reasoning in [DECISIONS.md](./DECISIONS.md) and [adr/](./adr/).

- **Data:** synthetic seeded Postgres on Supabase. Deterministic seed
  (seeded RNG), no external APIs, so evals and demos are reproducible.
- **AI:** raw `@anthropic-ai/sdk` (already installed) — no Vercel AI SDK.
  Hand-rolling the tool loop and streaming is the point: the author must be
  able to explain every layer in an interview. Write the ADR when the loop
  lands (Week 2).
- **Tools:** defined once in `lib/mcp` as pure functions (validate → act →
  typed output), consumed two ways: in-process by the `lib/ai` tool loop
  (Weeks 2–3), and wrapped by an MCP stdio server (Week 7). One
  implementation, two transports — this is a deliberate architecture story.
- **Generative UI:** deterministic — a typed registry mapping tool name →
  React component that renders that tool's output schema. The model never
  generates markup. Keeps rendering testable and safe.
- **Evals:** DIY TypeScript harness run through Vitest — not Braintrust.
  Deterministic scorers first, LLM-judge later (stretch). Eval suites are
  run on demand (they cost API tokens), never in CI.
- **DB toolkit:** Drizzle (confirm in ADR-001 at Week 1 start).

## Weekly plan

Each week ends with something demoable. "Done" for any slice means:
acceptance criteria met, `pnpm check` green, ADR written if a non-obvious
decision was made, checkbox updated here, and the explain-back conversation
(AGENTS.md) has happened.

### Week 1 (Jul 1–7) — Data foundation

- [x] ADR-001: data model + Drizzle confirmation (entities: brands,
      locations, reviews, daily_metrics; single-tenant; discuss what a
      locator-app veteran would recognize as realistic)
- [x] Supabase project created; `DATABASE_URL` etc. in `.env.local`
      (author does this — account setup can't be delegated), then
      `pnpm db:migrate && pnpm seed` against it (seeded 2026-07-02:
      5 brands / 50 locations / 733 reviews / 17,330 metric rows)
- [x] Drizzle schema + migrations for the core entities
- [x] Deterministic seed script (`pnpm seed`, seeded RNG, ~5 brands /
      ~50 locations / reviews + 12 months of daily metrics)
- [x] 3–4 typed query functions in `lib/db` with unit tests

**Demo:** seeded database; query tests green.

### Week 2 (Jul 8–14) — Tools + tool-calling loop

- [x] 4 tools in `lib/mcp` as pure functions with schema-validated inputs:
      `search_locations`, `get_location_details`, `aggregate_metrics`,
      `compare_locations`
- [x] ADR-002: raw Anthropic SDK vs Vercel AI SDK (record the learning
      rationale and what it costs us)
- [x] Non-streaming tool-use loop in `lib/ai`: question → Claude → tool
      calls → tool results → grounded answer; tested with a mocked client
- [x] Throwaway harness (script or route) to ask questions from the terminal
      (`pnpm ask "…"` — needs `DATABASE_URL` + `ANTHROPIC_API_KEY` for the
      live demo)

**Demo:** plain-English question → grounded, tool-backed answer in the terminal.

### Week 3 (Jul 15–21) — Streaming chat + deploy ⚑ go/no-go

- [x] Streaming route handler (read the vendored Next 16 docs first —
      streaming/route-handler APIs changed from training data) — NDJSON
      typed events, ADR-0003
- [x] Chat page: message list, input, streamed assistant responses, visible
      tool-call activity (even if just "Searching locations…")
- [ ] Deploy to Vercel (author connects repo + env vars); `pnpm build` added
      to CI ✓
- [ ] **Checkpoint (Jul 21):** if the spine is not deployed, cut Week 7 (MCP)
      now and shift everything up one week.

**Demo:** the live URL. **Tier 0 spine complete — always demoable from here.**

### Week 4 (Jul 22–28) — Generative UI

- [x] Component registry: tool name → typed renderer (`LocationCard`,
      `ComparisonTable`, `MetricsSummary`, + `LocationList`)
- [x] Chat renders tool results through the registry instead of prose-only
- [x] ADR-0004: deterministic generative UI (registry) vs model-generated
      markup (numbered 0004 — 0003 became the streaming chat protocol)

**Demo:** "compare downtown locations by revenue" → a real table in the chat.

### Week 5 (Jul 29–Aug 4) — Eval harness v1 👤 author-owned slice

- [x] Golden dataset: ~25 cases (question → expected tool calls, expected
      key facts) generated from the deterministic seed (24 cases, ADR-0005)
- [x] Deterministic scorers: tool-selection correctness ✓, argument
      correctness ✓, groundedness ✓ (all 11 TDD tests green)
- [x] ~~Author implements one scorer end-to-end; Claude reviews~~ — author
      built the extract/match core through the money tests, then explicitly
      handed groundedness back to Claude (2026-07-03). Review flow inverted:
      Claude walks the code, author must pass the drill before merge
      (LEARNING.md "Slice 5")
- [x] Vitest eval runner + a report artifact (JSON or markdown) per run
      (`pnpm eval` → eval-reports/run-*.{json,md}; never in CI)

**Demo:** `pnpm eval` → scored report showing where the agent fails.

### Week 6 (Aug 5–11) — Observability ⚑ go/no-go

- [x] OTel spans around every Claude call (latency, tokens, cost estimate)
      and every tool invocation (name, duration, outcome) — ADR-0006;
      turn → {chat, execute_tool} trace trees, GenAI semconv attrs, cost in
      integer µ$
- [x] Spans persisted (Postgres table is fine) — spans table + Postgres
      exporter through lib/db; migration applied to Supabase 2026-07-03
- [x] `/observability` page: cost + latency table per conversation and per
      eval run (tiles + two tables; force-dynamic server component reading
      lib/db aggregates). Charts remain stretch, not scope.
- [x] _(unplanned, post-deploy)_ Public-endpoint cost protection, ADR-0007:
      per-IP fixed-window rate limit + daily budget breaker fed by the
      spans table; Anthropic Console spend cap as the operator backstop.
- [ ] **Checkpoint (Aug 11):** if the eval harness isn't done, cut Week 7
      (MCP) and spend it finishing evals + observability.

**Demo:** run an eval suite, open the dashboard, point at the cost of each run.

### Week 7 (Aug 12–18) — MCP server 👤 author-owned slice

- [ ] Stdio MCP server wrapping the same `lib/mcp` tools
      (consult current MCP SDK docs before writing this)
- [ ] **Author implements one tool wrapper end-to-end; Claude reviews**
- [ ] README with setup for Claude Desktop / Claude Code as clients
- [ ] npm publish is stretch — an in-repo, documented server is enough

**Demo:** Claude Desktop answering questions via the MCP server against our DB.

### Week 8 (Aug 19–25) — Writeup + polish (feature freeze Aug 25)

- [ ] Portfolio writeup drafted from the ADRs (architecture narrative,
      tradeoffs, eval results with real numbers)
- [ ] README: demo GIF, architecture diagram, honest eval-results section
- [ ] Interview talking points doc: for each ADR, the "why X over Y" answer
      in the author's own words
- [ ] LLM-judge scorer (stretch, only if weeks 5–7 fully landed)

### Week 9 (Aug 26–Sept 1) — Buffer

Absorbs slip from any week. If genuinely unused: auth, dashboard charts,
richer seed data, extra eval cases.

## Trim ladder

Cut in this order, and only at the dated checkpoints above:

1. npm publish of the MCP server (keep the in-repo server)
2. Dashboard charts (keep the table)
3. LLM-judge scorer (keep deterministic scorers)
4. MCP server entirely (the `lib/mcp` purity keeps it cheap to add later)
5. `compare_locations` tool + `ComparisonTable`

**Never cut:** the deployed chat spine, at least one generative-UI component,
eval harness v1, the cost/latency table, the writeup week.

## Dependencies to add (per week, not before)

- W1: `drizzle-orm`, `drizzle-kit`, `postgres`, `zod` (or confirm alternative in ADR-001)
- W6: `@opentelemetry/api` + SDK packages (choose at slice start)
- W7: `@modelcontextprotocol/sdk`
