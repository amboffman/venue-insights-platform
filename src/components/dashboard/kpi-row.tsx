import {
  formatCountCompact,
  formatMoneyCompact,
  formatMoneyPrecise,
} from "@/components/chat/tool-views/format";
import type { DashboardKpis } from "@/lib/types/dashboard";

// KPI row = stat tiles, not a chart (dataviz: a handful of headline numbers
// is never a grouped bar). Tile values use proportional figures on purpose —
// tabular-nums is reserved for columns that must align.

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export function KpiRow({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      <Tile label="Revenue" value={formatMoneyCompact(kpis.totalRevenueCents)} />
      <Tile label="Transactions" value={formatCountCompact(kpis.totalTransactions)} />
      <Tile label="Foot traffic" value={formatCountCompact(kpis.totalFootTraffic)} />
      <Tile
        label="Avg ticket"
        value={kpis.avgTicketCents === null ? "—" : formatMoneyPrecise(kpis.avgTicketCents)}
      />
    </div>
  );
}
