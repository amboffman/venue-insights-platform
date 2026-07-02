import type { LocationSummary } from "@/lib/types/domain";

import { StatusBadge } from "./location-card";

const MAX_ROWS = 8;

export function LocationList({ data }: { data: LocationSummary[] }) {
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No locations matched.</p>;
  }
  const visible = data.slice(0, MAX_ROWS);
  const hidden = data.length - visible.length;
  return (
    <div className="rounded-lg border bg-background">
      <ul className="divide-y">
        {visible.map((location) => (
          <li
            key={location.id}
            className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
          >
            <div>
              <span className="font-medium">{location.name}</span>{" "}
              <span className="text-muted-foreground">
                · {location.city}, {location.state}
              </span>
            </div>
            <StatusBadge status={location.status} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">+{hidden} more</p>
      )}
    </div>
  );
}
