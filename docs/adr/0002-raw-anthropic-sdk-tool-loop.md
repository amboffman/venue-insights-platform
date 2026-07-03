# 0002. Hand-rolled tool loop on the raw Anthropic SDK

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

The chat spine needs an orchestration layer: send a question to Claude with
tool definitions, execute the tool calls it makes, feed results back, and
repeat until it produces a grounded answer. Frameworks exist that hide this
loop entirely. The project's first goal is that the author can explain every
layer in an interview (locked 2026-06-17); this ADR records what that choice
costs and the smaller decisions inside the loop.

## Options considered

### Orchestration layer

1. **Raw `@anthropic-ai/sdk`, hand-rolled loop (chosen)** — we own message
   history, stop-reason handling, tool dispatch, error strategy, and usage
   accounting. Every behavior is inspectable and testable; evals and
   telemetry (Weeks 5–6) hook into our own loop instead of framework
   internals.
2. **Vercel AI SDK** — excellent DX (`generateText`/`streamText` with a
   `tools` map, built-in UI hooks), but the loop, retries, and message
   shapes are framework internals; explaining "how does tool calling work"
   would reduce to "the SDK does it". It also abstracts multi-provider
   support we don't need.
3. **Anthropic SDK's beta tool runner** (`toolRunner` + `betaZodTool`) —
   same vendor, much less code, but still hides the loop we're here to
   learn, and it's a beta surface.

### Decisions inside the loop (made 2026-07-02, compressed design round)

- **Zod single-source tool schemas.** Each tool's input schema is defined
  once in zod v4; `z.toJSONSchema()` derives the JSON Schema the API sees,
  and the same zod schema validates the arguments the model sends back.
  One definition — the two views cannot drift. Rejected: hand-written JSON
  Schema + separate validator (drift risk); no runtime validation (a bad
  tool call would crash the loop).
- **Tool errors feed back as `is_error` tool results.** Unknown tool,
  invalid arguments, or execution failure returns a structured message the
  model can read; it retries with fixed arguments or explains the
  limitation. Rejected: fail-fast (one malformed argument kills an
  otherwise recoverable answer). This matches the lib/mcp boundary rule:
  tools never throw to the caller.
- **Default model `claude-sonnet-5`** — strong tool use at a cost that
  survives repeated 25-case eval runs; overridable per call.
- **Deterministic system prompt.** No clock, no per-request content; the
  seed's fixed end date is "today". Keeps eval runs reproducible and the
  prompt prefix cacheable.
- **Iteration guard (default 8 round-trips)** so a pathological tool-call
  loop terminates with a diagnosable result instead of burning tokens.

## Decision

Hand-roll the non-streaming loop in `src/lib/ai/tool-loop.ts` on the raw
SDK, with tools converted from the zod-based specs in `src/lib/mcp/tools.ts`.
The loop takes its Anthropic client and Database as injected dependencies
(`ClaudeClient` is a minimal structural interface), so tests script the
model's behavior with a fake client while running real validation and real
SQL underneath.

## Consequences

- We must track API behavior ourselves (current: append full assistant
  `content` each round so thinking blocks survive; all tool results for one
  assistant turn go back in a single user message; `pause_turn` re-sends).
  Consulting current docs before touching this file is an AGENTS.md rule.
- Week 3 streaming is our job too — no framework `streamText` to lean on.
- The eval harness gets exact, framework-free hooks: `AskResult` already
  reports tool calls, per-run token usage, iterations, and stop reason.
- If maintenance cost ever outweighs the learning value, the migration
  path is option 3 (SDK tool runner) — the zod tool definitions are
  already in the shape it expects.
