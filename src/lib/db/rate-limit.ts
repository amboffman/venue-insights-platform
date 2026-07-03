import { lte, sql } from "drizzle-orm";

import type { Database } from "./client";
import { rateLimits } from "./schema";

// Fixed-window rate limiting in plain Postgres (ADR-0007). Serverless
// functions share no memory, so the counter must live in a store — and we
// already operate exactly one store. Fixed windows allow a burst of up to
// 2× the limit straddling a boundary; acceptable for cost control, and the
// daily budget gate caps the damage regardless.

export interface RateLimitHit {
  /** requests seen in this window, including this one */
  count: number;
  /** seconds until the window resets — Retry-After material */
  retryAfterSeconds: number;
}

/** Count one hit against `scope` (e.g. "chat:203.0.113.7"). One upsert,
 * plus an opportunistic purge of expired windows so the table never needs
 * a scheduled cleanup. `now` is a parameter, not a clock read — the tests
 * drive window boundaries deterministically. */
export async function hitRateLimit(
  db: Database,
  scope: string,
  now: Date,
  windowMs: number,
): Promise<RateLimitHit> {
  const windowIndex = Math.floor(now.getTime() / windowMs);
  const expiresAt = new Date((windowIndex + 1) * windowMs);

  // lte, not lt: windows are [start, end) — a row expiring exactly at `now`
  // belongs to a window that is already over.
  await db.delete(rateLimits).where(lte(rateLimits.expiresAt, now));

  const [row] = await db
    .insert(rateLimits)
    .values({ key: `${scope}:${windowIndex}`, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  return {
    // .returning() always yields the upserted row; the assertion satisfies
    // noUncheckedIndexedAccess.
    count: row!.count,
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}
