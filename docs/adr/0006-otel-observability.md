# 006. OpenTelemetry observability: manual spans, Postgres exporter

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Week 6 needs spans around every Claude call (latency, tokens, cost estimate)
and every tool invocation (name, duration, outcome), persisted somewhere an
`/observability` page can query. The project's ethos (ADR-0002, ADR-0005) is
DIY-but-real: use the industry-standard data model, but keep every line
explainable in an interview. The instrumentation points already exist as
dependency-injection seams: `ClaudeClient` / `StreamingClaudeClient` are
narrow injected interfaces, and `executeToolUses` is the single chokepoint
for tool execution.

Constraint: the OTel JS SDK went 2.x in Feb 2025 with breaking changes
(`spanProcessors` constructor option replaces `addSpanProcessor`;
`resourceFromAttributes()` replaces `new Resource()`), so this ADR was
written against current docs, not training-data memory.

## Options considered

1. **Full OTel NodeSDK + auto-instrumentations** — free HTTP/pg spans; but
   the spans we actually need (Claude semantics, tool outcomes) are manual
   either way, the dep tree is heavy, and "what does this magic do?" is a
   bad interview position.
2. **`@opentelemetry/api` + minimal tracer provider + custom Postgres
   `SpanExporter`** — every span hand-placed at the DI seams; real OTel
   data model (trace/span IDs, attributes, GenAI semantic conventions);
   spans land in the same Postgres the dashboard reads. Cost: no free
   spans, more hand-written code.
3. **No OTel, timing rows in a table** — cheapest, but abandons the
   standard data model and the resume line; the roadmap explicitly names
   OpenTelemetry.

## Decision

Option 2, with these concrete choices:

- **`BasicTracerProvider` (sdk-trace-base), not `NodeTracerProvider`, and
  explicit parent-context passing instead of a global context manager.**
  `streamAnswer` is an async generator; AsyncLocalStorage-based context
  does not reliably survive `yield` boundaries. Passing `Context` values
  explicitly (`trace.setSpan(...)` → child `tracer.startSpan(name, opts,
  ctx)`) is deterministic, generator-safe, and shows exactly how
  propagation works. This also drops the sdk-trace-node dependency.
- **Global tracer via the OTel API facade, no-op until initialized.**
  `initTelemetry(db)` wires provider + exporter once per process
  (globalThis-cached, same HMR-safe pattern as the db client). Code that
  creates spans calls `trace.getTracer(...)` — a no-op when telemetry was
  never initialized, so unit tests and CI run instrumented code paths with
  zero setup and zero span output.
- **Custom `PostgresSpanExporter` → `lib/db`.** The exporter maps
  `ReadableSpan` → domain `SpanRecord` and calls an insert function in
  `lib/db` (the only layer allowed to speak SQL). One generic `spans`
  table mirroring the OTel model (trace/span/parent IDs, name, times,
  status, `attributes` jsonb). Jsonb over typed columns: Claude spans and
  tool spans carry different attributes; the dashboard extracts the keys
  it needs. `duration_ms` is denormalized for cheap aggregation.
- **`SimpleSpanProcessor`, not `BatchSpanProcessor`.** Serverless functions
  freeze after the response; a batch buffer would silently drop spans.
  Export-on-end plus an awaitable `flushTelemetry()` for route/runner
  shutdown is the correct default at this scale.
- **GenAI semantic-convention attribute names** (`gen_ai.operation.name`,
  `gen_ai.request.model`, `gen_ai.usage.input_tokens`, …) as local
  constants citing semconv — the names are the standard; the
  `/incubating` package entrypoint is explicitly unstable, so we don't
  import it. Stable names (`service.name`) come from
  `@opentelemetry/semantic-conventions` proper.
- **Cost as integer microdollars.** $/MTok ≡ µ$/token, so
  `cost = inputTokens × 3 + outputTokens × 15` for `claude-sonnet-5`
  (sticker $3/$15 per MTok; the $2/$10 intro price expires 2026-08-31,
  the day before the demo, so the durable number is used). Integer money,
  same discipline as ADR-001. Unknown model → no estimate (null), never a
  guess. Attribute: `mlip.cost_microusd`.

## Consequences

- Claude calls, tool runs, and whole turns become trace trees in Postgres;
  the Week 6 dashboard is a `GROUP BY trace_id` / attribute query away.
- Eval-run correlation happens via span attributes
  (`mlip.eval.run_id` / `case_id`) passed through `AskOptions` — flat
  attribute grouping instead of cross-package context plumbing.
- No automatic HTTP/DB spans; if we ever want them, NodeSDK can be added
  alongside without touching the manual spans.
- Every span writes a Postgres row; fine at portfolio scale, and the
  exporter is the single place to add sampling if that ever changes.
- Pricing constants are hardcoded and dated; a model change requires
  updating the table (the estimator returns null rather than misprice).
