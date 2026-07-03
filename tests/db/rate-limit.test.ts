import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hitRateLimit } from "@/lib/db/rate-limit";
import { rateLimits } from "@/lib/db/schema";

import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// `now` is a parameter everywhere, so window boundaries are driven
// deterministically — no clocks, no sleeps.

const WINDOW_MS = 10 * 60_000;
// Aligned to a window start so "same window" and "next window" are exact.
const T0 = new Date(Math.ceil(new Date("2026-07-03T12:00:00Z").getTime() / WINDOW_MS) * WINDOW_MS);
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe("hitRateLimit", () => {
  let seeded: SeededDb;

  beforeAll(async () => {
    seeded = await createSeededDb();
  });

  afterAll(async () => {
    await seeded.close();
  });

  it("counts hits within one window and reports time-to-reset", async () => {
    const first = await hitRateLimit(seeded.db, "chat:1.2.3.4", at(0), WINDOW_MS);
    expect(first.count).toBe(1);
    expect(first.retryAfterSeconds).toBe(WINDOW_MS / 1000);

    const second = await hitRateLimit(seeded.db, "chat:1.2.3.4", at(60_000), WINDOW_MS);
    expect(second.count).toBe(2);
    expect(second.retryAfterSeconds).toBe((WINDOW_MS - 60_000) / 1000);
  });

  it("isolates scopes from each other", async () => {
    const other = await hitRateLimit(seeded.db, "chat:5.6.7.8", at(0), WINDOW_MS);
    expect(other.count).toBe(1);
  });

  it("starts a fresh count in the next window and purges expired rows", async () => {
    const nextWindow = await hitRateLimit(seeded.db, "chat:1.2.3.4", at(WINDOW_MS), WINDOW_MS);
    expect(nextWindow.count).toBe(1);

    // The old window's row (expired relative to `now`) was purged by the hit.
    const rows = await seeded.db.select().from(rateLimits);
    const keys = rows.map((row) => row.key);
    expect(keys.every((key) => !key.endsWith(`:${Math.floor(T0.getTime() / WINDOW_MS)}`))).toBe(
      true,
    );
  });
});
