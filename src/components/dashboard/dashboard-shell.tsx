"use client";

import Link from "next/link";
import { useState } from "react";

import { Chat, type AskSignal } from "@/components/chat/chat";
import { Button } from "@/components/ui/button";
import type { DashboardViewContext } from "@/lib/types/chat";
import type {
  BrandOption,
  BrandRevenue,
  CityOption,
  DashboardKpis,
  MonthlyRevenue,
  TopLocationRow,
} from "@/lib/types/dashboard";

import { BrandRevenueBars } from "./brand-revenue-bars";
import { DashboardFilters, type FilterValue } from "./dashboard-filters";
import { KpiRow } from "./kpi-row";
import { MonthlyRevenueLine } from "./monthly-revenue-line";
import { TopLocationsTable } from "./top-locations-table";

// Option C of ADR-0009: the dashboard and the chat share one view. Every
// "Ask AI" button routes a question into the chat rail, and the rail sends
// the current filter state with every request — the AI sees what the
// stakeholder sees.

const DASHBOARD_SUGGESTIONS = [
  "Summarize how this view is performing.",
  "Which locations here are underperforming, and why might that be?",
  "How do the brands in this view compare on foot traffic?",
];

function Card({
  title,
  onAsk,
  children,
}: {
  title: string;
  onAsk?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {onAsk && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onAsk}>
            ✦ Ask AI
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

export interface DashboardShellProps {
  kpis: DashboardKpis;
  brandRevenue: BrandRevenue[];
  monthly: MonthlyRevenue[];
  topRows: TopLocationRow[];
  brands: BrandOption[];
  cities: CityOption[];
  filters: FilterValue;
  viewContext: DashboardViewContext;
  viewContextLabel: string;
}

export function DashboardShell(props: DashboardShellProps) {
  const [askSignal, setAskSignal] = useState<AskSignal | undefined>(undefined);
  const ask = (question: string) => setAskSignal({ question, nonce: Date.now() });

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Portfolio dashboard</h1>
            <p className="text-xs text-muted-foreground">
              {props.kpis.locationCount} locations in view · {props.filters.from} →{" "}
              {props.filters.to}
            </p>
          </div>
          <nav className="flex gap-3 text-xs text-muted-foreground">
            <Link className="hover:text-foreground" href="/chat">
              Chat
            </Link>
            <Link className="hover:text-foreground" href="/observability">
              Observability
            </Link>
          </nav>
        </header>

        <DashboardFilters brands={props.brands} cities={props.cities} value={props.filters} />

        <KpiRow kpis={props.kpis} />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card
            title="Revenue by brand"
            onAsk={() =>
              ask(
                "Looking at revenue by brand in this view — which brand is driving results, and what explains the gap?",
              )
            }
          >
            <BrandRevenueBars data={props.brandRevenue} />
          </Card>
          <Card
            title="Monthly revenue"
            onAsk={() => ask("What explains the monthly revenue trend in this view?")}
          >
            <MonthlyRevenueLine data={props.monthly} />
          </Card>
        </div>

        <Card
          title="Top locations by revenue"
          onAsk={() =>
            ask(
              "What stands out about the top locations in this view — anything worth investigating?",
            )
          }
        >
          <TopLocationsTable rows={props.topRows} />
        </Card>
      </div>

      <aside className="min-h-[60vh] lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)]">
        <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
          <div className="border-b px-4 py-2.5 text-sm font-medium">AI analyst</div>
          <Chat
            suggestions={DASHBOARD_SUGGESTIONS}
            viewContext={props.viewContext}
            viewContextLabel={props.viewContextLabel}
            askSignal={askSignal}
          />
        </div>
      </aside>
    </div>
  );
}
