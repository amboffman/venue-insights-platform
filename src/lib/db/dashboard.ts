import { and, countDistinct, desc, eq, gte, lte, sql } from "drizzle-orm";

import type {
  BrandOption,
  BrandRevenue,
  CityOption,
  DashboardFilters,
  DashboardKpis,
  MonthlyRevenue,
  TopLocationRow,
} from "../types/dashboard";
import type { Database } from "./client";
import { sumAsNumber } from "./queries";
import { brands, dailyMetrics, locations } from "./schema";

// Rollup queries for the stakeholder dashboard (ADR-0009). Same layer rules
// as queries.ts: Database handle first, domain types out, SQL stops here.
// Every rollup takes the SAME filter shape and joins the same spine
// (daily_metrics → locations → brands), so KPI tiles, charts, and the table
// always agree — the dataviz rule that filters scope everything below them.

function metricConditions(filters: DashboardFilters) {
  const conditions = [gte(dailyMetrics.date, filters.from), lte(dailyMetrics.date, filters.to)];
  // Filter values come from our own selects (the seeded vocabulary), not
  // free text — exact equality, no ILIKE machinery needed here.
  if (filters.brandSlug) conditions.push(eq(brands.slug, filters.brandSlug));
  if (filters.city) conditions.push(eq(locations.city, filters.city));
  return and(...conditions);
}

export async function dashboardKpis(
  db: Database,
  filters: DashboardFilters,
): Promise<DashboardKpis> {
  const [row] = await db
    .select({
      locationCount: countDistinct(dailyMetrics.locationId),
      totalRevenueCents: sumAsNumber(dailyMetrics.revenueCents),
      totalTransactions: sumAsNumber(dailyMetrics.transactions),
      totalFootTraffic: sumAsNumber(dailyMetrics.footTraffic),
    })
    .from(dailyMetrics)
    .innerJoin(locations, eq(dailyMetrics.locationId, locations.id))
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(metricConditions(filters));

  const totals = row ?? {
    locationCount: 0,
    totalRevenueCents: 0,
    totalTransactions: 0,
    totalFootTraffic: 0,
  };
  return {
    ...totals,
    avgTicketCents:
      totals.totalTransactions > 0
        ? Math.round(totals.totalRevenueCents / totals.totalTransactions)
        : null,
  };
}

export async function revenueByBrand(
  db: Database,
  filters: DashboardFilters,
): Promise<BrandRevenue[]> {
  const revenue = sumAsNumber(dailyMetrics.revenueCents);
  return db
    .select({ brandSlug: brands.slug, brandName: brands.name, revenueCents: revenue })
    .from(dailyMetrics)
    .innerJoin(locations, eq(dailyMetrics.locationId, locations.id))
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(metricConditions(filters))
    .groupBy(brands.id, brands.slug, brands.name)
    .orderBy(desc(revenue), brands.name);
}

export async function monthlyRevenue(
  db: Database,
  filters: DashboardFilters,
): Promise<MonthlyRevenue[]> {
  // No bind parameters inside the expression, so SELECT/GROUP BY render
  // identically (the jsonb GROUP BY lesson from the spans queries).
  const month = sql<string>`to_char(${dailyMetrics.date}, 'YYYY-MM')`;
  return db
    .select({ month, revenueCents: sumAsNumber(dailyMetrics.revenueCents) })
    .from(dailyMetrics)
    .innerJoin(locations, eq(dailyMetrics.locationId, locations.id))
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(metricConditions(filters))
    .groupBy(month)
    .orderBy(month);
}

export async function topLocations(
  db: Database,
  filters: DashboardFilters,
  limit = 8,
): Promise<TopLocationRow[]> {
  const revenue = sumAsNumber(dailyMetrics.revenueCents);
  return db
    .select({
      id: locations.id,
      name: locations.name,
      brandName: brands.name,
      city: locations.city,
      state: locations.state,
      revenueCents: revenue,
      transactions: sumAsNumber(dailyMetrics.transactions),
    })
    .from(dailyMetrics)
    .innerJoin(locations, eq(dailyMetrics.locationId, locations.id))
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(metricConditions(filters))
    .groupBy(locations.id, locations.name, brands.name, locations.city, locations.state)
    .orderBy(desc(revenue), locations.name)
    .limit(limit);
}

export async function brandOptions(db: Database): Promise<BrandOption[]> {
  return db.select({ slug: brands.slug, name: brands.name }).from(brands).orderBy(brands.name);
}

export async function cityOptions(db: Database): Promise<CityOption[]> {
  return db
    .selectDistinct({ city: locations.city, state: locations.state })
    .from(locations)
    .orderBy(locations.city);
}
