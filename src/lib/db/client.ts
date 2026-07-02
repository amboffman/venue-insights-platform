import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// The driver-agnostic database handle. Query functions accept this instead
// of importing a singleton, so tests can pass a PGlite instance and the app
// passes the postgres-js one below.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

// Cached on globalThis because Next dev re-evaluates modules on HMR, which
// would otherwise leak a connection pool per reload.
const globalForDb = globalThis as unknown as { __mlipDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__mlipDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    }
    // prepare: false — Supabase's transaction pooler (pgBouncer) does not
    // support prepared statements.
    const client = postgres(url, { prepare: false });
    globalForDb.__mlipDb = drizzle(client, { schema });
  }
  return globalForDb.__mlipDb;
}
