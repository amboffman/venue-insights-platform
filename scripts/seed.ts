// Thin CLI around lib/db's seedDatabase: env, connection, logging only.
import { config } from "dotenv";

import { closeDb, getDb } from "../src/lib/db/client";
import { seedDatabase } from "../src/lib/db/seed";
import { DEFAULT_SEED, generateSeedData } from "../src/lib/db/seed-data";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const started = performance.now();
  const data = generateSeedData(DEFAULT_SEED);

  await seedDatabase(getDb(), data);

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Seeded (seed=${DEFAULT_SEED}) in ${seconds}s: ` +
      `${data.brands.length} brands, ${data.locations.length} locations, ` +
      `${data.reviews.length} reviews, ${data.dailyMetrics.length} daily metrics.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // Close the pool and let the process exit naturally — a hard process.exit
  // can truncate stdout still buffered in a pipe on Windows. The close is
  // swallowed on failure: returning its rejection from finally() would turn
  // a successful seed into an unhandled-rejection crash.
  .finally(() => closeDb().catch(() => undefined));
