import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDb } from "@/lib/db/client";
import {
  brandOptions,
  cityOptions,
  dashboardKpis,
  monthlyRevenue,
  revenueByBrand,
  topLocations,
} from "@/lib/db/dashboard";
import { SEED_END_DATE, SEED_START_DATE } from "@/lib/db/seed-data";
import { isCalendarDate } from "@/lib/dates";
import type { DashboardViewContext } from "@/lib/types/chat";

// The dashboard IS the homepage: a stakeholder lands on the data, with the
// AI analyst one glance away (chat lives at /chat for focused sessions).
// Data changes per request (and per filter), so this page must never be
// statically prerendered — same reasoning as /observability.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Venue Insights — Portfolio dashboard" };

function first(param: string | string[] | undefined): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const db = getDb();

  // Options first: URL params are untrusted, so brand/city are only
  // accepted when they exist in the seeded vocabulary.
  const [brands, cities] = await Promise.all([brandOptions(db), cityOptions(db)]);

  // Calendar validity matters, not just shape: a format-valid impostor like
  // 2026-06-31 would throw inside Postgres and 500 the whole page. Invalid
  // dates degrade to the seed bounds, exactly like unknown brand/city below.
  const rawFrom = first(sp.from);
  const rawTo = first(sp.to);
  let from = rawFrom && isCalendarDate(rawFrom) ? rawFrom : SEED_START_DATE;
  let to = rawTo && isCalendarDate(rawTo) ? rawTo : SEED_END_DATE;
  if (from > to) [from, to] = [to, from];

  const rawBrand = first(sp.brand);
  const brandSlug = brands.some((b) => b.slug === rawBrand) ? rawBrand : undefined;
  const rawCity = first(sp.city);
  const city = cities.some((c) => c.city === rawCity) ? rawCity : undefined;

  const filters = { from, to, brandSlug, city };
  const [kpis, byBrand, monthly, topRows] = await Promise.all([
    dashboardKpis(db, filters),
    revenueByBrand(db, filters),
    monthlyRevenue(db, filters),
    topLocations(db, filters),
  ]);

  const viewContext: DashboardViewContext = {
    from,
    to,
    brandSlug: brandSlug ?? null,
    city: city ?? null,
  };
  const brandName = brands.find((b) => b.slug === brandSlug)?.name;
  const viewContextLabel = [
    brandName ?? "All brands",
    city ?? "All cities",
    `${from} → ${to}`,
  ].join(" · ");

  return (
    <DashboardShell
      kpis={kpis}
      brandRevenue={byBrand}
      monthly={monthly}
      topRows={topRows}
      brands={brands}
      cities={cities}
      filters={filters}
      viewContext={viewContext}
      viewContextLabel={viewContextLabel}
    />
  );
}
