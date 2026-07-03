import { describe, expect, it } from "vitest";

import { CLOSED_METRIC_DAYS, METRIC_DAYS, SEED_END_DATE, generateSeedData } from "./seed-data";

// The eval harness (Week 5) asserts exact numbers against this data, so the
// generator's determinism and invariants are load-bearing, not nice-to-have.

const data = generateSeedData();

describe("generateSeedData determinism", () => {
  it("produces identical data for the same seed", () => {
    expect(JSON.stringify(generateSeedData(42))).toBe(JSON.stringify(generateSeedData(42)));
  });

  it("produces different data for a different seed", () => {
    expect(JSON.stringify(generateSeedData(1))).not.toBe(JSON.stringify(generateSeedData(2)));
  });
});

describe("generateSeedData shape", () => {
  it("generates 5 brands and 10 locations per brand", () => {
    expect(data.brands).toHaveLength(5);
    expect(data.locations).toHaveLength(50);
    for (const brand of data.brands) {
      expect(data.locations.filter((l) => l.brandId === brand.id)).toHaveLength(10);
    }
  });

  it("gives every location a unique slug", () => {
    const slugs = data.locations.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("references valid locations from reviews and metrics", () => {
    const locationIds = new Set(data.locations.map((l) => l.id));
    for (const review of data.reviews) {
      expect(locationIds.has(review.locationId)).toBe(true);
    }
    for (const metric of data.dailyMetrics) {
      expect(locationIds.has(metric.locationId)).toBe(true);
    }
  });
});

describe("generateSeedData invariants", () => {
  it("keeps ratings within 1–5", () => {
    for (const review of data.reviews) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
    }
  });

  it("keeps all metric values non-negative integers", () => {
    for (const metric of data.dailyMetrics) {
      for (const value of [metric.revenueCents, metric.transactions, metric.footTraffic]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has exactly one metric row per location per day", () => {
    const keys = data.dailyMetrics.map((m) => `${m.locationId}:${m.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps metric dates inside the fixed window ending at SEED_END_DATE", () => {
    // ISO date strings compare correctly as strings.
    const dates = data.dailyMetrics.map((m) => m.date).sort();
    expect(dates.at(-1)).toBe(SEED_END_DATE);
    expect(dates[0]! >= "2025-07-01").toBe(true);
  });

  it("gives coming_soon locations no reviews and no metrics", () => {
    const comingSoon = data.locations.filter((l) => l.status === "coming_soon");
    expect(comingSoon.length).toBeGreaterThan(0);
    for (const location of comingSoon) {
      expect(data.reviews.filter((r) => r.locationId === location.id)).toHaveLength(0);
      expect(data.dailyMetrics.filter((m) => m.locationId === location.id)).toHaveLength(0);
    }
  });

  it("gives open locations a full window and closed ones a truncated one", () => {
    for (const location of data.locations) {
      const days = data.dailyMetrics.filter((m) => m.locationId === location.id).length;
      if (location.status === "open") expect(days).toBe(METRIC_DAYS);
      if (location.status === "closed") expect(days).toBe(CLOSED_METRIC_DAYS);
    }
  });

  it("has a usable mix of statuses for demo questions", () => {
    const open = data.locations.filter((l) => l.status === "open").length;
    const closed = data.locations.filter((l) => l.status === "closed").length;
    expect(open).toBeGreaterThanOrEqual(35);
    expect(closed).toBeGreaterThanOrEqual(1);
  });
});
