// Crosses the lib/telemetry → lib/db boundary: the span exporter produces
// these, the db layer persists them, the observability page queries them
// back. Mirrors the OTel span model, not any driver's row shape.

export type SpanStatus = "unset" | "ok" | "error";

export interface SpanRecord {
  /** 32-hex OTel trace id — one turn/question = one trace */
  traceId: string;
  /** 16-hex OTel span id */
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  status: SpanStatus;
  statusMessage: string | null;
  attributes: Record<string, unknown>;
}
