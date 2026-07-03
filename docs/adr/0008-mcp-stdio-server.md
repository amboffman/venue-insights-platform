# 008. MCP stdio server: low-level passthrough of the existing tools

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Week 7 delivers the second transport for the `lib/mcp` tools — the
"one implementation, two transports" story planned since Week 2: the
in-process tool loop (Weeks 2–3) and an MCP stdio server that Claude
Desktop / Claude Code can attach to. `lib/mcp` already exposes exactly
the two seams a protocol adapter needs: `getToolSpecs()` (name,
description, JSON Schema derived from the zod source of truth) and
`runTool()` (validate → act → typed result union, never throws).

Timing note: the MCP TypeScript SDK's **v2 is in beta** (2026-07-28
spec, stable expected July 28 — right before our feature freeze), while
every shipping client today speaks v1.

## Options considered

1. **High-level `McpServer` + re-registered zod schemas** — the
   tutorial path (`registerTool` per tool). But it wants schema shapes
   handed to it again, re-coupling the server to zod details and
   duplicating what `getToolSpecs()` already produces.
2. **Low-level `Server` + `setRequestHandler` passthrough** — implement
   the two protocol requests (`tools/list`, `tools/call`) directly
   against the existing seams. Zero schema duplication, zero zod
   coupling in the adapter, and it teaches the actual wire protocol.
3. **Standalone published package** — npm publish is an explicit
   stretch item in the roadmap's trim ladder; out of scope.

## Decision

Option 2, pinned to **SDK v1** (`@modelcontextprotocol/sdk@^1`):

- `tools/list` → `getToolSpecs()` mapped 1:1 (the JSON Schemas that the
  Anthropic tool loop sends to the API are byte-for-byte what MCP
  clients receive — one source of truth, two consumers).
- `tools/call` → `runTool()`; `{ok: false}` becomes an
  `isError: true` text result — the same "failures are values the model
  reads" rule as the in-process loop (ADR-002).
- **Factory + entry split** (`buildMcpServer(db)` in `lib/mcp/server.ts`,
  I/O in `scripts/mcp-server.ts`) — the seed-script pattern: the factory
  tests over `InMemoryTransport.createLinkedPair()` with a real MCP
  `Client` and PGlite, no process spawning, no credentials.
- **stdout discipline**: stdout belongs to JSON-RPC framing. dotenv runs
  with `quiet: true` (its startup banner prints to stdout) and all human
  output goes to stderr. `.env.local` is resolved relative to the script
  file, not cwd — MCP clients launch servers from arbitrary directories.
- Not pinned to v2-beta: clients speak v1 today, and adopting a spec
  that stabilizes July 28 would land churn inside our freeze window.

## Consequences

- Claude Desktop / Claude Code answer questions against our Supabase
  through the same tool implementations the chat spine uses; a tool
  fix lands in both transports by construction.
- Tool results are serialized JSON text blocks; MCP `outputSchema` /
  `structuredContent` (typed results) is a known follow-up, not v1.
- MCP-originated tool calls don't emit telemetry spans yet — the
  wrapper calls `runTool` directly, not `executeToolUse`. Follow-up if
  the dashboard should see Desktop traffic.
- SDK v2 migration is a deliberate post-freeze decision, not an
  accident of `npm install`.
