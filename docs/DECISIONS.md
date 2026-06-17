# Decision log

One line per significant decision, newest first. Full reasoning lives in the
linked ADR under [`adr/`](./adr/). See
[ADR-0000](./adr/0000-record-architecture-decisions.md) for why we do this.

| #   | Date       | Decision                                                                                      | ADR                                                       |
| --- | ---------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| —   | 2026-06-17 | Use ADRs + this log to record decisions (project is built to be explained in interviews).     | [0000](./adr/0000-record-architecture-decisions.md)      |
| —   | 2026-06-17 | **Synthetic seeded Postgres** (on Supabase) backs the intelligence tools — not a live API. Deterministic, no rate limits, reproducible evals and demos. | _planned: ADR-001 (data model)_ |
| —   | 2026-06-17 | **DIY TypeScript eval harness + OpenTelemetry** for the eval/observability layer — not Braintrust. Maximizes "I built and can explain this." Evals run through Vitest. | _planned_ |
| —   | 2026-06-17 | **Vertical-slice build order** with a trim ladder: spine (schema → tool-calling loop → chat → deploy) → differentiators (generative UI, evals, observability) → publish MCP server. Optimizes for an always-demoable artifact. | _planned_ |
| —   | 2026-06-17 | **Tutor mode**: build in small slices, write an ADR per non-obvious decision, explain tradeoffs as we go. The portfolio writeup is drafted from these records. | [0000](./adr/0000-record-architecture-decisions.md) |
| —   | 2026-06-17 | **shadcn/ui on Radix primitives, fully self-contained**: chose the classic Radix style over the new Base UI `base-nova` default, and inlined `shadcn/tailwind.css` into `globals.css` to drop the `shadcn` runtime dependency — every line of UI/styling lives in-repo. | _planned: ADR-002 (UI foundation)_ |
| —   | 2026-06-17 | **Vitest** as the single test/eval runner (added; resolves the dangling reference in `tests/README.md`). | _planned_ |

> Entries marked _planned_ will get a full ADR when the corresponding feature
> work lands. They're logged here now so the reasoning isn't lost.
