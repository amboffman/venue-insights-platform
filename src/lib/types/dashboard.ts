// Types crossing the lib/db → app boundary for the stakeholder dashboard
// (ADR-0009). Same rule as domain.ts: no Drizzle row shapes leave lib/db.

/** One filter shape scopes every dashboard query — tiles, charts, and the
 * table always answer for the same slice. */
export interface DashboardFilters {
  /** ISO date (YYYY-MM-DD), inclusive */
  from: string;
  to: string;
  brandSlug?: string;
  city?: string;
}

export interface DashboardKpis {
  locationCount: number;
  totalRevenueCents: number;
  totalTransactions: number;
  totalFootTraffic: number;
  avgTicketCents: number | null;
}

export interface BrandRevenue {
  brandSlug: string;
  brandName: string;
  revenueCents: number;
}

export interface MonthlyRevenue {
  /** "YYYY-MM" */
  month: string;
  revenueCents: number;
}

export interface TopLocationRow {
  id: number;
  name: string;
  brandName: string;
  city: string;
  state: string;
  revenueCents: number;
  transactions: number;
}

export interface BrandOption {
  slug: string;
  name: string;
}

export interface CityOption {
  city: string;
  state: string;
}
