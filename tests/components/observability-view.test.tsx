import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ObservabilityView } from "@/components/observability/observability-view";
import { formatDurationMs, formatMicroUsd } from "@/components/observability/format";
import type { EvalRunSummary, TurnSummary } from "@/lib/types/telemetry";

// Rendered from typed fixtures, no db in the loop — same pattern as the
// tool-view tests.

const turn = (partial: Partial<TurnSummary>): TurnSummary => ({
  traceId: "a".repeat(32),
  kind: "chat",
  startedAt: new Date("2026-07-03T12:00:00Z"),
  durationMs: 3200,
  status: "unset",
  inputTokens: 300,
  outputTokens: 120,
  costMicroUsd: 2700,
  toolCalls: 2,
  evalRunId: null,
  evalCaseId: null,
  ...partial,
});

const run: EvalRunSummary = {
  runId: "run-2026-07-03",
  startedAt: new Date("2026-07-03T11:00:00Z"),
  caseCount: 24,
  totalInputTokens: 120_000,
  totalOutputTokens: 18_000,
  totalCostMicroUsd: 630_000, // $0.63
  totalDurationMs: 95_000,
};

describe("formatMicroUsd", () => {
  it("keeps sub-cent costs visible instead of rounding to $0.00", () => {
    expect(formatMicroUsd(1050)).toBe("$0.0011"); // one cheap API round
    expect(formatMicroUsd(630_000)).toBe("$0.63");
    expect(formatMicroUsd(null)).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it("scales units with magnitude", () => {
    expect(formatDurationMs(412)).toBe("412 ms");
    expect(formatDurationMs(3200)).toBe("3.2 s");
    expect(formatDurationMs(95_000)).toBe("1m 35s");
  });
});

describe("ObservabilityView", () => {
  it("renders eval runs and turns with formatted values", () => {
    render(
      <ObservabilityView
        turns={[
          turn({}),
          turn({
            traceId: "b".repeat(32),
            kind: "ask",
            status: "error",
            costMicroUsd: null,
            evalRunId: run.runId,
            evalCaseId: "case-austin",
          }),
        ]}
        runs={[run]}
      />,
    );

    // Eval run row
    expect(screen.getByText("run-2026-07-03")).toBeDefined();
    expect(screen.getByText("$0.63")).toBeDefined();
    expect(screen.getByText("1m 35s")).toBeDefined();

    // Turn rows: error status shown, unknown cost is "—" not $0
    expect(screen.getByText("case-austin")).toBeDefined();
    expect(screen.getByText("error")).toBeDefined();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows empty states when nothing is recorded", () => {
    render(<ObservabilityView turns={[]} runs={[]} />);
    expect(screen.getByText(/No eval runs recorded yet/)).toBeDefined();
    expect(screen.getByText(/No spans yet/)).toBeDefined();
  });
});
