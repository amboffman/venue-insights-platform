import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertSpans } from "@/lib/db/spans";
import { spans } from "@/lib/db/schema";
import { PostgresSpanExporter } from "@/lib/telemetry/postgres-exporter";
import type { SpanRecord } from "@/lib/types/telemetry";

import { createSeededDb, type SeededDb } from "../helpers/seeded-db";

// The exporter is exercised through a REAL (local, non-global) tracer
// provider against REAL migrations in PGlite — the same end-to-end path
// production spans take, minus only the postgres-js driver.

describe("PostgresSpanExporter", () => {
  let seeded: SeededDb;
  let provider: BasicTracerProvider;

  beforeAll(async () => {
    seeded = await createSeededDb();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new PostgresSpanExporter(seeded.db))],
    });
  });

  afterAll(async () => {
    await provider.shutdown();
    await seeded.close();
  });

  it("persists a span tree with parentage, attributes, status, and timing", async () => {
    const tracer = provider.getTracer("test");

    const parent = tracer.startSpan("mlip.ask", { attributes: { "mlip.iterations": 2 } });
    const parentCtx = trace.setSpan(context.active(), parent);

    const child = tracer.startSpan(
      "chat claude-sonnet-5",
      { attributes: { "gen_ai.usage.input_tokens": 100 } },
      parentCtx,
    );
    child.setStatus({ code: SpanStatusCode.OK });
    child.end();

    const failed = tracer.startSpan("execute_tool nope", {}, parentCtx);
    failed.setStatus({ code: SpanStatusCode.ERROR, message: "boom" });
    failed.end();

    parent.end();
    await provider.forceFlush();

    const rows = await seeded.db.select().from(spans);
    expect(rows).toHaveLength(3);

    const parentRow = rows.find((row) => row.name === "mlip.ask");
    const childRow = rows.find((row) => row.name === "chat claude-sonnet-5");
    const failedRow = rows.find((row) => row.name === "execute_tool nope");
    expect(parentRow).toBeDefined();
    expect(childRow).toBeDefined();
    expect(failedRow).toBeDefined();

    // One turn = one trace; children point at the root.
    expect(childRow!.traceId).toBe(parentRow!.traceId);
    expect(failedRow!.traceId).toBe(parentRow!.traceId);
    expect(childRow!.parentSpanId).toBe(parentRow!.spanId);
    expect(parentRow!.parentSpanId).toBeNull();

    // Attributes survive the jsonb round-trip.
    expect((parentRow!.attributes as Record<string, unknown>)["mlip.iterations"]).toBe(2);
    expect((childRow!.attributes as Record<string, unknown>)["gen_ai.usage.input_tokens"]).toBe(
      100,
    );

    expect(childRow!.status).toBe("ok");
    expect(failedRow!.status).toBe("error");
    expect(failedRow!.statusMessage).toBe("boom");
    expect(parentRow!.status).toBe("unset");

    expect(parentRow!.durationMs).toBeGreaterThanOrEqual(0);
    expect(parentRow!.endedAt.getTime()).toBeGreaterThanOrEqual(parentRow!.startedAt.getTime());
  });

  it("re-exporting the same span id is a no-op, not a failure", async () => {
    const record: SpanRecord = {
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "feedfacefeedface",
      parentSpanId: null,
      name: "retry.victim",
      startedAt: new Date("2026-07-03T00:00:00Z"),
      endedAt: new Date("2026-07-03T00:00:01Z"),
      durationMs: 1000,
      status: "ok",
      statusMessage: null,
      attributes: { attempt: 1 },
    };

    await insertSpans(seeded.db, [record]);
    await insertSpans(seeded.db, [record]); // retried export must not throw

    const rows = await seeded.db.select().from(spans);
    expect(rows.filter((row) => row.spanId === "feedfacefeedface")).toHaveLength(1);
  });
});
