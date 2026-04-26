# AI Orchestration

Claude API client, prompt construction, response parsing, and tool-call handling.

## Boundaries
- Server-only. Never imported from Client Components.
- No direct DB access — call into `lib/db` via well-typed functions.
- No UI concerns — returns plain data, never JSX.

## Failure modes handled here
- Timeouts, rate limits, network errors
- Malformed tool calls from the model
- Hallucinated outputs (validated against schemas before returning)