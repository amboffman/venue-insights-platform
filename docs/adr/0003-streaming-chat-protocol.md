# 0003. NDJSON event stream and stateless, client-held chat history

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Week 3 turns the terminal loop into a deployed chat: a Next.js route handler
must stream the answer while it is generated, the UI must show tool-call
activity as it happens (an explicit acceptance criterion), and the server
runs on Vercel serverless — nothing can be held in memory between requests.
Because we hand-roll the AI layer (ADR-002), there is no framework wire
protocol to inherit; we have to choose one.

## Options considered

### Wire format (route handler → browser)

1. **NDJSON typed events (chosen)** — `POST /api/chat` returns
   `application/x-ndjson`: one JSON event per line (`text_delta`,
   `tool_start`, `tool_result`, `done` with token usage, `error`). Client
   reads it with `fetch` + `ReadableStream`. Tool activity and text are
   separate channels, and Week 4's generative UI renders the `tool_result`
   events as typed components with **no protocol change**.
2. **SSE (`text/event-stream`)** — the formal standard, but the browser's
   built-in `EventSource` client cannot send POST bodies, so we would
   hand-parse the frames anyway: NDJSON's work plus SSE's framing ceremony.
3. **Plain text stream** — simplest, but has no channel for tool activity,
   which the acceptance criteria require.

### Conversation history (server is stateless)

1. **Client resends the visible text transcript (chosen)** — the browser
   holds display state and sends prior user/assistant text turns (capped at
   20) with each request; tool blocks from past turns are not replayed.
   Grounded numbers live in the assistant's text, so follow-ups work; when
   the model needs raw data again it re-calls tools against the seeded DB
   (cheap, deterministic).
2. **Client replays full API messages** (incl. tool_use/tool_result) —
   maximum context fidelity, but payloads balloon and the SDK's message
   shapes leak into the client.
3. **Server-side conversation store** — the production-real answer, but it
   is schema + lifecycle work a demo doesn't need yet; Week 6 persists
   telemetry (per-call spans) regardless, which covers the observability
   need without owning chat state.

## Decision

`src/lib/ai/stream-loop.ts` exposes the loop as an async generator of
`ChatStreamEvent`s (`src/lib/types/chat.ts` is the wire contract). The
route handler (`src/app/api/chat/route.ts`, Node runtime) validates the
body with zod and serializes the generator with a pull-based
`ReadableStream` (`eventsToNdjsonStream`), so client backpressure
propagates to the API stream and a client disconnect cancels the loop.
The chat page holds the transcript and resends text turns.

Testability mirrors ADR-002: the streaming loop depends on a two-method
`StreamingClaudeClient` interface (`textDeltas` + `finalMessage` per
round); `anthropicStreamingClient` adapts the real SDK, tests inject
scripted rounds.

## Consequences

- Week 4 needs zero protocol work: the UI registry keys off
  `tool_result.name` and renders `output` (typed domain objects).
- Losing prior tool context costs an occasional repeated tool call on
  follow-ups — acceptable against a deterministic seeded DB; revisit if a
  conversation store lands later.
- Errors are part of the protocol (`error` event, also emitted if the
  generator crashes mid-stream), so the client always gets parseable
  output instead of a severed connection.
- Refreshing the page clears the conversation — a stated non-goal until
  a conversation store exists.
