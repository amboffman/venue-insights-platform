# Venue Insights — architecture writeup

_The narrative version of [ten ADRs](./adr/). Each section: the decision,
what it beat, and what it cost. Written for a technical reader deciding
whether the author can design AI systems, not just wire up an SDK._

## The product in one paragraph

A multi-location business-intelligence platform over a seeded portfolio
(5 brands, 50 US locations, a year of daily metrics): a stakeholder
dashboard whose AI analyst receives the current filter state with every
question, a streaming chat with deterministic generative UI, an MCP server
exposing the same tools to Claude Desktop, and a DIY eval + observability
layer that scores answer quality and meters spend in microdollars. Live at
[venue-insights-platform.vercel.app](https://venue-insights-platform.vercel.app).

## The spine: a hand-rolled tool loop (ADR-0002)

The core is a tool-use loop written directly on `@anthropic-ai/sdk` — no
Vercel AI SDK, no LangChain. That was a learning-first decision with a real
engineering payoff: every wire-protocol subtlety is owned code with a test.
Three that frameworks hide:

- **All tool results for one assistant turn return in a single user
  message** — splitting them across messages quietly teaches the model to
  stop parallelizing.
- **Failed tools still return a `tool_result` with `is_error: true`** — the
  model reads the error text and self-corrects (tested: invalid
  `locationId: "abc"` → zod error fed back → model retries with a number).
- **`pause_turn` means resume, not done.**

Tool schemas are **zod single-sourced**: one schema per tool produces the
JSON Schema the API sees (`z.toJSONSchema`), validates what the model
actually sends back, and types the handler. Alternatives drift — two
sources of truth for a schema is how "the model keeps passing invalid
args" bugs are born. The valid brand slugs are baked into the schema as an
enum, so the model cannot guess an invalid one; the vocabulary is part of
the contract rather than prompt engineering.

**Cost accepted:** we maintain streaming, retries, and history management
ourselves (~two files), and rebuilding what a framework gives free is only
defensible when being able to explain every layer is a goal — here it was
the goal.

## Determinism as a load-bearing wall (ADR-0001, ADR-0005)

The seed is a pure function: seeded RNG, fixed end date (never "today").
That single property makes three other systems possible:

- **Golden evals with exact expectations** — 24 cases whose expected tool
  calls *and* expected numbers are computed from the seed arrays, so
  "the answer must contain $X" is a real assertion, not a vibe.
- **Credential-free tests on real SQL** — PGlite (Postgres compiled to
  WASM) runs the actual generated migrations and the actual queries at
  unit-test speed. Query tests compute every expected value independently
  in TypeScript (filter + reduce over the seed) and assert SQL agrees —
  two implementations agreeing beats eyeballed constants.
- **A byte-stable system prompt** — no clock in the prompt, which keeps
  eval behavior reproducible and the prompt-cache prefix intact.

## Generative UI that never generates markup (ADR-0004)

"Generative UI" here means the model generates *decisions* — which tool,
which arguments — and a fixed registry maps tool name → a typed React
component rendering that tool's output schema. The model never emits
markup. Three reasons: **testability** (registry renders from typed
fixtures in plain RTL tests), **security** (review text flows through the
model; model-generated HTML would turn a malicious customer review into an
XSS vector — in the registry it only ever lands in React text nodes), and
**consistency** (same output, same pixels, every turn — which is also what
lets evals assert on tool outputs alone). The honest cost: the model can
never invent a novel visualization; adding a view is a code change. In a
product with a fixed tool vocabulary that is a review gate, not a
limitation.

## One implementation, two transports (ADR-0008)

`lib/mcp` tools are pure functions behind two seams: `getToolSpecs()`
(name, description, JSON Schema) and `runTool()` (validate → act → typed
result union, never throws). The in-process loop consumes them directly;
a stdio MCP server maps the two protocol requests (`tools/list`,
`tools/call`) onto the *same* seams — zero schema duplication, and a tool
fix lands in both transports by construction.

The server deliberately uses the SDK's **low-level `Server`**, not the
high-level sugar: the tutorial path re-registers schemas (a second source
of truth) while the low-level path passes through the existing JSON
Schemas byte-for-byte. SDK v1 is pinned — v2 was in beta with a spec
release scheduled inside our feature-freeze window, and shipping clients
speak v1.

Two production bugs the E2E smoke caught that unit tests could not: tsx
transforms `scripts/` as CJS (top-level `await` dies at launch — the
protocol tests passed because vitest is ESM), and the server lingered as a
zombie process after client disconnect on Windows (stdin EOF didn't fire
the SDK's close hook; fixed with explicit EOF handlers and an
unconditional exit).

## Evals: deterministic scorers and honest numbers (ADR-0005)

Three pure-function scorers run over each case's transcript — no model in
the scoring loop, so the whole layer unit-tests for free:

- **Tool selection** (multiset matching — expecting the same tool twice
  requires two calls; set membership would double-count),
- **Argument correctness** (subset match on pinned keys, best candidate
  per expectation, key-order-independent deep equality),
- **Groundedness** — every numeric claim in the answer must trace to tool
  output of the same run. Claims carry **precision-band tolerance**: half
  the place value of the last written digit, so "$3.1M" earns ±$50K while
  "28,296" earns ±0.5. A flat percentage fails one direction or the other.
  Unit conversion happens on the side where the unit is *known* (outputs
  are integer cents; every grounded value is offered raw and ÷100) —
  guessing units from the claim's text shape was tried and breaks ratings.

### Eval results

First full run (2026-07-03, claude-sonnet-5, 24 cases, $0.57):
**tool selection 0.896 · argument correctness 0.958 · groundedness 0.867.**

The misses are the interesting part, and almost none are hallucinations:

| Class | Example | Count | Verdict |
|---|---|---|---|
| Derived values | model counts a 12-row result → "12" appears nowhere as a literal | ~7 cases | correct answers the scorer can't trace — a documented limitation, not a model failure |
| Case strictness | answered address+phone from search output without the "expected" details call; refused an out-of-window 2024 query from the system prompt | 2–3 | arguably *better* behavior than the case pinned |
| List ordinals | "1. … 2. … 3. …" counted as numeric claims | 1 | scorer regex gap, cheap fix |
| System-prompt facts | "5 brands, 50 locations" — true, but not from a tool | 1–2 | ungrounded by definition |

**Zero invented dollar figures.** Publishing 0.867 with this taxonomy is
worth more than tuning cases until a 1.0 appears — the taxonomy is the
evidence the harness measures something real. Known blind spots, on
purpose: non-numeric hallucinations and grounded-but-wrong-field numbers —
both are LLM-judge territory (the planned stretch), not deterministic-
scorer territory.

## Observability that also does the security job (ADR-0006, ADR-0007)

Every turn is an OpenTelemetry trace tree — `chat <model>` spans per API
round (GenAI semconv attributes, tokens, cost) and `execute_tool` spans
per tool run — exported by a custom `SpanExporter` into the app's own
Postgres, where a force-dynamic page renders cost and latency per turn and
per eval run.

Non-obvious choices that earn their keep:

- **Explicit parent-context passing** instead of OTel's AsyncLocalStorage
  magic — the streaming loop is an async generator, and ambient context
  does not reliably survive `yield`. Passing the parent as a value is
  deterministic and shows what propagation actually is.
- **No-op until initialized** — the OTel API facade hands out no-op tracers
  until `initTelemetry(db)` runs, so 123 tests run instrumented code paths
  with zero setup.
- **Export-on-end, flush inside the stream** — serverless freezes the
  instant the response finishes, so a batch buffer would silently drop
  spans, and the flush is awaited in the generator's `finally` *while the
  NDJSON stream is still open*.
- **Cost in integer microdollars** — $/MTok ≡ µ$/token, so cost is
  `inputTokens × 3 + outputTokens × 15` with no floats anywhere (the same
  integer-money rule as cents in the domain schema). An unknown model
  yields `null`, rendered as "—": a missing estimate is honest; a guessed
  $0 poisons the dashboard.

Then the layer pays rent twice: the public chat endpoint reads *today's
spend from the spans table* before running a turn — a *daily budget
circuit-breaker* (429 + Retry-After until UTC midnight) layered over a
per-IP fixed-window rate limit in plain Postgres, with the provider-side
spend cap as the hard backstop. Threat model: the data is synthetic and
read-only, so the only asset at risk is API spend — the mitigation only
has to bound dollars. The gates live in the route handler, not the AI
layer, so evals are never throttled; and abusive traffic bills itself onto
the same dashboard that measures it.

## The dashboard the AI can see (ADR-0009)

The homepage is a filtered portfolio overview (KPI tiles, revenue-by-brand
bars, monthly trend, top locations) whose **filter state travels with
every chat request** — a deterministic ~150-character context line
prefixed server-side onto the last user turn. Never the system prompt:
that must stay byte-stable for prompt caching. "Ask AI" buttons on each
card fire pre-scoped questions into the rail, so "why the June dip?" means
*this view's* June.

Craft notes: filter state lives in the URL (shareable, server-rendered,
vocabulary-validated); charts are hand-rolled divs + one SVG (two simple
forms don't justify a chart dependency) following a strict dataviz method —
forms picked by the data's job, a single hue *validated by script* against
the app's actual surfaces in both color modes, values only ever in text
tokens, crosshair tooltip with keyboard parity.

## What I'd build next

- **LLM-judge scorer** for the two documented blind spots (non-numeric
  claims, wrong-field numbers) — the deterministic scorers stay as the
  regression floor; the judge samples.
- **MCP `outputSchema` / `structuredContent`** so MCP clients get typed
  results, not JSON text.
- **Pinboard mode** (the runner-up dashboard design): chat answers pin to
  a persistent board — generative dashboards on the same registry.
- **Scorer refinements** from the taxonomy: exempt list ordinals, ground
  array lengths (derived-value class).

---

_Numbers current as of 2026-07-03: 123 tests across 21 files, 10 ADRs,
4 tools serving 2 transports, ~$0.57 per full eval run._
