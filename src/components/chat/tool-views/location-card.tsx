import type { LocationDetails } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

import { formatRating } from "./format";

const STATUS_LABELS: Record<LocationDetails["status"], string> = {
  open: "Open",
  closed: "Closed",
  coming_soon: "Coming soon",
};

export function StatusBadge({ status }: { status: LocationDetails["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "open" && "border-border text-foreground",
        status === "closed" && "border-destructive/40 text-destructive",
        status === "coming_soon" && "border-border text-muted-foreground",
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function LocationCard({ data }: { data: LocationDetails }) {
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{data.name}</div>
          <div className="text-xs text-muted-foreground">
            {data.addressLine1}, {data.city}, {data.state} {data.postalCode} · {data.phone}
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>
      <div className="text-xs">
        <span className="font-medium">{formatRating(data.avgRating)}</span>{" "}
        <span className="text-muted-foreground">
          ({data.reviewCount} {data.reviewCount === 1 ? "review" : "reviews"}) · opened{" "}
          {data.openedAt}
        </span>
      </div>
      {data.recentReviews.length > 0 && (
        <ul className="space-y-1.5 border-t pt-2">
          {data.recentReviews.slice(0, 3).map((review) => (
            <li key={review.id} className="text-xs">
              <span className="font-medium">{review.rating}★</span>{" "}
              <span className="text-muted-foreground">
                “{review.text}” — {review.authorName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
