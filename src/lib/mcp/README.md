# MCP tools + server

Tool definitions consumed two ways: in-process by the `lib/ai` tool loop,
and over stdio by the MCP server (`server.ts` factory + `pnpm mcp` entry in
`scripts/mcp-server.ts`). Client setup: [docs/mcp-server.md](../../../docs/mcp-server.md).

## Boundaries
- Tools defined here are pure: input validation → action → typed output.
- No UI concerns. No direct rendering.
- Errors are returned as structured tool errors, never thrown to the caller.
- `server.ts` is wiring only — protocol requests mapped onto
  `getToolSpecs()`/`runTool()`; it owns no schemas and no SQL (ADR-0008).