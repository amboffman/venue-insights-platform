"use client";

import { useRef, useState } from "react";

import { formatMoneyCompact, formatMoneyExact } from "@/components/chat/tool-views/format";
import type { MonthlyRevenue } from "@/lib/types/dashboard";

// Single-series line (trend-over-time job): 2px round-joined line, ≥8px
// end-dot with a 2px surface ring, hairline solid gridlines, ONE direct
// label at the line end — the rest of the values live in the crosshair
// tooltip (which enhances, never gates: the end label + y ticks + the AI
// chat keep everything reachable). Single series ⇒ no legend; the card
// title names it. Hue validated against our surfaces (see bars component).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01" → "Jan" (no Date parsing — deterministic in any TZ) */
function monthLabel(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** Round a raw step up to a clean 1/2/2.5/5×10ⁿ so y ticks read as numbers
 * a human would write. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (raw <= mult * pow) return mult * pow;
  }
  return 10 * pow;
}

const W = 640;
const H = 220;
const PAD = { left: 10, right: 66, top: 16, bottom: 26 };

export function MonthlyRevenueLine({ data }: { data: MonthlyRevenue[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No revenue in this view.</p>;
  }

  const maxValue = Math.max(...data.map((d) => d.revenueCents), 1);
  const step = niceStep(maxValue / 3);
  const top = Math.ceil(maxValue / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const points = data.map((d, i) => `${x(i)},${y(d.revenueCents)}`).join(" ");
  const lastIndex = data.length - 1;
  const last = data[lastIndex]!;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  function moveTo(index: number) {
    setHoverIndex(Math.min(Math.max(index, 0), lastIndex));
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return; // jsdom / not yet laid out
    const px = ((event.clientX - rect.left) / rect.width) * W;
    moveTo(Math.round(((px - PAD.left) / plotW) * lastIndex));
  }

  // hoverIndex survives re-renders, so a filter change that SHRINKS the data
  // can leave it pointing past the new end (data[hoverIndex] === undefined,
  // crosshair off-canvas). Clamp at render time instead of resetting in an
  // effect: derived state needs no extra render and can't miss an update.
  const safeHoverIndex = hoverIndex === null ? null : Math.min(hoverIndex, lastIndex);
  const hovered = safeHoverIndex === null ? null : data[safeHoverIndex]!;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Monthly revenue trend"
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={(e) => {
          // Keyboard gets the same readout as hover (interaction rule).
          // Step from the CLAMPED index so arrows continue from the point
          // actually shown, even after the data shrank under the cursor.
          if (e.key === "ArrowRight") moveTo((safeHoverIndex ?? -1) + 1);
          if (e.key === "ArrowLeft") moveTo((safeHoverIndex ?? data.length) - 1);
          if (e.key === "Escape") setHoverIndex(null);
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              strokeWidth={1}
              className="stroke-border"
            />
            <text x={PAD.left} y={y(tick) - 4} className="fill-muted-foreground text-[10px]">
              {tick === 0 ? "0" : formatMoneyCompact(tick)}
            </text>
          </g>
        ))}

        {data.map(
          (d, i) =>
            i % labelEvery === 0 && (
              <text
                key={d.month}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {monthLabel(d.month)}
              </text>
            ),
        )}

        {safeHoverIndex !== null && (
          <line
            x1={x(safeHoverIndex)}
            x2={x(safeHoverIndex)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            strokeWidth={1}
            className="stroke-border"
          />
        )}

        <polyline
          points={points}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-[#2a78d6] dark:stroke-[#3987e5]"
        />

        {safeHoverIndex !== null && safeHoverIndex !== lastIndex && hovered && (
          <circle
            cx={x(safeHoverIndex)}
            cy={y(hovered.revenueCents)}
            r={4.5}
            strokeWidth={2}
            className="fill-[#2a78d6] stroke-card dark:fill-[#3987e5]"
          />
        )}

        {/* end-dot: 9px with a 2px surface ring so it reads over the line */}
        <circle
          cx={x(lastIndex)}
          cy={y(last.revenueCents)}
          r={4.5}
          strokeWidth={2}
          className="fill-[#2a78d6] stroke-card dark:fill-[#3987e5]"
        />
        <text
          x={x(lastIndex) + 9}
          y={y(last.revenueCents) + 3.5}
          className="fill-foreground text-[11px] font-medium"
        >
          {formatMoneyCompact(last.revenueCents)}
        </text>
      </svg>

      {hovered && safeHoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${(x(safeHoverIndex) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          {/* values lead, labels follow */}
          <div className="font-semibold">{formatMoneyExact(hovered.revenueCents)}</div>
          <div className="text-muted-foreground">
            {monthLabel(hovered.month)} {hovered.month.slice(0, 4)}
          </div>
        </div>
      )}

      {/* The tooltip above is pointer-events-none and visual-only, so the
          keyboard readout is inaudible to assistive tech. Mirror it into a
          visually-hidden live region; the region stays mounted (empty when
          nothing is hovered) so screen readers reliably announce changes. */}
      <div aria-live="polite" className="sr-only">
        {hovered
          ? `${monthLabel(hovered.month)} ${hovered.month.slice(0, 4)}: ${formatMoneyExact(hovered.revenueCents)}`
          : null}
      </div>
    </div>
  );
}
