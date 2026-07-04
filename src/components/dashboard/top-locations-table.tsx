import { formatCountExact, formatMoneyExact } from "@/components/chat/tool-views/format";
import type { TopLocationRow } from "@/lib/types/dashboard";

// Exact values with tabular-nums — table columns align; compaction is for
// tiles and direct labels only (the Week 4 formatting discipline).

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const thNum = "px-3 py-2 text-right text-xs font-medium text-muted-foreground";

export function TopLocationsTable({ rows }: { rows: TopLocationRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No locations in this view.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className={th}>Location</th>
            <th className={th}>Brand</th>
            <th className={th}>City</th>
            <th className={thNum}>Revenue</th>
            <th className={thNum}>Transactions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="px-3 py-2">{row.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.brandName}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.city}, {row.state}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatMoneyExact(row.revenueCents)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCountExact(row.transactions)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
