# Server Presenters Module

The presenters module adapts internal records into HTTP response payloads.

## Responsibilities

- Present repo lists and details.
- Present store diagnostics and freshness records.
- Present search and context results.
- Present skill details.

## Invariants

Presenters should be deterministic and serialization-safe. They should avoid mutating store records or hiding important diagnostics.
