import { round2 } from "../db/queries";
import {
  SEED_END_DATE,
  SEED_START_DATE,
  generateSeedData,
  type LocationInsert,
} from "../db/seed-data";
import type { EvalCase, ExpectedFact } from "./types";

// The golden dataset (~25 cases). Every expected value is COMPUTED from
// generateSeedData() — the same pure generator that seeded the database —
// so the dataset can never drift from the data (ADR-0005). Questions pin
// explicit date ranges wherever an argument is scored, because you can only
// assert arguments the question actually determines.

const seed = generateSeedData();

const H1_FROM = "2026-01-01";
const H1_TO = "2026-06-30";
const JUNE_FROM = "2026-06-01";
const JUNE_TO = "2026-06-30";

function sumMetrics(locationIds: Set<number>, from: string, to: string) {
  return seed.dailyMetrics
    .filter((m) => locationIds.has(m.locationId) && m.date >= from && m.date <= to)
    .reduce(
      (acc, m) => ({
        revenueCents: acc.revenueCents + m.revenueCents,
        transactions: acc.transactions + m.transactions,
        footTraffic: acc.footTraffic + m.footTraffic,
      }),
      { revenueCents: 0, transactions: 0, footTraffic: 0 },
    );
}

function idsOf(locations: LocationInsert[]): Set<number> {
  return new Set(locations.map((l) => l.id!));
}

/** Matches the SQL in lib/db: 2-decimal rounded mean (round2 IS the query
 * layer's rounding rule — importing it means the two can never drift), null
 * when unreviewed. */
