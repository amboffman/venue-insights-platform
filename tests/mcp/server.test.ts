import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildMcpServer } from "@/lib/mcp/server";
import { TOOL_NAMES } from "@/lib/mcp/tools";

import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// Protocol-level tests: a REAL MCP client talks to our server over linked
// in-memory transports (full initialize handshake, JSON-RPC framing), and
// every tool call runs real zod validation + real SQL against PGlite. The
// only thing not exercised is the stdio pipe itself.

interface TextBlock {
  type: string;
  text: string;
}

describe("MCP server", () => {
  let seeded: SeededDb;
  let client: Client;

  beforeAll(async () => {
    seeded = await createSeededDb();
    const server = buildMcpServer(seeded.db);
    client = new Client({ name: "test-client", version: "0.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport); // performs the initialize handshake
  });

  afterAll(async () => {
    await client.close();
    await seeded.close();
  });

  it("lists all four tools with descriptions and object schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }

    // Spot-check that the zod-derived schema really travelled through:
    // the model-facing vocabulary (city filter) is visible to MCP clients.
    const search = tools.find((tool) => tool.name === "search_locations");
    expect(search?.inputSchema.properties).toHaveProperty("city");
  });

  it("executes a tool call end-to-end and returns JSON text content", async () => {
    const result = await client.callTool({
      name: "search_locations",
      arguments: { city: "Austin", limit: 100 },
    });

    expect(result.isError).toBeFalsy();
    const blocks = result.content as TextBlock[];
    expect(blocks[0]!.type).toBe("text");

    const locations = JSON.parse(blocks[0]!.text) as Array<{ city: string }>;
    expect(locations.length).toBeGreaterThan(0);
    expect(locations.every((location) => location.city === "Austin")).toBe(true);
  });

  it("returns validation failures as isError results, never throws", async () => {
    const result = await client.callTool({
      name: "get_location_details",
      arguments: { locationId: "abc" }, // must be a number
    });

    expect(result.isError).toBe(true);
    const blocks = result.content as TextBlock[];
    expect(blocks[0]!.text).toContain("locationId");
  });

  it("rejects unknown tools with a model-readable error", async () => {
    const result = await client.callTool({ name: "drop_all_tables", arguments: {} });

    expect(result.isError).toBe(true);
    const blocks = result.content as TextBlock[];
    // The error names the valid options — written for a model to recover.
    expect(blocks[0]!.text).toContain("search_locations");
  });
});
