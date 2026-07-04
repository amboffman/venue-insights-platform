import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  brandOptions,
  cityOptions,
  dashboardKpis,
  monthlyRevenue,
  revenueByBrand,
  topLocations,
} from "@/lib/db/dashboard";
import { SEED_END_DATE, SEED_START_DATE } from "@/lib/db/seed-data";
import type { DashboardFilters } from "@/lib/types/dashboard";

import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// Every expected number is computed independently in TypeScript from the
// seed arrays (filter + reduce) and compared against the SQL — two
// implementations agreeing, the queries.test.ts pattern.

const FULL: DashboardFilters = { from: SEED_START_DATE, to: SEED_END_DATE };

describe("dashboard rollups", () => {
  let seeded: SeededDb;

  beforeAll(async () => {
    seeded = await createSeededDb();
  });

  afterAll(async () => {
    await seeded.close();
  });

  function metricsIn(filters: DashboardFilters) {
    const locationsById = new Map(seeded.seed.locations.map((l) => [l.id!, l]));
    const brandsById = new Map(seeded.seed.brands.map((b) => [b.id!, b]));
    return seeded.seed.dailyMetrics.filter((m) => {
      if (m.date < filters.from || m.date > filters.to) return false;
      const location = locationsById.get(m.locationId)!;
      if (filters.city && location.city !== filters.city) return false;
      if (filters.brandSlug && brandsById.get(location.brandId)!.slug !== filters.brandSlug) {
        return false;
      }
      return true;
    });
  }

  it("portfolio KPIs match a hand computation over the seed", async () => {
    const rows = metricsIn(FULL);
    const revenue = rows.reduce((acc, m) => acc + m.revenueCents, 0);
    const transactions = rows.reduce((acc, m) => acc + m.transactions, 0);

    const kpis = await dashboardKpis(seeded.db, FULL);
    expect(kpis.totalRevenueCents).toBe(revenue);
    expect(kpis.totalTransactions).toBe(transactions);
    expect(kpis.totalFootTraffic).toBe(rows.reduce((acc, m) => acc + m.footTraffic, 0));
    expect(kpis.locationCount).toBe(new Set(rows.map((m) => m.locationId)).size);
    expect(kpis.avgTicketCents).toBe(Math.round(revenue / transactions));
  });

  it("brand and date filters scope the KPIs to the slice", async () => {
    const brand = seeded.seed.brands[0]!;
    const filters: DashboardFilters = {
      from: "2026-01-01",
      to: "2026-03-31",
      brandSlug: brand.slug,
    };
    const rows = metricsIn(filters);

    const kpis = await dashboardKpis(seeded.db, filters);
    expect(kpis.totalRevenueCents).toBe(rows.reduce((acc, m) => acc + m.revenueCents, 0));
    expect(kpis.locationCount).toBe(new Set(rows.map((m) => m.locationId)).size);
  });

  it("city filter scopes to one city's locations", async () => {
    const city = seeded.seed.locations[0]!.city;
    const filters: DashboardFilters = { ...FULL, city };
    const rows = metricsIn(filters);

    const kpis = await dashboardKpis(seeded.db, filters);
    expect(kpis.totalRevenueCents).toBe(rows.reduce((acc, m) => acc + m.revenueCents, 0));
    expect(kpis.locationCount).toBeGreaterThan(0);
  });

  it("revenueByBrand covers every brand, sums exactly, sorts descending", async () => {
    const result = await revenueByBrand(seeded.db, FULL);
    expect(result).toHaveLength(seeded.seed.brands.length);

    for (const brand of seeded.seed.brands) {
      const expected = metricsIn({ ...FULL, brandSlug: brand.slug }).reduce(
        (acc, m) => acc + m.revenueCents,
        0,
      );
      expect(result.find((row) => row.brandSlug === brand.slug)?.revenueCents).toBe(expected);
    }

    const sorted = [...result].sort((a, b) => b.revenueCents - a.revenueCents);
    expect(result.map((r) => r.brandSlug)).toEqual(sorted.map((r) => r.brandSlug));
  });

  it("monthlyRevenue buckets by month, ordered, reconciling to the total", async () => {
    const result = await monthlyRevenue(seeded.db, FULL);

    const oracle = new Map<string, number>();
    for (const m of metricsIn(FULL)) {
      const month = m.date.slice(0, 7);
      oracle.set(month, (oracle.get(month) ?? 0) + m.revenueCents);
    }

    expect(result).toHaveLength(oracle.size);
    expect(result.map((r) => r.month)).toEqual([...oracle.keys()].sort());
    for (const row of result) {
      expect(row.revenueCents).toBe(oracle.get(row.month));
    }
  });

  it("topLocations ranks by revenue and applies the limit", async () => {
    const result = await topLocations(seeded.db, FULL, 5);
    expect(result).toHaveLength(5);

    const byLocation = new Map<number, number>();
    for (const m of metricsIn(FULL)) {
      byLocation.set(m.locationId, (byLocation.get(m.locationId) ?? 0) + m.revenueCents);
    }
    const names = new Map(seeded.seed.locations.map((l) => [l.id!, l.name]));
    const expected = [...byLocation.entries()]
      .map(([id, revenueCents]) => ({ id, revenueCents, name: names.get(id)! }))
      .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name))
      .slice(0, 5);

    expect(result.map((r) => r.id)).toEqual(expected.map((e) => e.id));
    expect(result.map((r) => r.revenueCents)).toEqual(expected.map((e) => e.revenueCents));
  });

  it("filter vocabularies come from the seed", async () => {
    const brands = await brandOptions(seeded.db);
    expect(brands.map((b) => b.slug).sort()).toEqual(seeded.seed.brands.map((b) => b.slug).sort());

    const cities = await cityOptions(seeded.db);
    const uniquePairs = new Set(seeded.seed.locations.map((l) => `${l.city}|${l.state}`));
    expect(cities).toHaveLength(uniquePairs.size);
  });
});
