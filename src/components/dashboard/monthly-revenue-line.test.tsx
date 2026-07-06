import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MonthlyRevenueLine } from "./monthly-revenue-line";
import type { MonthlyRevenue } from "@/lib/types/dashboard";

// jsdom has no layout, so getBoundingClientRect() is all zeros and the
// pointer path bails out early — these tests drive the chart the way a
// keyboard user does, which is exactly the path the clamp + live-region
// fixes protect.

function months(count: number): MonthlyRevenue[] {
  return Array.from({ length: count }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    revenueCents: (i + 1) * 100_000, // $1,000, $2,000, ...
  }));
}

function liveRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]');
  expect(region).not.toBeNull();
  return region!;
}

describe("MonthlyRevenueLine", () => {
  it("announces the hovered point in the live region as the keyboard moves", () => {
    const { container } = render(<MonthlyRevenueLine data={months(6)} />);
    const svg = screen.getByRole("img", { name: "Monthly revenue trend" });

    // Region exists but is silent before any interaction.
    expect(liveRegion(container).textContent).toBe("");

    fireEvent.keyDown(svg, { key: "ArrowRight" }); // first point
    expect(liveRegion(container).textContent).toBe("Jan 2026: $1,000.00");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(liveRegion(container).textContent).toBe("Feb 2026: $2,000.00");

    fireEvent.keyDown(svg, { key: "Escape" });
    expect(liveRegion(container).textContent).toBe("");
  });

  it("clamps a stale hover index when a filter change shrinks the data", () => {
    const { container, rerender } = render(<MonthlyRevenueLine data={months(6)} />);
    const svg = screen.getByRole("img", { name: "Monthly revenue trend" });

    // Walk the readout to the last of six points (moveTo clamps at the end).
    for (let i = 0; i < 10; i++) fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(liveRegion(container).textContent).toBe("Jun 2026: $6,000.00");

    // Shrink to two points — hoverIndex (5) now points past the data. The
    // derived clamp must land the readout on the new last point, not crash
    // on data[5] or draw the crosshair off-canvas.
    rerender(<MonthlyRevenueLine data={months(2)} />);
    expect(liveRegion(container).textContent).toBe("Feb 2026: $2,000.00");

    // Keyboard continues from the CLAMPED position: right is a no-op at the
    // end, left steps to the first point.
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(liveRegion(container).textContent).toBe("Feb 2026: $2,000.00");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(liveRegion(container).textContent).toBe("Jan 2026: $1,000.00");
  });
});
