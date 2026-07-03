import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import type { Database } from "../db/client";
import { getToolSpecs, runTool } from "./tools";

// The second transport for the lib/mcp tools (ADR-0008). Deliberately the
// LOW-LEVEL Server, not the McpServer sugar: getToolSpecs() already owns
// names/descriptions/JSON Schemas and runTool() already owns validate →
// act → result-union, so the adapter's whole job is mapping two protocol
// requests onto those seams. Re-registering schemas with the high-level
// API would create a second source of truth.

/** Build the MCP server around a Database handle. Pure wiring, no I/O —
 * tests connect it to an InMemoryTransport; scripts/mcp-server.ts connects
 * it to stdio. */
export function buildMcpServer(db: Database): Server {
  const server = new Server(
    { name: "venue-insights", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // The exact JSON Schemas the Anthropic tool loop sends to the API —
    // one zod source of truth, two protocol consumers.
    tools: getToolSpecs().map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema as Tool["inputSchema"],
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // runTool never throws (lib/mcp boundary rule); unknown tools and
    // invalid arguments come back as {ok: false} with a model-readable
    // message — the MCP mirror of the loop's is_error tool_result.
    const result = await runTool(db, request.params.name, request.params.arguments ?? {});
    return result.ok
      ? { content: [{ type: "text", text: JSON.stringify(result.output) }] }
      : { content: [{ type: "text", text: result.error }], isError: true };
  });

  return server;
}
