// Domain types that cross module boundaries: lib/db returns them, lib/mcp
// tools emit them, and the generative-UI registry renders them. Nothing
// outside lib/db may import Drizzle row types — mapping happens at the
// lib/db boundary (see src/lib/db/README.md).

export type LocationStatus = "open" | "closed" | "coming_soon";

export type ReviewSource = "google" | "yelp" | "in_app";

export interface Brand {
  id: number;
  name: string;
  slug: string;
  category: string;
}

export interface LocationSummary {
  id: number;
  brandId: number;
  brandName: string;
  name: string;
  slug: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
  phone: string;
  status: LocationStatus;
  /** ISO date (YYYY-MM-DD) */
  openedAt: string;
}

export interface Review {
  id: number;
  rating: number;
  text: string;
  authorName: string;
  source: ReviewSource;
  /** ISO 8601 timestamp */
  createdAt: string;
}

export interface LocationDetails extends LocationSummary {
  reviewCount: number;
  /** null when the location has no reviews */
  avgRating: number | null;
  recentReviews: Review[];
}

export interface MetricsAggregate {
  /** ISO date (YYYY-MM-DD), inclusive */
  from: string;
  /** ISO date (YYYY-MM-DD), inclusive */
  to: string;
  locationCount: number;
  totalRevenueCents: number;
  totalTransactions: number;
  totalFootTraffic: number;
  /** revenue / transactions; null when there were no transactions */
  avgTicketCents: number | null;
}

export interface LocationComparison {
  locationId: number;
  locationName: string;
  city: string;
  state: string;
  totalRevenueCents: number;
  totalTransactions: number;
  totalFootTraffic: number;
  /** revenue / transactions; null when there were no transactions */
  avgTicketCents: number | null;
  /** null when the location has no reviews */
  avgRating: number | null;
}
