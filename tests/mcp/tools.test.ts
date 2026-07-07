// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/client";
import { SEED_END_DATE, SEED_START_DATE, generateSeedData } from "@/lib/db/seed-data";
import { TOOL_NAMES, getToolSpecs, runTool } from "@/lib/mcp/tools";
import type { LocationSummary, MetricsAggregate } from "@/lib/types/domain";
import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

const seed = generateSeedData();
let seeded: SeededDb;
let db: Database;

beforeAll(async () => {
  seeded = await createSeededDb();
  db = seeded.db;
}, 120_000);

afterAll(() => seeded.close());

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

  it("rejects an empty locationIds array on aggregate_metrics", async () => {
    const result = await runTool(db, "aggregate_metrics", {
      from: SEED_START_DATE,
      to: SEED_END_DATE,
      locationIds: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects calendar-invalid dates at the schema boundary", async () => {
    const result = await runTool(db, "aggregate_metrics", {
      from: "2026-06-31",
      to: "2026-07-15",
    });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("calendar");
  });

  it("rejects compare_locations with fewer than two ids", async () => {
    const result = await runTool(db, "compare_locations", {
      locationIds: [1],
      from: SEED_START_DATE,
      to: SEED_END_DATE,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate ids that dodge the min-2 rule", async () => {
    const result = await runTool(db, "compare_locations", {
      locationIds: [1, 1],
      from: SEED_START_DATE,
      to: SEED_END_DATE,
    });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("distinct");
  });

  it("rejects an inverted date range instead of returning silent zeros", async () => {
    const result = await runTool(db, "aggregate_metrics", {
      from: SEED_END_DATE,
      to: SEED_START_DATE,
    });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("on or before");
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