function avgRating(locationId: number): number | null {
  const ratings = seed.reviews.filter((r) => r.locationId === locationId).map((r) => r.rating);
  if (ratings.length === 0) return null;
  return round2(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

function revenueFact(label: string, cents: number): ExpectedFact {
  return { label, value: cents, kind: "cents" };
}

function countFact(label: string, value: number): ExpectedFact {
  return { label, value, kind: "count" };
}

// --- deterministic entity pickers (seed 42, but computed, never assumed) ---

const openLocations = seed.locations.filter((l) => l.status === "open");

const cityCounts = new Map<string, number>();
for (const l of seed.locations) {
  cityCounts.set(l.city, (cityCounts.get(l.city) ?? 0) + 1);
}
const [busiestCity] = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]!;
const busiestCityLocations = seed.locations.filter((l) => l.city === busiestCity);

const txLocations = seed.locations.filter((l) => l.state === "TX");

// Brand with the most open locations — safe for "top 3" comparisons.
const openByBrand = new Map<number, LocationInsert[]>();
for (const l of openLocations) {
  openByBrand.set(l.brandId, [...(openByBrand.get(l.brandId) ?? []), l]);
}
const [topBrandId, topBrandOpen] = [...openByBrand.entries()].sort(
  (a, b) => b[1].length - a[1].length,
)[0]!;
const topBrand = seed.brands.find((b) => b.id === topBrandId)!;

const secondBrand = seed.brands.find((b) => b.id !== topBrand.id)!;
const secondBrandLocations = seed.locations.filter((l) => l.brandId === secondBrand.id);

// The most-reviewed open location — a stable subject for detail questions.
const reviewCounts = new Map<number, number>();
for (const r of seed.reviews) {
  reviewCounts.set(r.locationId, (reviewCounts.get(r.locationId) ?? 0) + 1);
}
const mostReviewed = [...openLocations].sort(
  (a, b) => (reviewCounts.get(b.id!) ?? 0) - (reviewCounts.get(a.id!) ?? 0),
)[0]!;

const [pairA, pairB] = topBrandOpen;

export function buildGoldenCases(): EvalCase[] {
  const cases: EvalCase[] = [
    // --- A. search & counts -------------------------------------------------
    {
      id: "search-city-count",
      question: `How many locations do we have in ${busiestCity}?`,
      expectedTools: [{ name: "search_locations", args: { city: busiestCity } }],
      expectedFacts: [countFact(`${busiestCity} locations`, busiestCityLocations.length)],
    },
    {
      id: "search-state-count",
      question: "How many locations are in Texas?",
      expectedTools: [{ name: "search_locations", args: { state: "TX" } }],
      expectedFacts: [countFact("TX locations", txLocations.length)],
    },
    {
      // DIAGNOSTIC: answerable only if the model raises `limit` above the
      // default 20 (the tool description now tells it to when counting) —
      // this case measures exactly that behavior, so expect it to fail on
      // weaker models rather than treating a red row as a harness bug.
      id: "search-total-count",
      question: "How many locations do we have overall, across all brands?",
      expectedTools: [{ name: "search_locations" }],
      expectedFacts: [countFact("total locations", seed.locations.length)],
    },
    {
      id: "search-brand-open",
      question: `How many ${topBrand.name} locations are currently open?`,
      expectedTools: [
        {
          name: "search_locations",
          args: { brandSlug: topBrand.slug, status: "open" },
        },
      ],
      expectedFacts: [countFact(`open ${topBrand.slug}`, topBrandOpen.length)],
    },
    {
      id: "search-coming-soon",
      question: "How many locations are coming soon?",
      expectedTools: [{ name: "search_locations", args: { status: "coming_soon" } }],
      expectedFacts: [
        countFact("coming soon", seed.locations.filter((l) => l.status === "coming_soon").length),
      ],
    },
    {
      id: "search-closed",
      question: "How many of our locations have closed?",
      expectedTools: [{ name: "search_locations", args: { status: "closed" } }],
      expectedFacts: [
        countFact("closed", seed.locations.filter((l) => l.status === "closed").length),
      ],
    },

    // --- B. location details ------------------------------------------------
    {
      id: "details-rating",
      question: `What is the average customer rating at ${mostReviewed.name}?`,
      expectedTools: [{ name: "search_locations" }, { name: "get_location_details" }],
      expectedFacts: [
        {
          label: `${mostReviewed.slug} rating`,
          value: avgRating(mostReviewed.id!)!,
          kind: "rating",
        },
      ],
    },
    {
      id: "details-review-count",
      question: `How many customer reviews does ${mostReviewed.name} have?`,
      expectedTools: [{ name: "search_locations" }, { name: "get_location_details" }],
      expectedFacts: [
        countFact(`${mostReviewed.slug} reviews`, reviewCounts.get(mostReviewed.id!) ?? 0),
      ],
    },
    {
      id: "details-address",
      question: `What is the street address and phone number of ${mostReviewed.name}?`,
      expectedTools: [{ name: "search_locations" }, { name: "get_location_details" }],
      expectedFacts: [],
    },
    {
      id: "details-status",
      question: `Is ${secondBrandLocations[0]!.name} currently open?`,
      expectedTools: [{ name: "search_locations" }],
      expectedFacts: [],
    },

    // --- C. aggregation ------------------------------------------------------
    {
      id: "agg-portfolio-revenue",
      question: `What was total revenue across all locations from ${SEED_START_DATE} to ${SEED_END_DATE}?`,
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: { from: SEED_START_DATE, to: SEED_END_DATE },
        },
      ],
      expectedFacts: [
        revenueFact(
          "portfolio revenue",
          sumMetrics(idsOf(seed.locations), SEED_START_DATE, SEED_END_DATE).revenueCents,
        ),
      ],
    },
    {
      id: "agg-brand-revenue-h1",
      question: `What was ${topBrand.name}'s total revenue from ${H1_FROM} to ${H1_TO}?`,
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: { brandSlug: topBrand.slug, from: H1_FROM, to: H1_TO },
        },
      ],
      expectedFacts: [
        revenueFact(
          `${topBrand.slug} H1 revenue`,
          sumMetrics(idsOf(seed.locations.filter((l) => l.brandId === topBrand.id)), H1_FROM, H1_TO)
            .revenueCents,
        ),
      ],
    },
    {
      id: "agg-june-transactions",
      question: `How many transactions did the whole portfolio process from ${JUNE_FROM} to ${JUNE_TO}?`,
      expectedTools: [{ name: "aggregate_metrics", args: { from: JUNE_FROM, to: JUNE_TO } }],
      expectedFacts: [
        countFact(
          "June transactions",
          sumMetrics(idsOf(seed.locations), JUNE_FROM, JUNE_TO).transactions,
        ),
      ],
    },
    {
      id: "agg-brand-foot-traffic",
      question: `What was ${secondBrand.name}'s total foot traffic in June 2026 (June 1–30)?`,
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: { brandSlug: secondBrand.slug, from: JUNE_FROM, to: JUNE_TO },
        },
      ],
      expectedFacts: [
        countFact(
          `${secondBrand.slug} June foot traffic`,
          sumMetrics(idsOf(secondBrandLocations), JUNE_FROM, JUNE_TO).footTraffic,
        ),
      ],
    },
    {
      id: "agg-brand-revenue-full",
      question: `What was ${secondBrand.name}'s total revenue from ${SEED_START_DATE} to ${SEED_END_DATE}?`,
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: {
            brandSlug: secondBrand.slug,
            from: SEED_START_DATE,
            to: SEED_END_DATE,
          },
        },
      ],
      expectedFacts: [
        revenueFact(
          `${secondBrand.slug} revenue`,
          sumMetrics(idsOf(secondBrandLocations), SEED_START_DATE, SEED_END_DATE).revenueCents,
        ),
      ],
    },
    {
      id: "agg-city-q1",
      question: `How many transactions did our ${busiestCity} locations process from 2026-01-01 to 2026-03-31?`,
      expectedTools: [
        { name: "search_locations", args: { city: busiestCity } },
        {
          name: "aggregate_metrics",
          args: { from: "2026-01-01", to: "2026-03-31" },
        },
      ],
      expectedFacts: [
        countFact(
          `${busiestCity} Q1 transactions`,
          sumMetrics(idsOf(busiestCityLocations), "2026-01-01", "2026-03-31").transactions,
        ),
      ],
    },
    {
      id: "agg-single-location-june",
      question: `What was ${pairA!.name}'s revenue from ${JUNE_FROM} to ${JUNE_TO}?`,
      expectedTools: [
        { name: "search_locations" },
        { name: "aggregate_metrics", args: { from: JUNE_FROM, to: JUNE_TO } },
      ],
      expectedFacts: [
        revenueFact(
          `${pairA!.slug} June revenue`,
          sumMetrics(new Set([pairA!.id!]), JUNE_FROM, JUNE_TO).revenueCents,
        ),
      ],
    },

    // --- D. comparison -------------------------------------------------------
    {
      id: "compare-top3-brand",
      question: `Compare the top 3 ${topBrand.name} locations by revenue from ${H1_FROM} to ${H1_TO}.`,
      expectedTools: [
        { name: "search_locations" },
        { name: "compare_locations", args: { from: H1_FROM, to: H1_TO } },
      ],
      expectedFacts: [
        revenueFact(
          `${topBrand.slug} best H1 revenue`,
          Math.max(
            ...topBrandOpen.map((l) => sumMetrics(new Set([l.id!]), H1_FROM, H1_TO).revenueCents),
          ),
        ),
      ],
    },
    {
      id: "compare-two-named",
      question: `Compare ${pairA!.name} and ${pairB!.name} on revenue and foot traffic from ${JUNE_FROM} to ${JUNE_TO}.`,
      expectedTools: [
        { name: "search_locations" },
        { name: "compare_locations", args: { from: JUNE_FROM, to: JUNE_TO } },
      ],
      expectedFacts: [
        revenueFact(
          `${pairA!.slug} June revenue`,
          sumMetrics(new Set([pairA!.id!]), JUNE_FROM, JUNE_TO).revenueCents,
        ),
        revenueFact(
          `${pairB!.slug} June revenue`,
          sumMetrics(new Set([pairB!.id!]), JUNE_FROM, JUNE_TO).revenueCents,
        ),
      ],
    },
    {
      id: "compare-city-top-earner",
      question: `Which of our ${busiestCity} locations earned the most revenue from ${H1_FROM} to ${H1_TO}?`,
      expectedTools: [
        { name: "search_locations", args: { city: busiestCity } },
        { name: "compare_locations", args: { from: H1_FROM, to: H1_TO } },
      ],
      expectedFacts: [
        revenueFact(
          `${busiestCity} top H1 revenue`,
          Math.max(
            ...busiestCityLocations.map(
              (l) => sumMetrics(new Set([l.id!]), H1_FROM, H1_TO).revenueCents,
            ),
          ),
        ),
      ],
    },
    {
      id: "compare-city-best-rated",
      question: `Which location in ${busiestCity} has the highest average customer rating?`,
      expectedTools: [{ name: "search_locations", args: { city: busiestCity } }],
      expectedFacts: [
        {
          label: `${busiestCity} best rating`,
          value: Math.max(
            ...busiestCityLocations
              .map((l) => avgRating(l.id!))
              .filter((r): r is number => r !== null),
          ),
          kind: "rating",
        },
      ],
    },
    {
      id: "compare-brand-vs-brand",
      question: `Which brand earned more revenue from ${H1_FROM} to ${H1_TO}: ${topBrand.name} or ${secondBrand.name}?`,
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: { brandSlug: topBrand.slug, from: H1_FROM, to: H1_TO },
        },
        {
          name: "aggregate_metrics",
          args: { brandSlug: secondBrand.slug, from: H1_FROM, to: H1_TO },
        },
      ],
      expectedFacts: [
        revenueFact(
          `${topBrand.slug} H1`,
          sumMetrics(idsOf(seed.locations.filter((l) => l.brandId === topBrand.id)), H1_FROM, H1_TO)
            .revenueCents,
        ),
        revenueFact(
          `${secondBrand.slug} H1`,
          sumMetrics(idsOf(secondBrandLocations), H1_FROM, H1_TO).revenueCents,
        ),
      ],
    },

    // --- E. robustness -------------------------------------------------------
    {
      id: "robust-unknown-brand",
      question: "How is Starbucks performing across our portfolio?",
      expectedTools: [{ name: "search_locations" }],
      expectedFacts: [],
    },
    {
      id: "robust-out-of-window",
      question: "What was total revenue across all locations from 2024-01-01 to 2024-12-31?",
      expectedTools: [
        {
          name: "aggregate_metrics",
          args: { from: "2024-01-01", to: "2024-12-31" },
        },
      ],
      expectedFacts: [],
    },
  ];

  return cases;
}
