import Link from "next/link";

import type { EvalRunSummary, TurnSummary } from "@/lib/types/telemetry";

import { formatDurationMs, formatMicroUsd, formatTokens, formatWhen } from "./format";

// Pure presentational component (the page fetches, this renders) so the
// whole surface tests from fixtures in RTL — same split as the tool views.
// Table cells use tabular-nums (exact values); tiles use proportional
// figures — the Week 4 dataviz discipline.

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const thNum = "px-3 py-2 text-right text-xs font-medium text-muted-foreground";
const td = "px-3 py-2";
const tdNum = "px-3 py-2 text-right tabular-nums";

function StatusBadge({ status }: { status: TurnSummary["status"] }) {
  if (status === "error") {
    return <span className="font-medium text-red-600 dark:text-red-400">error</span>;
  }
  return <span className="text-muted-foreground">ok</span>;
}

function EvalRunsTable({ runs }: { runs: EvalRunSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className={th}>Run</th>
            <th className={th}>Started</th>
            <th className={thNum}>Cases</th>
            <th className={thNum}>Input tok</th>
            <th className={thNum}>Output tok</th>
            <th className={thNum}>Model time</th>
            <th className={thNum}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId} className="border-b last:border-0">
              <td className={`${td} font-mono text-xs`}>{run.runId}</td>
              <td className={td}>{formatWhen(run.startedAt)}</td>
              <td className={tdNum}>{formatTokens(run.caseCount)}</td>
              <td className={tdNum}>{formatTokens(run.totalInputTokens)}</td>
              <td className={tdNum}>{formatTokens(run.totalOutputTokens)}</td>
              <td className={tdNum}>{formatDurationMs(run.totalDurationMs)}</td>
              <td className={tdNum}>{formatMicroUsd(run.totalCostMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnsTable({ turns }: { turns: TurnSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className={th}>Started</th>
            <th className={th}>Kind</th>
            <th className={th}>Status</th>
            <th className={th}>Eval case</th>
            <th className={thNum}>Tools</th>
            <th className={thNum}>Input tok</th>
            <th className={thNum}>Output tok</th>
            <th className={thNum}>Latency</th>
            <th className={thNum}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr key={turn.traceId} className="border-b last:border-0">
              <td className={td}>{formatWhen(turn.startedAt)}</td>
              <td className={td}>{turn.kind}</td>
              <td className={td}>
                <StatusBadge status={turn.status} />
              </td>
              <td className={`${td} font-mono text-xs`}>{turn.evalCaseId ?? "—"}</td>
              <td className={tdNum}>{formatTokens(turn.toolCalls)}</td>
              <td className={tdNum}>{formatTokens(turn.inputTokens)}</td>
              <td className={tdNum}>{formatTokens(turn.outputTokens)}</td>
              <td className={tdNum}>{formatDurationMs(turn.durationMs)}</td>
              <td className={tdNum}>{formatMicroUsd(turn.costMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ObservabilityView({
  turns,
  runs,
}: {
  turns: TurnSummary[];
  runs: EvalRunSummary[];
}) {
  const totalCost = turns.reduce((acc, turn) => acc + (turn.costMicroUsd ?? 0), 0);
  const totalTools = turns.reduce((acc, turn) => acc + turn.toolCalls, 0);
  const avgLatency =
    turns.length === 0 ? 0 : turns.reduce((acc, turn) => acc + turn.durationMs, 0) / turns.length;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Observability</h1>
          <p className="text-sm text-muted-foreground">
            Cost and latency per turn and per eval run, read from the spans table (ADR-0006).
            Showing the {turns.length} most recent turns.
          </p>
        </div>
        <nav className="flex gap-3 text-xs text-muted-foreground">
          <Link className="hover:text-foreground" href="/">
            Dashboard
          </Link>
          <Link className="hover:text-foreground" href="/chat">
            Chat
          </Link>
        </nav>
      </header>

      <section aria-label="totals" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Tile label="Spend (shown turns)" value={formatMicroUsd(totalCost)} />
        <Tile label="Turns" value={formatTokens(turns.length)} />
        <Tile label="Avg turn latency" value={formatDurationMs(avgLatency)} />
        <Tile label="Tool calls" value={formatTokens(totalTools)} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Eval runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No eval runs recorded yet — <code className="font-mono">pnpm eval</code> writes one row
            per run here.
          </p>
        ) : (
          <EvalRunsTable runs={runs} />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Turns</h2>
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No spans yet — ask a question in the chat or run{" "}
            <code className="font-mono">pnpm eval</code>.
          </p>
        ) : (
          <TurnsTable turns={turns} />
        )}
      </section>
    </main>
  );
}
