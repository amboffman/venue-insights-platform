# Multi-Location Intelligence Platform (MLIP)

**Ask questions in plain English across many business locations — and get
grounded, tool-backed answers with rich, generated UI.** MLIP is a production-grade
demonstration of AI-augmented full-stack engineering for multi-location SaaS
(think hospitality, restaurant groups, and commercial real estate portfolios).

> **Status:** Active development. The tooling/architecture foundation is in place;
> features are being built in vertical slices. See [`docs/DECISIONS.md`](docs/DECISIONS.md)
> for the roadmap and the reasoning behind each choice.

## Three core features

1. **Conversational multi-location search** — a chat interface where Claude uses
   tool calling to query structured business data and renders results as
   generative UI (cards, tables, charts), not just text.
2. **Open-source MCP server** — the local-business intelligence tools, exposed
   over the [Model Context Protocol](https://modelcontextprotocol.io) so any MCP
   client can use them.
3. **Evaluation & observability layer** — a DIY TypeScript eval suite plus
   OpenTelemetry traces and a cost/latency dashboard, so answer quality and
   spend are measured, not assumed.

## Stack

| Layer         | Choice                                                          |
| ------------- | --------------------------------------------------------------- |
| Frontend      | Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/ui (Radix) |
| AI            | Anthropic Claude API — tool use + MCP                           |
| Persistence   | PostgreSQL on Supabase (synthetic seeded dataset)               |
| Evals / obs.  | DIY TypeScript harness · OpenTelemetry                          |
| Tooling       | Vitest · ESLint (flat) · Prettier · GitHub Actions CI           |
| Deploy        | Vercel                                                          |

## Architecture

The code under [`src/lib/`](src/lib) is split into layers with **enforced
boundaries** (each has a README spelling out its rules):

- [`lib/ai`](src/lib/ai/README.md) — Claude orchestration: prompts, tool-call handling, response validation. Server-only.
- [`lib/db`](src/lib/db/README.md) — the only place SQL/ORM code lives. Returns domain types, not rows.
- [`lib/mcp`](src/lib/mcp/README.md) — MCP tool definitions (pure: validate → act → typed output).
- [`lib/telemetry`](src/lib/telemetry/README.md) — OpenTelemetry instrumentation.
- [`lib/types`](src/lib/types/README.md) — types that cross module boundaries.

## Getting started

**Prerequisites:** Node 20+ and [pnpm](https://pnpm.io) (pinned via `packageManager`).

```bash
pnpm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
pnpm dev                     # http://localhost:3000
```

Verify Claude connectivity:

```bash
pnpm smoke:claude
```

## Scripts

| Script               | Does                                              |
| -------------------- | ------------------------------------------------- |
| `pnpm dev`           | Run the dev server (Turbopack)                    |
| `pnpm build`         | Production build                                  |
| `pnpm test`          | Run the Vitest suite once                         |
| `pnpm test:watch`    | Vitest in watch mode                              |
| `pnpm check`         | Typecheck + lint + format check + tests (CI gate) |
| `pnpm check:fix`     | Auto-fix formatting/lint, then typecheck          |
| `pnpm smoke:claude`  | Smoke-test the Anthropic API connection           |

## Project docs

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — decision log (one line each)
- [`docs/adr/`](docs/adr) — full architecture decision records

## License

[MIT](LICENSE)
