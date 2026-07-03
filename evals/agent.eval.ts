// The eval run: 24 golden cases against the REAL Claude API and the REAL
// seeded database. Costs tokens by design — run with `pnpm eval`, never in
// CI (ADR-0005). Report artifacts land in eval-reports/ (gitignored).
import { config } from "dotenv";
import { afterAll, describe, expect, it } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import type { AskDeps } from "@/lib/ai/tool-loop";
import { closeDb, getDb } from "@/lib/db/client";
import { buildGoldenCases } from "@/lib/evals/golden";
import { writeReport } from "@/lib/evals/report";
import { buildReport, runCase } from "@/lib/evals/runner";
import type { CaseResult } from "@/lib/evals/types";

config({ path: ".env.local" });

if (!process.env.ANTHROPIC_API_KEY || !process.env.DATABASE_URL) {
  throw new Error(
    "Evals need ANTHROPIC_API_KEY and DATABASE_URL in .env.local — they run against the real API and database.",
  );
}

const deps: AskDeps = { client: new Anthropic(), db: getDb() };
const cases = buildGoldenCases();
const results: CaseResult[] = [];

describe("agent eval", () => {
  for (const evalCase of cases) {
    // concurrent within the file (maxConcurrency in the eval config) — a
    // full serial run of 24 cases would take several minutes.
    it.concurrent(evalCase.id, async () => {
      let result;
      try {
        result = await runCase(deps, evalCase);
      } catch (error) {
        // A pipeline failure (API 529, timeout) still gets a row in the
        // report — a silently missing case would misrepresent the run.
        results.push({
          caseId: evalCase.id,
          question: evalCase.question,
          answer: "",
          toolCalls: [],
          scores: {},
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 0,
          iterations: 0,
          stopReason: null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      results.push(result);
      // Cases don't hard-fail on low scores — the report is the deliverable
      // ("show where the agent fails"). Only a broken pipeline fails the run.
      expect(result.stopReason).not.toBeNull();
      expect(result.answer.length + result.toolCalls.length).toBeGreaterThan(0);
    });
  }

  afterAll(async () => {
    const report = buildReport(results);
    const base = writeReport(report);
    console.log(`\nEval report written to ${base}.md (+ .json)`);
    console.log("Mean scores:", report.summary.meanScores);
    await closeDb();
  });
});
