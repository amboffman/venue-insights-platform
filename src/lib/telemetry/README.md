# Observability

OpenTelemetry instrumentation: traces, metrics, and structured logs.

## What gets instrumented
- Every Claude API call (latency, token counts, model, cost estimate)
- Every MCP tool invocation (tool name, duration, success/error)
- Request-level traces tying UI actions to AI calls to tool calls