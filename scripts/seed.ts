import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/lib/db/schema";
import { DEFAULT_SEED, generateSeedData } from "../src/lib/db/seed-data";

config({ path: ".env.local" });

// Postgres caps a statement at 65534 bind parameters; chunking keeps each
// insert comfortably under it regardless of column count.
const CHUNK_SIZE = 1000;

async function insertChunked<T>(insert: (rows: T[]) => Promise<unknown>, rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await insert(rows.slice(i, i + CHUNK_SIZE));
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }

  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client, { schema });
  const started = performance.now();

  try {
    const data = generateSeedData(DEFAULT_SEED);

    // RESTART IDENTITY so a re-run produces byte-identical IDs.
    await db.execute(
      sql`truncate table daily_metrics, reviews, locations, brands restart identity cascade`,
    );

    await insertChunked((r) => db.insert(schema.brands).values(r), data.brands);
    await insertChunked((r) => db.insert(schema.locations).values(r), data.locations);
    await insertChunked((r) => db.insert(schema.reviews).values(r), data.reviews);
    await insertChunked((r) => db.insert(schema.dailyMetrics).values(r), data.dailyMetrics);

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `Seeded (seed=${DEFAULT_SEED}) in ${seconds}s: ` +
        `${data.brands.length} brands, ${data.locations.length} locations, ` +
        `${data.reviews.length} reviews, ${data.dailyMetrics.length} daily metrics.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
