import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatCountCompact,
  formatMoneyCompact,
  formatMoneyExact,
  formatRating,
} from "@/components/chat/tool-views/format";
import { renderToolResult } from "@/components/chat/tool-views/registry";
import type {
  LocationComparison,
  LocationDetails,
  LocationSummary,
  MetricsAggregate,
} from "@/lib/types/domain";

const summary = (overrides: Partial<LocationSummary> = {}): LocationSummary => ({
  id: 1,
  brandId: 1,
  brandName: "Copper Kettle Coffee",
  name: "Copper Kettle Coffee — Downtown Austin",
  slug: "copper-kettle-coffee-austin-downtown",
  addressLine1: "100 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  lat: 30.27,
  lng: -97.74,
  phone: "(512) 555-0101",
  status: "open",
  openedAt: "2020-01-15",
  ...overrides,
});

describe("format helpers", () => {
  it("keeps small money full and compacts large money", () => {
    expect(formatMoneyCompact(943_210)).toBe("$9,432");
    expect(formatMoneyCompact(495_479_11)).toBe("$495.5K");
  });

  it("formats exact money from cents", () => {
    expect(formatMoneyExact(49_547_911)).toBe("$495,479.11");
  });

  it("compacts large counts and renders null ratings as a dash", () => {
    expect(formatCountCompact(1_284)).toBe("1,284");
    expect(formatCountCompact(28_296)).toBe("28.3K");
    expect(formatRating(null)).toBe("—");
    expect(formatRating(3.785)).toBe("3.79 ★");
  });
});

describe("registry", () => {
  it("returns null for tools without a view and for missing locations", () => {
    expect(renderToolResult("unknown_tool", {})).toBeNull();
    expect(renderToolResult("get_location_details", null)).toBeNull();
  });
});

describe("MetricsSummary", () => {
  it("renders the four tiles and the range caption", () => {
    const data: MetricsAggregate = {
      from: "2026-01-01",
      to: "2026-06-30",
      locationCount: 42,
      totalRevenueCents: 314_159_265,
      totalTransactions: 271_828,
      totalFootTraffic: 987_654,
      avgTicketCents: 1_156,
    };
    render(<>{renderToolResult("aggregate_metrics", data)}</>);

    expect(screen.getByText("Revenue")).toBeDefined();
    expect(screen.getByText("$3.1M")).toBeDefined();
    expect(screen.getByText("271.8K")).toBeDefined();
    expect(screen.getByText("$11.56")).toBeDefined();
    expect(screen.getByText(/2026-01-01 to 2026-06-30/)).toBeDefined();
    expect(screen.getByText(/42 locations/)).toBeDefined();
  });
});

describe("ComparisonTable", () => {
  it("renders one row per location with exact figures", () => {
    const rows: LocationComparison[] = [
      {
        locationId: 28,
        locationName: "Verde Taqueria — Downtown Austin",
        city: "Austin",
        state: "TX",
        totalRevenueCents: 49_547_911,
        totalTransactions: 28_296,
        totalFootTraffic: 84_000,
        avgTicketCents: 1_751,
        avgRating: 3.79,
      },
      {
        locationId: 30,
        locationName: "Verde Taqueria — Old Town Austin",
        city: "Austin",
        state: "TX",
        totalRevenueCents: 35_972_977,
        totalTransactions: 21_000,
        totalFootTraffic: 60_500,
        avgTicketCents: null,
        avgRating: null,
      },
    ];
    render(<>{renderToolResult("compare_locations", rows)}</>);

    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
    expect(screen.getByText("$495,479.11")).toBeDefined();
    expect(screen.getByText("28,296")).toBeDefined();
    expect(screen.getByText("3.79 ★")).toBeDefined();
    // null avg ticket and null rating both render as dashes
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("LocationList", () => {
  it("caps at 8 rows and reports the remainder", () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      summary({ id: i + 1, name: `Location ${i + 1}` }),
    );
    render(<>{renderToolResult("search_locations", rows)}</>);

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("+3 more")).toBeDefined();
  });

  it("says so when nothing matched", () => {
    render(<>{renderToolResult("search_locations", [])}</>);
    expect(screen.getByText("No locations matched.")).toBeDefined();
  });
});

describe("LocationCard", () => {
  it("renders profile, rating, and recent reviews", () => {
    const details: LocationDetails = {
      ...summary(),
      reviewCount: 24,
      avgRating: 3.79,
      recentReviews: [
        {
          id: 1,
          rating: 5,
          text: "Outstanding every single time.",
          authorName: "Sofia Nguyen",
          source: "google",
          createdAt: "2026-06-01T12:00:00.000Z",
        },
      ],
    };
    render(<>{renderToolResult("get_location_details", details)}</>);

    expect(screen.getByText("Copper Kettle Coffee — Downtown Austin")).toBeDefined();
    expect(screen.getByText("Open")).toBeDefined();
    expect(screen.getByText("3.79 ★")).toBeDefined();
    expect(screen.getByText(/24 reviews/)).toBeDefined();
    expect(screen.getByText(/Outstanding every single time/)).toBeDefined();
  });
});
