import { defineConfig } from "vitest/config";

// Separate config for `pnpm eval` ONLY. Eval runs call the real Claude API
// and cost tokens; the main vitest.config.mts never picks up *.eval.ts and
// CI never invokes this config (ADR-0005).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Gentle parallelism: fast enough for 24 cases, polite to rate limits.
    maxConcurrency: 4,
  },
});
