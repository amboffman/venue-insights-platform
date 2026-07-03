import {
  and,
  avg,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
  LocationComparison,
  LocationDetails,
  LocationStatus,
  LocationSummary,
  MetricsAggregate,
  Review,
} from "../types/domain";
import type { Database } from "./client";
import { brands, dailyMetrics, locations, reviews } from "./schema";

// Every function takes the Database handle as its first argument (see
// client.ts) and returns domain types from ../types/domain — Drizzle row
// shapes stop at this file.

const locationSummaryColumns = {
  id: locations.id,
  brandId: locations.brandId,
  brandName: brands.name,
  name: locations.name,
  slug: locations.slug,
  addressLine1: locations.addressLine1,
  city: locations.city,
  state: locations.state,
  postalCode: locations.postalCode,
  lat: locations.lat,
  lng: locations.lng,
  phone: locations.phone,
  status: locations.status,
  openedAt: locations.openedAt,
};

// Postgres sum() over int returns bigint, which the driver hands back as a
// string; coalesce + mapWith(Number) gives a real 0-defaulted JS number.
const sumAsNumber = (column: AnyPgColumn) =>
  sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

function avgTicketCents(totalRevenueCents: number, totalTransactions: number): number | null {
  return totalTransactions > 0 ? Math.round(totalRevenueCents / totalTransactions) : null;
}

/** The rating precision rule, in exactly one place — the eval golden data
 * imports this so expected ratings can never drift from the SQL's rounding. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Model-supplied filter text goes into ILIKE patterns; without escaping, a
// stray % or _ acts as a wildcard ("%" as a city matches every location).
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface SearchLocationsFilters {
  /** case-insensitive substring match on location name */
  query?: string;
  brandSlug?: string;
  /** case-insensitive exact match, e.g. "Austin" */
  city?: string;
  /** two-letter code, e.g. "TX" */
  state?: string;
  status?: LocationStatus;
  /** default 20, max 100 */
  limit?: number;
}

export async function searchLocations(
  db: Database,
  filters: SearchLocationsFilters = {},
): Promise<LocationSummary[]> {
  const conditions = [];
  if (filters.query) {
    conditions.push(ilike(locations.name, `%${escapeLike(filters.query)}%`));
  }
  if (filters.brandSlug) {
    conditions.push(eq(brands.slug, filters.brandSlug));
  }
  if (filters.city) {
    // escaped ilike = case-insensitive equality; the model will pass
    // user-typed city names.
    conditions.push(ilike(locations.city, escapeLike(filters.city)));
  }
  if (filters.state) {
    conditions.push(eq(locations.state, filters.state.toUpperCase()));
  }
  if (filters.status) {
    conditions.push(eq(locations.status, filters.status));
  }

  return db
    .select(locationSummaryColumns)
    .from(locations)
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(locations.name)
    .limit(Math.min(filters.limit ?? 20, 100));
}

