import type { MetricsAggregate } from "@/lib/types/domain";

import { formatCountCompact, formatMoneyCompact, formatMoneyPrecise } from "./format";

// Stat-tile row (not a chart — four headline magnitudes). Tile values use the
// font's proportional figures (tabular-nums is reserved for table columns).

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export function MetricsSummary({ data }: { data: MetricsAggregate }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Tile label="Revenue" value={formatMoneyCompact(data.totalRevenueCents)} />
        <Tile label="Transactions" value={formatCountCompact(data.totalTransactions)} />
        <Tile label="Foot traffic" value={formatCountCompact(data.totalFootTraffic)} />
        <Tile
          label="Avg ticket"
          value={data.avgTicketCents === null ? "—" : formatMoneyPrecise(data.avgTicketCents)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {data.from} to {data.to} · {data.locationCount}{" "}
        {data.locationCount === 1 ? "location" : "locations"}
      </p>
    </div>
  );
}
