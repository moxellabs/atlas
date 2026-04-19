---
title: Retrieval Package
description: Local corpus query classification, ranking, metadata filtering, and token-budgeted context planning.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 250
---

# Retrieval Package

`@atlas/retrieval` plans context over the local Atlas corpus.

## Responsibilities

- Classify query intent.
- Infer likely repo, package, module, document, and skill scopes.
- Build retrieval candidates from store search results.
- Rank candidates with authority, locality, query fit, token efficiency, redundancy, and freshness signals.
- Build token-budgeted context plans.
- Return ambiguity, rationale, diagnostics, and omitted-result information.

## Data Flow

Retrieval accepts a query, optional repo/scope filters, budget settings, and a store-like dependency. It classifies intent, searches persisted records, builds candidates, applies ranking factors, expands related sections when useful, and finalizes a context plan under token budget.

## Ranking Signals

Ranking combines lexical fit, authority, locality, query-kind policy, token efficiency, freshness, and redundancy. Results should include rationale and diagnostics so agents can explain why a document, section, summary, or skill was selected or omitted.

## Boundaries

Retrieval reads persisted local artifacts through store-like dependencies. It does not sync sources, rebuild the corpus, or speak MCP protocol directly.

## Tests

Primary coverage lives in `packages/retrieval/src/retrieval.test.ts`.

```bash
bun --cwd packages/retrieval run typecheck
bun test packages/retrieval
```

## Metadata filters

Retrieval planning accepts profile, audience, purpose, and visibility metadata filters and forwards them to lexical, path, and scope search before ranking. Public-only corpora default to the public profile.

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/retrieval`.

## Invariants

Behavior should remain deterministic for the same inputs, preserve local-first boundaries, and report structured diagnostics where applicable.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test packages/retrieval/src/retrieval.test.ts
```
