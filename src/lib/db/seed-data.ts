import type { brands, dailyMetrics, locations, reviews } from "./schema";

// Pure, deterministic seed-data generation. No I/O, no clock, no
// Math.random — everything derives from the RNG seed and SEED_END_DATE, so
// eval fixtures, tests, and the live database all see identical data.
// scripts/seed.ts owns the actual writing.

export type BrandInsert = typeof brands.$inferInsert;
export type LocationInsert = typeof locations.$inferInsert;
export type ReviewInsert = typeof reviews.$inferInsert;
export type DailyMetricInsert = typeof dailyMetrics.$inferInsert;

export interface SeedData {
  brands: BrandInsert[];
  locations: LocationInsert[];
  reviews: ReviewInsert[];
  dailyMetrics: DailyMetricInsert[];
}

export const DEFAULT_SEED = 42;

// Metrics cover the 365 days ending here. Fixed (never "today") so the
// dataset is identical no matter when the seed runs.
export const SEED_END_DATE = "2026-06-30";
export const METRIC_DAYS = 365;
// Closed locations stop reporting partway through the window.
export const CLOSED_METRIC_DAYS = 180;

const DAY_MS = 86_400_000;

// mulberry32 — tiny, fast, good-enough statistical quality for fixtures.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BrandSpec {
  name: string;
  slug: string;
  category: string;
  /** integer cents */
  ticketRangeCents: [number, number];
  /** baseline transactions per day */
  txRange: [number, number];
  weekendFactor: number;
  seasonalAmp: number;
  /** day-of-year where seasonal demand peaks */
  seasonalPeakDay: number;
}

const BRAND_SPECS: BrandSpec[] = [
  {
    name: "Copper Kettle Coffee",
    slug: "copper-kettle-coffee",
    category: "coffee",
    ticketRangeCents: [550, 950],
    txRange: [120, 260],
    weekendFactor: 1.15,
    seasonalAmp: 0.1,
    seasonalPeakDay: 15, // mid-January: cold weather, hot drinks
  },
  {
    name: "Ironworks Fitness",
    slug: "ironworks-fitness",
    category: "fitness",
    ticketRangeCents: [2500, 4500],
    txRange: [25, 70],
    weekendFactor: 0.8,
    seasonalAmp: 0.2,
    seasonalPeakDay: 20, // New Year's resolution surge
  },
  {
    name: "Verde Taqueria",
    slug: "verde-taqueria",
    category: "fast_casual",
    ticketRangeCents: [1200, 1900],
    txRange: [90, 220],
    weekendFactor: 1.25,
    seasonalAmp: 0.08,
    seasonalPeakDay: 180,
  },
  {
    name: "Bluebird Bakery",
    slug: "bluebird-bakery",
    category: "bakery",
    ticketRangeCents: [800, 1400],
    txRange: [60, 150],
    weekendFactor: 1.35,
    seasonalAmp: 0.15,
    seasonalPeakDay: 350, // holiday orders
  },
  {
    name: "Summit Outfitters",
    slug: "summit-outfitters",
    category: "outdoor_retail",
    ticketRangeCents: [6500, 14000],
    txRange: [15, 45],
    weekendFactor: 1.4,
    seasonalAmp: 0.25,
    seasonalPeakDay: 165, // early-summer trail season
  },
];

// First day of the metrics window — everything between this and SEED_END_DATE
// (inclusive) has data. Exported so tool descriptions can state the window.
export const SEED_START_DATE = isoDate(utcMsOf(SEED_END_DATE) - (METRIC_DAYS - 1) * DAY_MS);

// The valid brand-slug vocabulary; tool input schemas expose it as an enum so
// the model can only pass slugs that exist.
export const BRAND_SLUGS = BRAND_SPECS.map((spec) => spec.slug);

const LOCATIONS_PER_BRAND = 10;

interface CitySpec {
  city: string;
  state: string;
  lat: number;
  lng: number;
  zipPrefix: string;
  areaCode: string;
}

const CITIES: CitySpec[] = [
  { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431, zipPrefix: "787", areaCode: "512" },
  { city: "Dallas", state: "TX", lat: 32.7767, lng: -96.797, zipPrefix: "752", areaCode: "214" },
  { city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698, zipPrefix: "770", areaCode: "713" },
  { city: "Denver", state: "CO", lat: 39.7392, lng: -104.9903, zipPrefix: "802", areaCode: "303" },
  { city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.074, zipPrefix: "850", areaCode: "602" },
  {
    city: "San Diego",
    state: "CA",
    lat: 32.7157,
    lng: -117.1611,
    zipPrefix: "921",
    areaCode: "619",
  },
  {
    city: "Portland",
    state: "OR",
    lat: 45.5152,
    lng: -122.6784,
    zipPrefix: "972",
    areaCode: "503",
  },
  {
    city: "Nashville",
    state: "TN",
    lat: 36.1627,
    lng: -86.7816,
    zipPrefix: "372",
    areaCode: "615",
  },
  {
    city: "Charlotte",
    state: "NC",
    lat: 35.2271,
    lng: -80.8431,
    zipPrefix: "282",
    areaCode: "704",
  },
  { city: "Columbus", state: "OH", lat: 39.9612, lng: -82.9988, zipPrefix: "432", areaCode: "614" },
];

