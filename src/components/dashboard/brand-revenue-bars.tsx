import { formatMoneyCompact } from "@/components/chat/tool-views/format";
import type { BrandRevenue } from "@/lib/types/dashboard";

// Horizontal bars for "revenue by brand": the job is magnitude, so a single
// hue — identity lives on the row label, not on color (dataviz form rule).
// Series hue #2a78d6 / #3987e5 validated against our card surfaces (all
// checks pass, both modes). Marks: 20px thick (≤24), 4px rounded data-end,
// square at the baseline; every value direct-labeled at the tip in a text
// token, so no tooltip is needed — nothing is gated on hover.

export function BrandRevenueBars({ data }: { data: BrandRevenue[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No revenue in this view.</p>;
  }
  const max = Math.max(...data.map((row) => row.revenueCents), 1);

  return (
    <div className="space-y-2" role="img" aria-label="Revenue by brand">
      {data.map((row) => (
        <div
          key={row.brandSlug}
          className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-2"
        >
          <span className="truncate text-xs text-muted-foreground" title={row.brandName}>
            {row.brandName}
          </span>
          {/* all bars share this track, so lengths stay comparable */}
          <div className="min-w-0">
            <div
              className="h-5 rounded-r-[4px] bg-[#2a78d6] transition-opacity hover:opacity-85 dark:bg-[#3987e5]"
              style={{ width: `${Math.max((row.revenueCents / max) * 100, 0.5)}%` }}
            />
          </div>
          <span className="text-right text-xs font-medium tabular-nums">
            {formatMoneyCompact(row.revenueCents)}
          </span>
        </div>
      ))}
    </div>
  );
}
