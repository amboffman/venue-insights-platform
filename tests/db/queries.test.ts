// @vitest-environment node
// PGlite is WASM Postgres running in-process: these tests apply the real
// generated migrations and the real seed data, so they cover the SQL, the
// schema, and the migration files together — no credentials needed.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/client";
import {
  aggregateMetrics,
  compareLocations,
  getLocationDetails,
  searchLocations,
} from "@/lib/db/queries";
import * as schema from "@/lib/db/schema";
import { SEED_END_DATE, generateSeedData, type DailyMetricInsert } from "@/lib/db/seed-data";

const seed = generateSeedData();
const WINDOW_START = "2025-07-01";

let db: Database;

function sumMetrics(rows: DailyMetricInsert[]) {
  return rows.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenueCents,
      transactions: acc.transactions + m.transactions,
      footTraffic: acc.footTraffic + m.footTraffic,
    }),
    { revenue: 0, transactions: 0, footTraffic: 0 },
  );
}

beforeAll(async () => {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: "src/lib/db/migrations" });
  db = pglite as unknown as Database;

  const insertChunked = async <T>(insert: (rows: T[]) => Promise<unknown>, rows: T[]) => {
    for (let i = 0; i < rows.length; i += 2000) {
      await insert(rows.slice(i, i + 2000));
    }
  };

  await insertChunked((r) => pglite.insert(schema.brands).values(r), seed.brands);
  await insertChunked((r) => pglite.insert(schema.locations).values(r), seed.locations);
  await insertChunked((r) => pglite.insert(schema.reviews).values(r), seed.reviews);
  await insertChunked((r) => pglite.insert(schema.dailyMetrics).values(r), seed.dailyMetrics);
}, 120_000);

describe("searchLocations", () => {
  it("returns at most the default limit, sorted by name", async () => {
    const results = await searchLocations(db);
    expect(results).toHaveLength(20);
    const names = results.map((r) => r.name);
    expect(names).toEqual([...names].sort());
  });

  it("filters by city case-insensitively", async () => {
    const expected = seed.locations.filter((l) => l.city === "Austin");
    const results = await searchLocations(db, { city: "austin", limit: 100 });
    expect(results).toHaveLength(expected.length);
    for (const result of results) {
      expect(result.city).toBe("Austin");
    }
  });

  it("filters by brand slug and status together", async () => {
    const expected = seed.locations.filter((l) => l.brandId === 1 && l.status === "open");
    const results = await searchLocations(db, {
      brandSlug: "copper-kettle-coffee",
      status: "open",
      limit: 100,
    });
    expect(results).toHaveLength(expected.length);
    for (const result of results) {
      expect(result.brandName).toBe("Copper Kettle Coffee");
      expect(result.status).toBe("open");
    }
  });

  it("uppercases the state filter", async () => {
    const expected = seed.locations.filter((l) => l.state === "TX");
    const results = await searchLocations(db, { state: "tx", limit: 100 });
    expect(results).toHaveLength(expected.length);
  });

  it("matches name substrings case-insensitively", async () => {
    const target = seed.locations[0]!;
    const fragment = target.name.slice(4, 16).toLowerCase();
    const results = await searchLocations(db, { query: fragment, limit: 100 });
    expect(results.map((r) => r.id)).toContain(target.id);
  });
});

describe("getLocationDetails", () => {
  it("returns location fields with review stats and recent reviews", async () => {
    const target = seed.locations[0]!;
    const targetReviews = seed.reviews.filter((r) => r.locationId === target.id);

    const details = await getLocationDetails(db, target.id!);
    expect(details).not.toBeNull();
    expect(details!.name).toBe(target.name);
    expect(details!.slug).toBe(target.slug);
    expect(details!.brandName).toBe("Copper Kettle Coffee");
    expect(details!.openedAt).toBe(target.openedAt);
    expect(details!.reviewCount).toBe(targetReviews.length);

    if (targetReviews.length > 0) {
      const expectedAvg =
        Math.round(
          (targetReviews.reduce((sum, r) => sum + r.rating, 0) / targetReviews.length) * 100,
        ) / 100;
      expect(details!.avgRating).toBe(expectedAvg);
      expect(details!.recentReviews).toHaveLength(Math.min(5, targetReviews.length));
      const timestamps = details!.recentReviews.map((r) => Date.parse(r.createdAt));
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
    } else {
      expect(details!.avgRating).toBeNull();
      expect(details!.recentReviews).toHaveLength(0);
    }
  });

  it("returns null for an unknown id", async () => {
    expect(await getLocationDetails(db, 99999)).toBeNull();
  });
});

describe("aggregateMetrics", () => {
  it("sums the full window across all locations", async () => {
    const expected = sumMetrics(seed.dailyMetrics);
    const locationsWithMetrics = new Set(seed.dailyMetrics.map((m) => m.locationId));

    const result = await aggregateMetrics(db, {
      from: WINDOW_START,
      to: SEED_END_DATE,
    });

    expect(result.totalRevenueCents).toBe(expected.revenue);
    expect(result.totalTransactions).toBe(expected.transactions);
    expect(result.totalFootTraffic).toBe(expected.footTraffic);
    expect(result.locationCount).toBe(locationsWithMetrics.size);
    expect(result.avgTicketCents).toBe(Math.round(expected.revenue / expected.transactions));
  });

  it("filters by brand and date sub-range", async () => {
    const brandLocationIds = new Set(
      seed.locations.filter((l) => l.brandId === 3).map((l) => l.id!),
    );
    const from = "2026-06-01";
    const expectedRows = seed.dailyMetrics.filter(
      (m) => brandLocationIds.has(m.locationId) && m.date >= from && m.date <= SEED_END_DATE,
    );
    const expected = sumMetrics(expectedRows);

    const result = await aggregateMetrics(db, {
      from,
      to: SEED_END_DATE,
      brandSlug: "verde-taqueria",
    });

    expect(result.totalRevenueCents).toBe(expected.revenue);
    expect(result.totalTransactions).toBe(expected.transactions);
  });

  it("returns zeros and a null avg ticket for an empty range", async () => {
    const result = await aggregateMetrics(db, {
      from: "2020-01-01",
      to: "2020-12-31",
    });
    expect(result.totalRevenueCents).toBe(0);
    expect(result.locationCount).toBe(0);
    expect(result.avgTicketCents).toBeNull();
  });
});

describe("compareLocations", () => {
  it("returns per-location totals ordered by revenue", async () => {
    const openIds = seed.locations
      .filter((l) => l.status === "open")
      .slice(0, 3)
      .map((l) => l.id!);

    const results = await compareLocations(db, {
      locationIds: openIds,
      from: WINDOW_START,
      to: SEED_END_DATE,
    });

    expect(results).toHaveLength(3);
    const revenues = results.map((r) => r.totalRevenueCents);
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a));

    for (const row of results) {
      const expected = sumMetrics(seed.dailyMetrics.filter((m) => m.locationId === row.locationId));
      expect(row.totalRevenueCents).toBe(expected.revenue);
      expect(row.totalTransactions).toBe(expected.transactions);
      expect(row.totalFootTraffic).toBe(expected.footTraffic);
    }
  });

  it("skips unknown ids and returns [] for an empty request", async () => {
    const known = seed.locations[0]!.id!;
    const results = await compareLocations(db, {
      locationIds: [known, 99999],
      from: WINDOW_START,
      to: SEED_END_DATE,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.locationId).toBe(known);

    expect(
      await compareLocations(db, {
        locationIds: [],
        from: WINDOW_START,
        to: SEED_END_DATE,
      }),
    ).toEqual([]);
  });
});
