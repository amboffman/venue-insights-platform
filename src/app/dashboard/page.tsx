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
import type { DashboardViewContext } from "@/lib/types/chat";

// Data changes per request (and per filter), so this page must never be
// statically prerendered — same reasoning as /observability.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Dashboard — Venue Insights" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(param: string | string[] | undefined): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const db = getDb();

  // Options first: URL params are untrusted, so brand/city are only
  // accepted when they exist in the seeded vocabulary.
  const [brands, cities] = await Promise.all([brandOptions(db), cityOptions(db)]);

  const rawFrom = first(sp.from);
  const rawTo = first(sp.to);
  let from = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : SEED_START_DATE;
  let to = rawTo && ISO_DATE.test(rawTo) ? rawTo : SEED_END_DATE;
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
