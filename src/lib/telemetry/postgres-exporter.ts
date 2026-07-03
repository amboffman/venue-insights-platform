import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode, hrTimeToMilliseconds, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

import type { Database } from "../db/client";
import { insertSpans } from "../db/spans";
import type { SpanRecord, SpanStatus } from "../types/telemetry";

const STATUS_NAMES: Record<SpanStatusCode, SpanStatus> = {
  [SpanStatusCode.UNSET]: "unset",
  [SpanStatusCode.OK]: "ok",
  [SpanStatusCode.ERROR]: "error",
};

/** OTel ReadableSpan → domain SpanRecord. HrTime is [seconds, nanos];
 * millisecond precision is plenty for a latency dashboard. */
export function toSpanRecord(span: ReadableSpan): SpanRecord {
  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    // 2.x renamed parentSpanId → parentSpanContext (upgrade guide).
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    name: span.name,
    startedAt: new Date(hrTimeToMilliseconds(span.startTime)),
    endedAt: new Date(hrTimeToMilliseconds(span.endTime)),
    durationMs: hrTimeToMilliseconds(span.duration),
    status: STATUS_NAMES[span.status.code],
    statusMessage: span.status.message ?? null,
    attributes: { ...span.attributes },
  };
}

/** SpanExporter that writes finished spans into the app's own Postgres via
 * lib/db (the only layer allowed to speak SQL) — the observability page
 * reads the same table back (ADR-0006). */
export class PostgresSpanExporter implements SpanExporter {
  constructor(private readonly db: Database) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    insertSpans(this.db, spans.map(toSpanRecord))
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error: unknown) => {
        // Telemetry must never take the app down — report failure to the
        // processor and move on.
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