export async function getLocationDetails(
  db: Database,
  id: number,
): Promise<LocationDetails | null> {
  const [location] = await db
    .select(locationSummaryColumns)
    .from(locations)
    .innerJoin(brands, eq(locations.brandId, brands.id))
    .where(eq(locations.id, id))
    .limit(1);
  if (!location) return null;

  const [stats] = await db
    .select({
      reviewCount: count(reviews.id),
      avgRating: avg(reviews.rating),
    })
    .from(reviews)
    .where(eq(reviews.locationId, id));

  const recentRows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.locationId, id))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(5);

  const recentReviews: Review[] = recentRows.map((row) => ({
    id: row.id,
    rating: row.rating,
    text: row.text,
    authorName: row.authorName,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    ...location,
    reviewCount: stats?.reviewCount ?? 0,
    avgRating: stats?.avgRating == null ? null : round2(Number(stats.avgRating)),
    recentReviews,
  };
}

export interface AggregateMetricsInput {
  /** ISO date (YYYY-MM-DD), inclusive */
  from: string;
  /** ISO date (YYYY-MM-DD), inclusive */
  to: string;
  brandSlug?: string;
  locationIds?: number[];
}

export async function aggregateMetrics(
  db: Database,
  input: AggregateMetricsInput,
): Promise<MetricsAggregate> {
  // An explicitly empty location set means "these zero locations", not
  // "no filter" — silently widening to the whole portfolio would hand the
  // model grounded-looking numbers for a set that matched nothing.
  if (input.locationIds && input.locationIds.length === 0) {
    return {
      from: input.from,
      to: input.to,
      locationCount: 0,
      totalRevenueCents: 0,
      totalTransactions: 0,
      totalFootTraffic: 0,
      avgTicketCents: null,
    };
  }

  const conditions = [gte(dailyMetrics.date, input.from), lte(dailyMetrics.date, input.to)];
  if (input.brandSlug) {
    conditions.push(eq(brands.slug, input.brandSlug));
  }
  if (input.locationIds) {
    conditions.push(inArray(dailyMetrics.locationId, input.locationIds));
  }

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
    .where(and(...conditions));

  const totals = row ?? {
    locationCount: 0,
    totalRevenueCents: 0,
    totalTransactions: 0,
    totalFootTraffic: 0,
  };

  return {
    from: input.from,
    to: input.to,
    ...totals,
    avgTicketCents: avgTicketCents(totals.totalRevenueCents, totals.totalTransactions),
  };
}

export interface CompareLocationsInput {
  locationIds: number[];
  /** ISO date (YYYY-MM-DD), inclusive */
  from: string;
  /** ISO date (YYYY-MM-DD), inclusive */
  to: string;
}

/** Returns one row per existing location, ordered by total revenue (desc). */
export async function compareLocations(
  db: Database,
  input: CompareLocationsInput,
): Promise<LocationComparison[]> {
  if (input.locationIds.length === 0) return [];

  const locationRows = await db
    .select({
      id: locations.id,
      name: locations.name,
      city: locations.city,
      state: locations.state,
    })
    .from(locations)
    .where(inArray(locations.id, input.locationIds));

  const metricRows = await db
    .select({
      locationId: dailyMetrics.locationId,
      totalRevenueCents: sumAsNumber(dailyMetrics.revenueCents),
      totalTransactions: sumAsNumber(dailyMetrics.transactions),
      totalFootTraffic: sumAsNumber(dailyMetrics.footTraffic),
    })
    .from(dailyMetrics)
    .where(
      and(
        inArray(dailyMetrics.locationId, input.locationIds),
        gte(dailyMetrics.date, input.from),
        lte(dailyMetrics.date, input.to),
      ),
    )
    .groupBy(dailyMetrics.locationId);

  const ratingRows = await db
    .select({
      locationId: reviews.locationId,
      avgRating: avg(reviews.rating),
    })
    .from(reviews)
    .where(inArray(reviews.locationId, input.locationIds))
    .groupBy(reviews.locationId);

  const metricsByLocation = new Map(metricRows.map((m) => [m.locationId, m]));
  const ratingByLocation = new Map(ratingRows.map((r) => [r.locationId, r.avgRating]));

  return locationRows
    .map((location): LocationComparison => {
      const metrics = metricsByLocation.get(location.id);
      const rating = ratingByLocation.get(location.id);
      const totalRevenueCents = metrics?.totalRevenueCents ?? 0;
      const totalTransactions = metrics?.totalTransactions ?? 0;
      return {
        locationId: location.id,
        locationName: location.name,
        city: location.city,
        state: location.state,
        totalRevenueCents,
        totalTransactions,
        totalFootTraffic: metrics?.totalFootTraffic ?? 0,
        avgTicketCents: avgTicketCents(totalRevenueCents, totalTransactions),
        avgRating: rating == null ? null : round2(Number(rating)),
      };
    })
    .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);
}
