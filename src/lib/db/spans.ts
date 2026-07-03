import type { SpanRecord } from "../types/telemetry";
import type { Database } from "./client";
import { spans } from "./schema";

/** Persist a batch of finished spans (the exporter path). Idempotent on
 * span id: a retried export must not fail the whole batch on rows that
 * already landed. */
export async function insertSpans(db: Database, records: SpanRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(spans)
    .values(
      records.map((record) => ({
        spanId: record.spanId,
        traceId: record.traceId,
        parentSpanId: record.parentSpanId,
        name: record.name,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        durationMs: record.durationMs,
        status: record.status,
        statusMessage: record.statusMessage,
        attributes: record.attributes,
      })),
    )
    .onConflictDoNothing({ target: spans.spanId });
}
