// Throwaway Week 2 harness: ask a question from the terminal and watch the
// tool loop work. Superseded by the chat UI in Week 3.
//
//   pnpm ask "Which Austin location has the highest revenue this year?"
//
// Requires DATABASE_URL (seeded) and ANTHROPIC_API_KEY in .env.local.
import { config } from "dotenv";

import Anthropic from "@anthropic-ai/sdk";

import { askQuestion } from "../src/lib/ai/tool-loop";
import { getDb } from "../src/lib/db/client";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: pnpm ask "your question here"');
    process.exitCode = 1;
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  const started = performance.now();
  const result = await askQuestion({ client: new Anthropic(), db: getDb() }, question);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  for (const call of result.toolCalls) {
    const status = call.ok ? "ok" : `ERROR: ${call.error}`;
    console.log(`[tool] ${call.name}(${JSON.stringify(call.input)}) → ${status}`);
  }
  console.log(`\n${result.answer}\n`);
  console.log(
    `(${result.iterations} round-trip${result.iterations === 1 ? "" : "s"}, ` +
      `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens, ` +
      `${seconds}s, stop: ${result.stopReason})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
