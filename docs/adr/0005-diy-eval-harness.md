# 0005. DIY eval harness: Vitest runner, seed-derived golden data, pure scorers

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

The agent needs measurement: which questions it answers correctly, whether
it picks the right tools with the right arguments, and whether its numbers
are real. The platform decision (DIY TypeScript harness, not Braintrust)
was locked 2026-06-17 to maximize "built and can explain it"; this ADR
records the concrete architecture now that it exists.

## Options considered

### Platform

1. **DIY harness on Vitest (chosen)** — scorers are pure TypeScript
   functions, the runner reuses `askQuestion` (the exact production loop),
   and Vitest provides per-case reporting, concurrency, and timeouts for
   free. Everything is explainable line by line.
2. **Braintrust / promptfoo / LangSmith** — richer dashboards and history
   for less code, but the scoring internals become someone else's system,
   and the project's eval story collapses to "I configured a tool".

### Architecture decisions inside the harness

- **Golden data derives from the seed.** Every expected count, revenue
  sum, and rating in `golden.ts` is computed from `generateSeedData()` —
  the same pure function that seeded the database. Dataset and data
  cannot drift, and there are no hand-copied constants to rot.
- **Questions pin what they score.** Cases that assert date arguments say
  the dates in the question ("from 2026-01-01 to 2026-06-30") — you can
  only score arguments the question determines. Vaguer phrasings are
  deliberately kept (state-wide counts vs. the default limit) as
  diagnostic cases.
- **Scorers are pure and CI-safe; runs are not.** Scorer unit tests cost
  nothing and run in `pnpm test`/CI. The eval RUN (`pnpm eval`) calls the
  real API against the real seeded DB, costs tokens, and lives in a
  separate Vitest config (`vitest.evals.config.mts`, `evals/*.eval.ts`) so
  no CI change can accidentally pick it up (also the standing rule in
  AGENTS.md).
- **Cases don't hard-fail on low scores.** The deliverable is the report
  ("show where the agent fails"), so a case fails only on pipeline errors;
  scores aggregate into `eval-reports/run-<ts>.{json,md}` (gitignored —
  regenerable artifacts).
- **Scorer errors degrade to `score: null`.** The author-owned
  groundedness scorer ships as a throwing stub; runs still complete and
  report "—" for that column until it lands.

### Ownership

Groundedness (numeric claims in the answer must appear in tool outputs) is
the **author-implemented** scorer per the mixed-ownership contract — spec,
TDD test file, and design brief prepared; review to follow. Tool-selection
and argument-correctness are infrastructure.

## Consequences

- `pnpm eval` → scored report naming each miss; mean scores per scorer.
- Adding a scorer is one pure function + one registry entry; the LLM-judge
  stretch (Week 8) slots in the same way, with its cost isolated to eval
  runs.
- No hosted dashboard or run history — reports are local files. Week 6's
  observability layer records per-call spans, which covers the durable
  half of that need.
- The `expectedFacts` field is populated but unconsumed until a
  fact-recall scorer lands (it shares number-matching with groundedness —
  deliberately sequenced after the author's scorer to not pre-build their
  slice).
