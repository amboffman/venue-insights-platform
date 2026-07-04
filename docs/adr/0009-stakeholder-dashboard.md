# 009. Stakeholder dashboard: linked view + context-aware chat

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

With Weeks 1–7 complete eight weeks early, "dashboard charts" was pulled
forward from the Week 9 buffer (it sat at trim-ladder #2 — a deliberate
cut that the schedule un-cut). The product goal: a stakeholder looks at
the locations data and uses the AI to understand what they see. Chart
craft follows the dataviz design method (form → color → validate → marks
→ hover → accessibility), with the reference palette validated against
our actual card surfaces in both modes.

## Options considered (presented to the author; C approved)

1. **Dashboard + independent chat rail** — classic BI + copilot; fastest,
   but the two surfaces don't share state.
2. **AI-first pinboard** — chat renders chart blocks that pin to a
   personal board; strongest AI story, largest scope (new timeseries
   tool, chart renderers in the registry, board persistence), no
   at-a-glance view.
3. **Linked dashboard + context-aware chat** — overview dashboard with
   URL-state filters; the chat receives the current filter state with
   every request, so "why the June dip?" means *this view's* June.

## Decision

Option 3, with these concrete choices:

- **Filter state lives in the URL** (`/dashboard?brand=…&city=…&from=…`);
  the page is a force-dynamic server component re-querying per request.
  Views are shareable links; no client data fetching. Brand/city params
  are validated against the seeded vocabulary — unknown values fall back
  to "all", never into SQL.
- **View context rides the last user turn, never the system prompt.** A
  deterministic ~150-char bracket line (`formatViewContext`, in the wire-
  contract module) is prefixed server-side. The system prompt must stay
  byte-stable for caching (ADR-0002/0006); volatile content goes late in
  the prompt. The protocol change is additive — plain chat sends no
  `viewContext` and nothing changes.
- **"Ask AI" buttons are a nonce signal, not shared state.** Cards fire
  `{question, nonce}` into the chat component; the nonce guard makes each
  click send exactly once. The chat stays a self-contained component with
  three optional props.
- **Rollups are new lib/db functions** sharing one `DashboardFilters`
  shape and one join spine, so tiles, charts, and table always answer for
  the same slice (the dataviz rule: filters scope everything below them).
- **Charts are hand-rolled (divs + one SVG), no chart library.** Two
  simple forms don't justify a dependency; hand-rolling lets the mark
  specs be met exactly (≤24px bars, 4px data-ends, 2px line, ring-wrapped
  end dot, hairline grids) and keeps components RTL-testable. Recharts is
  the escape hatch if chart count grows.
- **Single-hue charts** (categorical slot 1, validated both modes against
  our card surfaces): the bar chart's job is magnitude — identity lives on
  row labels; the line is a single series — no legend, the card title
  names it. Every bar value is direct-labeled, so bars need no tooltip;
  the line's crosshair tooltip enhances (end label + ticks + the table
  keep values reachable), with the same readout on arrow keys.

## Consequences

- The AI-analyst story gets its best demo: filter to a brand, click
  "Ask AI" on a chart, watch a grounded answer about exactly that slice.
- The chat wire contract grew an optional field; ADR-0003's limits and
  statelessness are unchanged.
- Charts re-render fully on filter change (server round-trip) — no
  reduced-opacity refetch hold yet; acceptable at seed-data latency.
- The pinboard concept (option B) remains open as a future layer on the
  same registry — nothing here forecloses it.
