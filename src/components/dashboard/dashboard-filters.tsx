"use client";

import { useRouter } from "next/navigation";

import { SEED_END_DATE, SEED_START_DATE } from "@/lib/db/seed-data";
import type { BrandOption, CityOption } from "@/lib/types/dashboard";

// One left-aligned filter row above everything it scopes; date range first
// (the filter every reader reaches for) — the dataviz composition rules.
// Filter state lives in the URL, so views are shareable and the server
// re-renders every tile/chart/table against the same slice.

export interface FilterValue {
  from: string;
  to: string;
  brandSlug?: string;
  city?: string;
}

const DATE_PRESETS = [
  { label: "Last 12 months", from: SEED_START_DATE, to: SEED_END_DATE },
  { label: "H1 2026", from: "2026-01-01", to: "2026-06-30" },
  { label: "Q2 2026", from: "2026-04-01", to: "2026-06-30" },
  { label: "Q1 2026", from: "2026-01-01", to: "2026-03-31" },
  { label: "June 2026", from: "2026-06-01", to: "2026-06-30" },
];

const selectCls =
  "h-8 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-2";

export function DashboardFilters({
  brands,
  cities,
  value,
}: {
  brands: BrandOption[];
  cities: CityOption[];
  value: FilterValue;
}) {
  const router = useRouter();

  function navigate(next: FilterValue) {
    const params = new URLSearchParams();
    params.set("from", next.from);
    params.set("to", next.to);
    if (next.brandSlug) params.set("brand", next.brandSlug);
    if (next.city) params.set("city", next.city);
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  }

  const activePreset =
    DATE_PRESETS.find((p) => p.from === value.from && p.to === value.to)?.label ?? "custom";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectCls}
        aria-label="Date range"
        value={activePreset}
        onChange={(e) => {
          const preset = DATE_PRESETS.find((p) => p.label === e.target.value);
          if (preset) navigate({ ...value, from: preset.from, to: preset.to });
        }}
      >
        {activePreset === "custom" && (
          <option value="custom">{`${value.from} → ${value.to}`}</option>
        )}
        {DATE_PRESETS.map((preset) => (
          <option key={preset.label} value={preset.label}>
            {preset.label}
          </option>
        ))}
      </select>

      <select
        className={selectCls}
        aria-label="Brand"
        value={value.brandSlug ?? ""}
        onChange={(e) =>
          navigate({ ...value, brandSlug: e.target.value === "" ? undefined : e.target.value })
        }
      >
        <option value="">All brands</option>
        {brands.map((brand) => (
          <option key={brand.slug} value={brand.slug}>
            {brand.name}
          </option>
        ))}
      </select>

      <select
        className={selectCls}
        aria-label="City"
        value={value.city ?? ""}
        onChange={(e) =>
          navigate({ ...value, city: e.target.value === "" ? undefined : e.target.value })
        }
      >
        <option value="">All cities</option>
        {cities.map((option) => (
          <option key={`${option.city}-${option.state}`} value={option.city}>
            {option.city}, {option.state}
          </option>
        ))}
      </select>
    </div>
  );
}
