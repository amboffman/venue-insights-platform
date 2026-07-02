# 0004. Deterministic generative UI — a typed registry, not model markup

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Week 4 makes tool results render as real UI in the chat: "compare downtown
locations by revenue" should produce a table, not a paragraph of numbers.
"Generative UI" spans a spectrum from the model emitting HTML/JSX to the
model merely selecting data that fixed components render. The direction was
locked at planning time (2026-06-17); this ADR records the reasoning and the
implementation shape now that it exists.

## Options considered

1. **Deterministic registry (chosen)** — a fixed map from tool name → typed
   React component that renders that tool's output schema
   (`src/components/chat/tool-views/registry.tsx`). The model's only
   influence on the UI is *which tool it calls with which arguments*. The
   `tool_result` events already stream structured domain objects (ADR-0003),
   so this slice is purely client-side — zero protocol or server changes.
2. **Model-generated markup** — let the model emit HTML/MDX/JSX and render
   it. Maximally flexible, but untestable (infinite output space), a prompt-
   injection → XSS surface (review text is model-visible input), visually
   inconsistent turn to turn, and impossible to eval deterministically.
3. **Model-selected layout hints** — model emits JSON like
   `{component: "table", columns: [...]}` that a renderer interprets. More
   flexible than a fixed registry, but now the hint schema is a second tool
   contract to validate and eval, for little demo gain at four tools.

## Decision

Option 1. Renderers: `MetricsSummary` (stat-tile row — a deliberate
non-chart, per the dataviz guidance: four headline magnitudes need tiles,
not bars), `ComparisonTable` (exact figures, right-aligned tabular numerals),
`LocationCard` (profile + recent reviews), `LocationList` (capped at 8 rows).
Cents convert to dollars only at the formatting boundary
(`tool-views/format.ts`); tile values auto-compact ($495.5K), table cells
stay exact ($495,479.11).

Unknown tools and `null` outputs render nothing — the activity chip remains
the fallback, so a new tool degrades gracefully instead of breaking the chat.

Wire outputs arrive as `unknown`; renderers cast to the shared domain types
(`lib/types/domain`). The cast is safe because server and client compile
from the same type definitions; if the tool layer ever serves third-party
clients, zod output schemas become the upgrade path.

## Consequences

- Rendering is unit-testable with plain RTL fixtures — no model in the loop.
- Week 5 evals can assert "the comparison renders N rows" from tool outputs
  alone, because UI is a pure function of them.
- The model cannot introduce novel UI, by design; new visualizations are
  code changes (a new registry entry), which is the right review gate.
- Layout hints (option 3) remain adoptable later without protocol changes —
  the registry entry for a tool can itself interpret richer output.
