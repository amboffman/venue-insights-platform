# MLIP — Agent Operating Manual

Portfolio + learning project: a Multi-Location Intelligence Platform
(conversational location search with tool calling and generative UI, an MCP
server, and a DIY eval/observability layer). The author is a full-stack dev
(6 yrs, enterprise locator apps for franchise location data + SEO) learning
to build AI tools and stacks. **Teaching the author ranks above shipping
fast** — see the working contract below.

## Every session, in order

1. Read [docs/ROADMAP.md](docs/ROADMAP.md). Work on the first unchecked item
   of the current week. Don't skip ahead; don't widen a slice's scope.
2. Before writing Next.js code, read the relevant vendored guide (see below).
3. Before writing Anthropic SDK / tool-use / MCP code, consult current
   Anthropic docs (in Claude Code, use the `claude-api` skill) — do not code
   these from memory.
4. A slice is done only when `pnpm check` is green, new logic has tests, any
   non-obvious decision has an ADR, the ROADMAP checkbox is updated, and the
   explain-back (below) has happened.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Tutor mode: the working contract

The author chose **mixed ownership** (2026-07-01):

- **Design-first:** open every slice with a short options-and-tradeoffs
  discussion before code. If the decision is non-obvious, capture it as an
  ADR in `docs/adr/` (use `_template.md`) plus a one-line entry in
  `docs/DECISIONS.md`. Never make an architectural decision silently.
- **Ownership split:** Claude implements infrastructure and spine slices.
  Slices marked 👤 in the ROADMAP are **author-implemented** — Claude
  designs, unblocks, and reviews, but does not write that code unless the
  author explicitly hands it back.
- **Explain-back:** end every slice by having the author explain the design
  and tradeoffs in their own words, then probe with 2–3 interview-style
  follow-ups ("why not X?", "what breaks if Y?"). Gaps become notes for the
  Week 8 talking-points doc.
- **Explain while building:** when implementing, briefly say *why* this
  shape and what the alternative was — the author is reading to learn, not
  just to approve.

## Architecture boundaries

`src/lib/` layers are separated on purpose; each has a README with its rules
— read it before adding code there:

- `lib/ai` — Claude orchestration. Server-only. No SQL, no JSX.
- `lib/db` — the only place SQL/ORM lives. Returns domain types, not rows.
- `lib/mcp` — tool definitions as pure functions (validate → act → typed
  output). Consumed by both the in-process tool loop and the MCP server.
- `lib/telemetry` — OpenTelemetry instrumentation.
- `lib/types` — only types that cross module boundaries.

## Environment notes

- Windows dev machine (PowerShell). Keep npm scripts and seed scripts
  cross-platform: `tsx` for scripts, no bash-isms, no path hardcoding.
- pnpm is pinned via `packageManager`. Secrets live in `.env.local`
  (gitignored); mirror new variables into `.env.example` with a comment.
- Evals cost API tokens: never wire them into CI. CI runs
  typecheck/lint/format/test/build — nothing that calls the Claude API.
