import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums are real Postgres enum types (not text + CHECK) so Drizzle infers
// the exact union type — the DB and TypeScript can't drift apart.
export const locationStatus = pgEnum("location_status", ["open", "closed", "coming_soon"]);

export const reviewSource = pgEnum("review_source", ["google", "yelp", "in_app"]);

// Identity PKs are "by default" (not "always") so the deterministic seed can
// insert explicit stable IDs; nothing else in the app writes rows.
export const brands = pgTable("brands", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locations = pgTable(
  "locations",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    addressLine1: text("address_line1").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    // Plain doubles, no PostGIS — see ADR-001.
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    phone: text("phone").notNull(),
    status: locationStatus("status").notNull().default("open"),
    openedAt: date("opened_at").notNull(),
  },
  (table) => [
    index("locations_brand_id_idx").on(table.brandId),
    index("locations_city_state_idx").on(table.city, table.state),
    index("locations_status_idx").on(table.status),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id),
    rating: integer("rating").notNull(),
    text: text("text").notNull(),
    authorName: text("author_name").notNull(),
    source: reviewSource("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("reviews_location_id_idx").on(table.locationId)],
);

export const spanStatus = pgEnum("span_status", ["unset", "ok", "error"]);

// OTel span mirror (ADR-0006). Deliberately generic — Claude-call spans and
// tool spans carry different attributes, so the payload lives in jsonb and
// the observability queries extract the keys they need. IDs are the OTel
// hex strings (16-byte trace, 8-byte span), not identities.
export const spans = pgTable(
  "spans",
  {
    spanId: text("span_id").primaryKey(),
    traceId: text("trace_id").notNull(),
    parentSpanId: text("parent_span_id"),
    name: text("name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    // Derivable from the timestamps; denormalized because every dashboard
    // query aggregates on it.
    durationMs: doublePrecision("duration_ms").notNull(),
    status: spanStatus("status").notNull(),
    statusMessage: text("status_message"),
    attributes: jsonb("attributes").notNull(),
  },
  (table) => [
    // One turn = one trace: the dashboard's grouping key.
    index("spans_trace_id_idx").on(table.traceId),
    index("spans_name_idx").on(table.name),
    index("spans_started_at_idx").on(table.startedAt),
  ],
);

// Fixed-window abuse counters for public endpoints (ADR-0007): one row per
// (scope, window), upsert-incremented; expired rows are purged
// opportunistically on each hit, so no scheduler is needed.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id),
    date: date("date").notNull(),
    // Money is integer cents, never floats — see ADR-001.
    revenueCents: integer("revenue_cents").notNull(),
    transactions: integer("transactions").notNull(),
    footTraffic: integer("foot_traffic").notNull(),
  },
  (table) => [
    // The invariant that makes aggregation trustworthy: one row per
    // location per day.
    uniqueIndex("daily_metrics_location_date_idx").on(table.locationId, table.date),
  ],
);
