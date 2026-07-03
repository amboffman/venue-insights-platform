// MCP stdio entry point (ADR-0008): `pnpm mcp`, or launched directly by
// Claude Desktop / Claude Code. The I/O half of the seed-script pattern —
// all wiring logic lives in src/lib/mcp/server.ts where tests reach it.
//
// stdout belongs to the JSON-RPC protocol. Anything written there corrupts
// the framing and kills the session, so: dotenv runs quiet (its banner
// prints to stdout) and every human-facing message goes to stderr.
//
// CJS-shaped on purpose (no top-level await, __dirname not import.meta):
// tsx transforms scripts/ as CJS because package.json has no "type":
// "module". Static imports are safe ahead of config() — the db client
// reads DATABASE_URL lazily inside getDb(), never at import time.
import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";

import { closeDb, getDb } from "../src/lib/db/client";
import { buildMcpServer } from "../src/lib/mcp/server";

// Resolve .env.local relative to THIS FILE, not cwd — MCP clients launch
// servers from arbitrary working directories.
config({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

// Exit is unconditional: try to release the pg pool, but never let a
// wedged close (Supabase pooler) turn a disconnected server into a zombie
// node process in the client's process tree.
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const failsafe = setTimeout(() => process.exit(0), 2000);
  void closeDb()
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(failsafe);
      process.exit(0);
    });
}

async function main(): Promise<void> {
  const server = buildMcpServer(getDb());

  // Belt and suspenders: the SDK fires onclose on protocol shutdown, but a
  // client that just kills the pipe only manifests as stdin EOF — handle
  // both, or the server lingers after Desktop disconnects (observed on
  // Windows in the stdio smoke test).
  server.onclose = shutdown;
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);

  await server.connect(new StdioServerTransport());
  console.error("venue-insights MCP server listening on stdio (4 tools)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
