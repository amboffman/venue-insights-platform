import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { generateSeedData, type SeedData } from "@/lib/db/seed-data";

// One shared setup for every PGlite-backed suite: real migrations, real seed
// data, seeded through the SAME seedDatabase the live database uses. Callers
// must close() in afterAll — a leaked WASM Postgres instance holds the
// worker open.

export interface SeededDb {
  db: Database;
  seed: SeedData;
  close(): Promise<void>;
}

export async function createSeededDb(): Promise<SeededDb> {
  const client = new PGlite();
  const pglite = drizzle(client, { schema });
  await migrate(pglite, { migrationsFolder: "src/lib/db/migrations" });

  const seed = generateSeedData();
  const db = pglite as unknown as Database;
  await seedDatabase(db, seed);

  return { db, seed, close: () => client.close() };
}
