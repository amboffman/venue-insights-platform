// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { SEED_END_DATE, SEED_START_DATE, generateSeedData } from "@/lib/db/seed-data";
import { TOOL_NAMES, getToolSpecs, runTool } from "@/lib/mcp/tools";
import type { LocationSummary, MetricsAggregate } from "@/lib/types/domain";

const seed = generateSeedData();
let db: Database;

beforeAll(async () => {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: "src/lib/db/migrations" });
  db = pglite as unknown as Database;

  for (const [table, rows] of [
    [schema.brands, seed.brands],
    [schema.locations, seed.locations],
    [schema.reviews, seed.reviews],
    [schema.dailyMetrics, seed.dailyMetrics],
  ] as const) {
    for (let i = 0; i < rows.length; i += 2000) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pglite.insert(table as any).values(rows.slice(i, i + 2000) as any);
    }
  }
}, 120_000);

describe("getToolSpecs", () => {
  it("exposes all four tools with JSON Schema inputs", () => {
    const specs = getToolSpecs();
    expect(specs.map((s) => s.name)).toEqual([
      "search_locations",
      "get_location_details",
      "aggregate_metrics",
      "compare_locations",
    ]);
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.inputSchema).toMatchObject({ type: "object" });
      expect(spec.inputSchema).not.toHaveProperty("$schema");
    }
  });

  it("exposes valid brand slugs as an enum the model can see", () => {
    const search = getToolSpecs().find((s) => s.name === "search_locations")!;
    const properties = search.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.brandSlug!.enum).toContain("copper-kettle-coffee");
  });
});

describe("runTool", () => {
  it("executes search_locations with typed output", async () => {
    const result = await runTool(db, "search_locations", {
      city: "Austin",
      limit: 100,
    });
    expect(result.ok).toBe(true);
    const rows = (result as { output: LocationSummary[] }).output;
    expect(rows.length).toBe(seed.locations.filter((l) => l.city === "Austin").length);
  });

  it("executes aggregate_metrics and matches an independent computation", async () => {
    const result = await runTool(db, "aggregate_metrics", {
      from: SEED_START_DATE,
      to: SEED_END_DATE,
    });
    expect(result.ok).toBe(true);
    const output = (result as { output: MetricsAggregate }).output;
    const expectedRevenue = seed.dailyMetrics.reduce((sum, m) => sum + m.revenueCents, 0);
    expect(output.totalRevenueCents).toBe(expectedRevenue);
  });

  it("rejects invalid input with a readable structured error", async () => {
    const result = await runTool(db, "get_location_details", {
      locationId: "not-a-number",
    });
    expect(result.ok).toBe(false);
    const error = (result as { error: string }).error;
    expect(error).toContain("Invalid input for get_location_details");
    expect(error).toContain("locationId");
  });

  it("rejects an out-of-vocabulary brand slug", async () => {
    const result = await runTool(db, "aggregate_metrics", {
      from: SEED_START_DATE,
      to: SEED_END_DATE,
      brandSlug: "starbucks",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects compare_locations with fewer than two ids", async () => {
    const result = await runTool(db, "compare_locations", {
      locationIds: [1],
      from: SEED_START_DATE,
      to: SEED_END_DATE,
    });
    expect(result.ok).toBe(false);
  });

  it("returns a structured error for unknown tools, never throws", async () => {
    const result = await runTool(db, "drop_all_tables", {});
    expect(result.ok).toBe(false);
    const error = (result as { error: string }).error;
    for (const name of TOOL_NAMES) {
      expect(error).toContain(name);
    }
  });
});
