# Evals

DIY eval harness (ADR-0005): golden dataset, deterministic scorers, runner,
and report writer. Run with `pnpm eval` — never in CI (eval runs call the
real Claude API and cost tokens; scorer unit tests are pure and DO run in CI).

## Boundaries

- Scorers are pure functions: `(case, {answer, toolCalls}) → {score, details}`.
  No I/O, no API calls, no clock.
- The golden dataset derives every expected value from `generateSeedData()` —
  never hardcode a number the seed could compute.
- The runner is the only file that touches the network (via `lib/ai`), and
  `evals/agent.eval.ts` is the only entry point that executes it.
- `scorers/groundedness.ts` is **author-implemented** (see LEARNING.md brief);
  everything else is infrastructure.
