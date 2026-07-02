import type { LocationComparison } from "@/lib/types/domain";

import { formatCountExact, formatMoneyExact, formatMoneyPrecise, formatRating } from "./format";

// A table, deliberately not a chart: the model's answer prose carries the
// comparison narrative; this carries the exact numbers. Numeric columns are
// right-aligned with tabular figures so digits line up vertically.

const numeric = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

export function ComparisonTable({ data }: { data: LocationComparison[] }) {
  if (data.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-background text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">Location</th>
            <th className={`${numeric} font-medium`}>Revenue</th>
            <th className={`${numeric} font-medium`}>Transactions</th>
            <th className={`${numeric} font-medium`}>Foot traffic</th>
            <th className={`${numeric} font-medium`}>Avg ticket</th>
            <th className={`${numeric} font-medium`}>Rating</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.locationId} className="border-b last:border-b-0">
              <td className="px-2 py-1.5">
                <div className="font-medium">{row.locationName}</div>
                <div className="text-muted-foreground">
                  {row.city}, {row.state}
                </div>
              </td>
              <td className={numeric}>{formatMoneyExact(row.totalRevenueCents)}</td>
              <td className={numeric}>{formatCountExact(row.totalTransactions)}</td>
              <td className={numeric}>{formatCountExact(row.totalFootTraffic)}</td>
              <td className={numeric}>
                {row.avgTicketCents === null ? "—" : formatMoneyPrecise(row.avgTicketCents)}
              </td>
              <td className={numeric}>{formatRating(row.avgRating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
