import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EvalReport, ScorerResult } from "./types";

// Renders the per-run artifact (ADR-0005): machine-readable JSON plus a
// human-readable markdown summary whose job is to answer "where does the
// agent fail?" at a glance.

function cell(result: ScorerResult | undefined): string {
  if (!result || result.score === null) return "—";
  return result.score.toFixed(2);
}

export function reportToMarkdown(report: EvalReport): string {
  const lines: string[] = [
    `# Eval run — ${report.runAt}`,
    "",
    `Model: \`${report.model}\` · ${report.caseCount} cases · ` +
      `${report.summary.totalUsage.inputTokens.toLocaleString()} in / ` +
      `${report.summary.totalUsage.outputTokens.toLocaleString()} out tokens · ` +
      `${Math.round(report.summary.totalDurationMs / 1000)}s total`,
    "",
    "## Summary",
    "",
    ...Object.entries(report.summary.meanScores).map(
      ([name, mean]) => `- **${name}**: ${mean.toFixed(3)}`,
    ),
    "",
    "## Cases",
    "",
    "| case | tools | args | grounded | round-trips | ms |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.cases.map(
      (c) =>
        `| ${c.caseId} | ${cell(c.scores.toolSelection)} | ` +
        `${cell(c.scores.argumentCorrectness)} | ${cell(c.scores.groundedness)} | ` +
        `${c.iterations} | ${c.durationMs} |`,
    ),
    "",
    "## Failures",
    "",
  ];

  let anyFailure = false;
  for (const c of report.cases) {
    // score === null means the scorer didn't run (errored or not yet
    // implemented) — those details MUST surface here, or a broken scorer is
    // indistinguishable from a passing one.
    const misses = Object.entries(c.scores)
      .filter(([, s]) => (s.score === null || s.score < 1) && s.details.length > 0)
      .flatMap(([name, s]) => s.details.map((d) => `  - [${name}] ${d}`));
    if (c.error) {
      misses.unshift(`  - [pipeline] ${c.error}`);
    }
    if (misses.length > 0) {
      anyFailure = true;
      lines.push(`### ${c.caseId}`, "", `> ${c.question}`, "", ...misses, "");
    }
  }
  if (!anyFailure) lines.push("None — all scored checks passed.", "");

  return lines.join("\n");
}

/** Writes run-<timestamp>.json + .md under eval-reports/ (gitignored). */
export function writeReport(report: EvalReport, dir = "eval-reports"): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const base = join(dir, `run-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, reportToMarkdown(report));
  return base;
}
