# Retrieval Classify Module

The classify module determines the user query kind.

## Responsibilities

- Classify overview, exact lookup, usage, troubleshooting, skill invocation, diff, location, and comparison queries.
- Provide query-kind signals used by ranking and context planning.

## Invariants

Classification should be deterministic and conservative. Ambiguous queries should leave room for scope inference and ranking to surface uncertainty.
