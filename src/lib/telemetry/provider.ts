import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import type { Database } from "../db/client";
import { PostgresSpanExporter } from "./postgres-exporter";

// Provider lifecycle. Idempotent and cached on globalThis (HMR-safe, same
// pattern as the db client). Until initTelemetry runs, trace.getTracer()
// hands out no-op tracers — instrumented code paths cost nothing in unit
// tests and CI, which never initialize telemetry.

const globalForTelemetry = globalThis as unknown as {
  __mlipTracerProvider?: BasicTracerProvider;
};

export function installTelemetry(exporter: SpanExporter): void {
  if (globalForTelemetry.__mlipTracerProvider) return;
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "mlip" }),
    // Simple (export-on-end), not Batch: serverless functions freeze right
    // after the response, and a batch buffer would silently drop spans.
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  globalForTelemetry.__mlipTracerProvider = provider;
}

/** Wire spans → Postgres. Called once per process by anything that wants
 * telemetry (chat route, eval runner); everything else stays no-op. */
export function initTelemetry(db: Database): void {
  installTelemetry(new PostgresSpanExporter(db));
}

/** Await in-flight exports — one-shot processes (eval runs, scripts) call
 * this before exit so the last spans aren't lost. */
export async function flushTelemetry(): Promise<void> {
  await globalForTelemetry.__mlipTracerProvider?.forceFlush();
}

/** Tear down and reset the API global (tests). */
export async function shutdownTelemetry(): Promise<void> {
  await globalForTelemetry.__mlipTracerProvider?.shutdown();
  globalForTelemetry.__mlipTracerProvider = undefined;
  trace.disable();
}
