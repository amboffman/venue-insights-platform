import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandRevenueBars } from "@/components/dashboard/brand-revenue-bars";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { MonthlyRevenueLine } from "@/components/dashboard/monthly-revenue-line";
import { TopLocationsTable } from "@/components/dashboard/top-locations-table";
import { Chat } from "@/components/chat/chat";
import { formatViewContext } from "@/lib/types/chat";

describe("formatViewContext", () => {
  it("includes only the filters that are set", () => {
    expect(
      formatViewContext({ from: "2026-01-01", to: "2026-06-30", brandSlug: null, city: null }),
    ).toBe(
      "[Dashboard context: the user is looking at data filtered to dates 2026-01-01 to 2026-06-30. Answer for this view unless they ask otherwise.]",
    );
    expect(
      formatViewContext({
        from: "2026-04-01",
        to: "2026-06-30",
        brandSlug: "verde-taqueria",
        city: "Portland",
      }),
    ).toContain('brand "verde-taqueria", city "Portland"');
  });
});

describe("KpiRow", () => {
  it("renders the four tiles with formatted values", () => {
    render(
      <KpiRow
        kpis={{
          locationCount: 12,
          totalRevenueCents: 495_479_311,
          totalTransactions: 271_800,
          totalFootTraffic: 1_100_000,
          avgTicketCents: 1823,
        }}
      />,
    );
    expect(screen.getByText("Revenue")).toBeDefined();
    expect(screen.getByText("$5.0M")).toBeDefined();
    expect(screen.getByText("271.8K")).toBeDefined();
    expect(screen.getByText("$18.23")).toBeDefined();
  });
});

describe("BrandRevenueBars", () => {
  const data = [
    { brandSlug: "verde", brandName: "Verde Taqueria", revenueCents: 200_000_00 },
    { brandSlug: "copper", brandName: "Copper Kettle", revenueCents: 100_000_00 },
  ];

  it("labels every bar and scales widths to the max", () => {
    const { container } = render(<BrandRevenueBars data={data} />);
    expect(screen.getByText("Verde Taqueria")).toBeDefined();
    expect(screen.getByText("$200.0K")).toBeDefined();
    expect(screen.getByText("$100.0K")).toBeDefined();

    const bars = container.querySelectorAll<HTMLDivElement>("[class*='rounded-r']");
    expect(bars).toHaveLength(2);
    expect(bars[0]!.style.width).toBe("100%");
    expect(bars[1]!.style.width).toBe("50%");
  });

  it("shows an empty state instead of an empty axis", () => {
    render(<BrandRevenueBars data={[]} />);
    expect(screen.getByText(/No revenue in this view/)).toBeDefined();
  });
});

describe("MonthlyRevenueLine", () => {
  const data = [
    { month: "2026-01", revenueCents: 100_000_00 },
    { month: "2026-02", revenueCents: 140_000_00 },
    { month: "2026-03", revenueCents: 120_000_00 },
  ];

  it("renders the line, month ticks, and a single end label", () => {
    const { container } = render(<MonthlyRevenueLine data={data} />);
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(screen.getByText("Jan")).toBeDefined();
    // one direct label at the line end — the last value, compact
    expect(screen.getByText("$120.0K")).toBeDefined();
    // y ticks include the zero baseline
    expect(screen.getByText("0")).toBeDefined();
  });
});

describe("TopLocationsTable", () => {
  it("renders exact values in aligned columns", () => {
    render(
      <TopLocationsTable
        rows={[
          {
            id: 1,
            name: "Verde — Downtown",
            brandName: "Verde Taqueria",
            city: "Austin",
            state: "TX",
            revenueCents: 123_456_78,
            transactions: 4321,
          },
        ]}
      />,
    );
    expect(screen.getByText("Verde — Downtown")).toBeDefined();
    expect(screen.getByText("$123,456.78")).toBeDefined();
    expect(screen.getByText("4,321")).toBeDefined();
  });
});

describe("Chat dashboard props", () => {
  it("shows the view-context chip and custom suggestions", () => {
    render(
      <Chat
        suggestions={["Summarize this view."]}
        viewContextLabel="Verde Taqueria · All cities · 2026-01-01 → 2026-06-30"
      />,
    );
    expect(screen.getByText(/Answering for: Verde Taqueria/)).toBeDefined();
    expect(screen.getByText("Summarize this view.")).toBeDefined();
  });
});
