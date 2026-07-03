import { sql } from "drizzle-orm";

import type { Database } from "./client";
import * as schema from "./schema";
import type { SeedData } from "./seed-data";

// The write half of seeding, inside lib/db so SQL stays in this layer
// (scripts/seed.ts is only env + connection + logging). Also used by the
// PGlite test helper, so tests seed through the exact code the live
// database does.

// Postgres caps a statement at 65534 bind parameters; chunking keeps each
// insert comfortably under it regardless of column count.
export const SEED_CHUNK_SIZE = 1000;

export async function insertChunked<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
  chunkSize: number = SEED_CHUNK_SIZE,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
  }
}

/** Truncate + insert the full deterministic dataset. Idempotent: re-runs
 * produce byte-identical tables. */
export async function seedDatabase(db: Database, data: SeedData): Promise<void> {
  // RESTART IDENTITY so a re-run produces identical IDs.
  await db.execute(
    sql`truncate table daily_metrics, reviews, locations, brands restart identity cascade`,
  );

  await insertChunked((r) => db.insert(schema.brands).values(r), data.brands);
  await insertChunked((r) => db.insert(schema.locations).values(r), data.locations);
  await insertChunked((r) => db.insert(schema.reviews).values(r), data.reviews);
  await insertChunked((r) => db.insert(schema.dailyMetrics).values(r), data.dailyMetrics);

  // The seed inserts explicit IDs, which leaves every identity sequence at 1;
  // advance them so a future default-identity insert doesn't collide with
  // seeded rows on its first write.
  for (const table of ["brands", "locations", "reviews", "daily_metrics"]) {
    await db.execute(
      sql.raw(
        `select setval(pg_get_serial_sequence('${table}', 'id'), (select coalesce(max(id), 1) from ${table}))`,
      ),
    );
  }
}
