import type { Metadata } from "next";

import { ObservabilityView } from "@/components/observability/observability-view";
import { getDb } from "@/lib/db/client";
import { listEvalRunSummaries, listTurnSummaries } from "@/lib/db/spans";

// Without cacheComponents, a db-reading page would be STATICALLY prerendered
// at build (stale data locally, no DATABASE_URL in CI at all) — force
// request-time rendering. Vendored guide: caching-without-cache-components.
export const dynamic = "force-dynamic";
// postgres-js needs Node APIs, same as the chat route.
export const runtime = "nodejs";

export const metadata: Metadata = { title: "Observability — MLIP" };

export default async function ObservabilityPage() {
  const db = getDb();
  const [turns, runs] = await Promise.all([listTurnSummaries(db, 50), listEvalRunSummaries(db)]);
  return <ObservabilityView turns={turns} runs={runs} />;
}
