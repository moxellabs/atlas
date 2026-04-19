# Store Search Module

The search module provides local search primitives.

## Responsibilities

- Maintain FTS rows.
- Run lexical search.
- Run path search.
- Run scope search.

## Invariants

Search helpers should read local persisted artifacts only. Ranking beyond primitive search scores belongs to `@atlas/retrieval`.
