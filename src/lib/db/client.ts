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
const globalForDb = globalThis as unknown as {
  __mlipDb?: Database;
  __mlipSql?: ReturnType<typeof postgres>;
};

export function getDb(): Database {
  if (!globalForDb.__mlipDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    }
    const client = postgres(url, {
      // Supabase's transaction pooler (pgBouncer) does not support
      // prepared statements.
      prepare: false,
      // The library defaults (max 10, idle connections held ~30-60min)
      // are tuned for a long-lived server. On Vercel every function
      // instance owns its own pool and freezes between invocations, so
      // defaults quietly accumulate held sockets toward Supavisor's
      // client limit. Small pool, short idle: one homepage render fans
      // out 4-6 queries, which share these 5 connections fine.
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      // The driver's default notice handler is console.log — i.e. stdout,
      // which is the JSON-RPC channel when this client runs under the MCP
      // stdio server. One pooler NOTICE mid-session would corrupt the
      // framing and drop the server. Notices are advisory; stderr keeps
      // them visible without touching the protocol stream.
      onnotice: (notice) => console.error("postgres notice:", notice.message),
    });
    globalForDb.__mlipSql = client;
    globalForDb.__mlipDb = drizzle(client, { schema });
  }
  return globalForDb.__mlipDb;
}

/** Close the pool so one-shot processes (eval runs, scripts) exit cleanly.
 * The Next server never calls this. Bounded: a wedged pooler close
 * (observed with Supabase) must not hang a finished script forever —
 * after 5s the remaining sockets are destroyed instead of drained. */
export async function closeDb(): Promise<void> {
  await globalForDb.__mlipSql?.end({ timeout: 5 });
  globalForDb.__mlipSql = undefined;
  globalForDb.__mlipDb = undefined;
}
