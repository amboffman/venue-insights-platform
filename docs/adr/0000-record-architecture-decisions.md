# 0. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

This is a portfolio project built to be **demonstrated and explained** in senior
engineering interviews, not just shipped. When someone asks "why did you choose
X over Y?", the answer needs to be specific, considered, and recallable months
later. Holding that reasoning only in my head — or in scattered commit messages —
doesn't survive to interview day.

## Decision

Every non-obvious technical decision gets a short **Architecture Decision Record
(ADR)** in `docs/adr/`, numbered sequentially. Each ADR captures the _context_
(forces at play), the _options considered_, the _decision_, and its
_consequences_ (including what we give up). Use [`_template.md`](./_template.md).

A one-line-per-decision index lives in [`../DECISIONS.md`](../DECISIONS.md) for
quick scanning; each entry links to its full ADR.

ADRs are immutable once Accepted. If a decision is later reversed, we add a new
ADR that supersedes the old one (and mark the old one `Superseded by ADR-NNNN`)
rather than editing history.

## Consequences

- **Good:** The portfolio writeup and interview talking points are drafted
  straight from these records. Future-me (and reviewers) can see _why_, not just
  _what_.
- **Good:** Forces me to actually weigh alternatives before committing to one.
- **Cost:** A few minutes of writing per significant decision. Worth it here
  because explainability is an explicit project goal.

## References

- Michael Nygard, ["Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions.html)