const NEIGHBORHOODS = [
  "Downtown",
  "Midtown",
  "Uptown",
  "Riverside",
  "Old Town",
  "Eastside",
  "Westgate",
  "Northpark",
  "Southline",
  "Lakeview",
];

const STREETS = [
  "Main St",
  "Congress Ave",
  "Oak Blvd",
  "5th St",
  "Market St",
  "Cedar Ln",
  "Union Ave",
  "Broadway",
  "Elm St",
  "Commerce St",
  "Pearl St",
  "Willow Dr",
];

const FIRST_NAMES = [
  "Maria",
  "James",
  "Aisha",
  "Carlos",
  "Emily",
  "Dmitri",
  "Priya",
  "Tom",
  "Keisha",
  "Liam",
  "Sofia",
  "Noah",
  "Grace",
  "Andre",
  "Hannah",
  "Miguel",
];

const LAST_NAMES = [
  "Garcia",
  "Smith",
  "Johnson",
  "Nguyen",
  "Patel",
  "Brown",
  "Kim",
  "Lopez",
  "Walker",
  "Chen",
  "Davis",
  "Okafor",
  "Martinez",
  "Wilson",
  "Ali",
  "Reed",
];

// Keyed 1–5 by star rating.
const REVIEW_TEMPLATES: Record<number, string[]> = {
  1: [
    "Terrible experience. Waited forever and the staff seemed completely checked out.",
    "Would not come back. The place was dirty and nobody seemed to care.",
    "Really disappointing visit. Nothing like the other locations I've been to.",
    "Awful. They got my order wrong twice and didn't apologize.",
  ],
  2: [
    "Below average. The service was slow even though it wasn't busy.",
    "Not great. Quality has really slipped over the past few months.",
    "Meh. Overpriced for what you get, and the location feels run down.",
    "Expected more. Staff were fine but the experience was sloppy.",
  ],
  3: [
    "It's okay. Does the job but nothing memorable.",
    "Average experience — some visits are great, some aren't.",
    "Decent spot. Parking is rough during peak hours though.",
    "Fine for a quick stop. Wouldn't go out of my way for it.",
  ],
  4: [
    "Really solid. Friendly staff and consistent quality.",
    "Great spot! Gets busy on weekends but the line moves fast.",
    "One of my regular stops. Clean, quick, and reliable.",
    "Very good experience overall. Prices are fair for the area.",
  ],
  5: [
    "Absolutely love this place. Best location in the city by far.",
    "Outstanding every single time. The team here really cares.",
    "My favorite spot in the neighborhood — can't recommend it enough.",
    "Five stars. Fast, friendly, and the quality never dips.",
  ],
};

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function utcMsOf(iso: string): number {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateSeedData(seed: number = DEFAULT_SEED): SeedData {
  const rng = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)]!;

  const endMs = utcMsOf(SEED_END_DATE);
  const windowStartMs = endMs - (METRIC_DAYS - 1) * DAY_MS;

  const brandRows: BrandInsert[] = BRAND_SPECS.map((spec, i) => ({
    id: i + 1,
    name: spec.name,
    slug: spec.slug,
    category: spec.category,
    createdAt: new Date(Date.UTC(2016 + i, 2, 1)),
  }));

  const locationRows: LocationInsert[] = [];
  const reviewRows: ReviewInsert[] = [];
  const metricRows: DailyMetricInsert[] = [];

  interface LocationEconomics {
    locationId: number;
    brand: BrandSpec;
    status: "open" | "closed" | "coming_soon";
    quality: number;
    ticketCents: number;
    baseTx: number;
    openedAtMs: number;
  }
  const economics: LocationEconomics[] = [];

  const usedSlugs = new Set<string>();
  let locationId = 0;

  for (const [brandIndex, brand] of BRAND_SPECS.entries()) {
    for (let i = 0; i < LOCATIONS_PER_BRAND; i++) {
      locationId++;
      const city = pick(CITIES);

      let neighborhood = pick(NEIGHBORHOODS);
      let slug = slugify(`${brand.slug}-${city.city}-${neighborhood}`);
      while (usedSlugs.has(slug)) {
        neighborhood = pick(NEIGHBORHOODS);
        slug = slugify(`${brand.slug}-${city.city}-${neighborhood}`);
      }
      usedSlugs.add(slug);

      const roll = rng();
      const status: LocationEconomics["status"] =
        roll < 0.08 ? "closed" : roll < 0.14 ? "coming_soon" : "open";

      // Operating locations opened before the metrics window starts, so a
      // full year of data is always coherent with the opening date.
      const openedAtMs =
        status === "coming_soon"
          ? Date.UTC(2026, int(8, 11), int(1, 28))
          : Date.UTC(int(2017, 2024), int(0, 11), int(1, 28));

      // Quality drives both revenue and review sentiment, so "why is this
      // location's rating low" questions have a discoverable answer.
      const quality = 0.75 + rng() * 0.5;

      locationRows.push({
        id: locationId,
        brandId: brandIndex + 1,
        name: `${brand.name} — ${neighborhood} ${city.city}`,
        slug,
        addressLine1: `${int(100, 9899)} ${pick(STREETS)}`,
        city: city.city,
        state: city.state,
        postalCode: `${city.zipPrefix}${String(int(1, 99)).padStart(2, "0")}`,
        lat: Number((city.lat + (rng() - 0.5) * 0.18).toFixed(6)),
        lng: Number((city.lng + (rng() - 0.5) * 0.18).toFixed(6)),
        phone: `(${city.areaCode}) 555-${String(100 + locationId).padStart(4, "0")}`,
        status,
        openedAt: isoDate(openedAtMs),
      });

      economics.push({
        locationId,
        brand,
        status,
        quality,
        ticketCents: int(brand.ticketRangeCents[0], brand.ticketRangeCents[1]),
        baseTx: int(brand.txRange[0], brand.txRange[1]),
        openedAtMs,
      });
    }
  }

  let reviewId = 0;
  for (const loc of economics) {
    if (loc.status === "coming_soon") continue;

    const reviewCount = int(6, 24);
    for (let i = 0; i < reviewCount; i++) {
      reviewId++;
      // Shift the rating distribution by location quality.
      const roll = rng() + (loc.quality - 1) * 0.6;
      const rating = roll > 0.72 ? 5 : roll > 0.48 ? 4 : roll > 0.3 ? 3 : roll > 0.16 ? 2 : 1;

      let createdMs = endMs - int(0, 540) * DAY_MS - int(0, 23) * 3_600_000;
      if (createdMs < loc.openedAtMs) {
        createdMs = Math.min(loc.openedAtMs + int(3, 60) * DAY_MS, endMs);
      }

      const sourceRoll = rng();
      reviewRows.push({
        id: reviewId,
        locationId: loc.locationId,
        rating,
        text: pick(REVIEW_TEMPLATES[rating]!),
        authorName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        source: sourceRoll < 0.5 ? "google" : sourceRoll < 0.8 ? "yelp" : "in_app",
        createdAt: new Date(createdMs),
      });
    }
  }

  let metricId = 0;
  for (const loc of economics) {
    if (loc.status === "coming_soon") continue;
    const days = loc.status === "closed" ? CLOSED_METRIC_DAYS : METRIC_DAYS;

    for (let d = 0; d < days; d++) {
      metricId++;
      const dayMs = windowStartMs + d * DAY_MS;
      const dayDate = new Date(dayMs);
      const dow = dayDate.getUTCDay();
      const dayOfYear = Math.floor((dayMs - Date.UTC(dayDate.getUTCFullYear(), 0, 1)) / DAY_MS);

      const weekendFactor = dow === 0 || dow === 6 ? loc.brand.weekendFactor : 1;
      const seasonal =
        1 +
        loc.brand.seasonalAmp *
          Math.cos(((dayOfYear - loc.brand.seasonalPeakDay) / 365) * 2 * Math.PI);
      const noise = 0.85 + rng() * 0.3;

      const transactions = Math.max(
        0,
        Math.round(loc.baseTx * loc.quality * weekendFactor * seasonal * noise),
      );
      const ticketJitter = 0.9 + rng() * 0.2;

      metricRows.push({
        id: metricId,
        locationId: loc.locationId,
        date: isoDate(dayMs),
        revenueCents: Math.round(transactions * loc.ticketCents * ticketJitter),
        transactions,
        footTraffic: Math.round(transactions * (2.2 + rng() * 1.8)),
      });
    }
  }

  return {
    brands: brandRows,
    locations: locationRows,
    reviews: reviewRows,
    dailyMetrics: metricRows,
  };
}
