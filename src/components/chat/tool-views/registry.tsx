import type { ReactNode } from "react";

import type {
  LocationComparison,
  LocationDetails,
  LocationSummary,
  MetricsAggregate,
} from "@/lib/types/domain";

import { ComparisonTable } from "./comparison-table";
import { LocationCard } from "./location-card";
import { LocationList } from "./location-list";
import { MetricsSummary } from "./metrics-summary";

// Deterministic generative UI (ADR-0004): a fixed registry maps tool name →
// typed renderer for that tool's output schema. The model chooses WHICH tool
// to call; it never generates markup — so rendering is testable, safe, and
// the model cannot invent UI. Outputs arrive as `unknown` over the wire; the
// casts below are backed by the shared domain types both sides import (the
// server produced these exact shapes in lib/db).

const TOOL_VIEWS: Record<string, (output: unknown) => ReactNode> = {
  search_locations: (output) => <LocationList data={output as LocationSummary[]} />,
  get_location_details: (output) =>
    // null = location not found; the model explains it in prose.
    output === null ? null : <LocationCard data={output as LocationDetails} />,
  aggregate_metrics: (output) => <MetricsSummary data={output as MetricsAggregate} />,
  compare_locations: (output) => <ComparisonTable data={output as LocationComparison[]} />,
};

/** Returns the rendered view for a successful tool result, or null when the
 * tool has no registered view (the activity chip remains the fallback). */
export function renderToolResult(name: string, output: unknown): ReactNode {
  const view = TOOL_VIEWS[name];
  return view ? view(output) : null;
}
