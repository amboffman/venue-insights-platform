import { z } from "zod";

import type { Database } from "../db/client";
import {
  aggregateMetrics,
  compareLocations,
  getLocationDetails,
  searchLocations,
} from "../db/queries";
import { BRAND_SLUGS, SEED_END_DATE, SEED_START_DATE } from "../db/seed-data";

// Tools follow validate → act → typed output (see README.md). Each is a pure
// function over the injected Database handle, consumed two ways: in-process
// by the lib/ai tool loop, and (Week 7) wrapped by an MCP stdio server. Zod
// schemas are the single source of truth — the same schema validates incoming
// arguments at runtime and is converted to the JSON Schema the model sees.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

const brandSlug = z.enum(BRAND_SLUGS as [string, ...string[]]).describe("Brand identifier (slug)");

const DATA_WINDOW =
  `Daily metrics exist from ${SEED_START_DATE} to ${SEED_END_DATE} ` +
  `(inclusive); treat ${SEED_END_DATE} as "today". `;

interface ToolDefinition<TSchema extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: TSchema;
  handler: (db: Database, input: z.infer<TSchema>) => Promise<unknown>;
}

// Identity helper that preserves the schema↔handler type link per tool.
function defineTool<TSchema extends z.ZodType>(
  tool: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  return tool;
}

const searchLocationsTool = defineTool({
  name: "search_locations",
  description:
    "Search franchise locations with optional filters (brand, city, state, " +
    "status, name substring). Returns location summaries including the " +
    "numeric id needed by the other tools. The dataset is a fixed synthetic " +
    "portfolio: 5 brands, 50 locations across 10 US cities. Call this first " +
    "when you need location ids.",
  inputSchema: z.object({
    query: z.string().optional().describe("Case-insensitive substring match on location name"),
    brandSlug: brandSlug.optional(),
    city: z.string().optional().describe('City name, e.g. "Austin"'),
    state: z.string().length(2).optional().describe('Two-letter state code, e.g. "TX"'),
    status: z.enum(["open", "closed", "coming_soon"]).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
  }),
  handler: (db, input) => searchLocations(db, input),
});

const getLocationDetailsTool = defineTool({
  name: "get_location_details",
  description:
    "Get the full profile of one location by its numeric id: brand, " +
    "address, status, review count, average rating (1–5), and the 5 most " +
    "recent customer reviews.",
  inputSchema: z.object({
    locationId: z.number().int().describe("Numeric location id from search_locations"),
  }),
  handler: (db, input) => getLocationDetails(db, input.locationId),
});

const aggregateMetricsTool = defineTool({
  name: "aggregate_metrics",
  description:
    "Aggregate daily business metrics — revenue (integer cents), " +
    "transactions, foot traffic, and average ticket — over an inclusive " +
    "date range, across all locations or filtered by brand and/or specific " +
    "location ids. " +
    DATA_WINDOW +
    "Coming-soon locations have no metrics; closed locations stopped " +
    "reporting partway through the window.",
  inputSchema: z.object({
    from: isoDate.describe("Range start (inclusive)"),
    to: isoDate.describe("Range end (inclusive)"),
    brandSlug: brandSlug.optional(),
    locationIds: z.array(z.number().int()).optional(),
  }),
  handler: (db, input) => aggregateMetrics(db, input),
});

const compareLocationsTool = defineTool({
  name: "compare_locations",
  description:
    "Compare two or more locations side by side over an inclusive date " +
    "range: total revenue (integer cents), transactions, foot traffic, " +
    "average ticket, and average review rating per location, sorted by " +
    "revenue (highest first). " +
    DATA_WINDOW,
  inputSchema: z.object({
    locationIds: z
      .array(z.number().int())
      .min(2)
      .describe("Numeric location ids from search_locations"),
    from: isoDate.describe("Range start (inclusive)"),
    to: isoDate.describe("Range end (inclusive)"),
  }),
  handler: (db, input) => compareLocations(db, input),
});

// Type-erased registry: schema/handler pairing is enforced per tool above,
// runTool re-validates at the boundary so erasure is safe.
const TOOLS: ToolDefinition<z.ZodType>[] = [
  searchLocationsTool,
  getLocationDetailsTool,
  aggregateMetricsTool,
  compareLocationsTool,
] as ToolDefinition<z.ZodType>[];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, derived from the zod schema */
  inputSchema: Record<string, unknown>;
}

/** Protocol-agnostic tool specs — both the Anthropic API's `tools` array and
 * MCP tool listings are built from these. */
export function getToolSpecs(): ToolSpec[] {
  return TOOLS.map((tool) => {
    // z.toJSONSchema adds a $schema field the Anthropic API doesn't expect.
    const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.inputSchema);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: schema,
    };
  });
}

export type ToolRunResult = { ok: true; output: unknown } | { ok: false; error: string };

/** Validate and execute a tool call. Never throws (see README.md): every
 * failure — unknown tool, invalid input, execution error — comes back as a
 * structured error the model can read and recover from. */
export async function runTool(
  db: Database,
  name: string,
  rawInput: unknown,
): Promise<ToolRunResult> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return {
      ok: false,
      error: `Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(", ")}.`,
    };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`,
    };
  }

  try {
    return { ok: true, output: await tool.handler(db, parsed.data) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${name} failed: ${message}` };
  }
}
