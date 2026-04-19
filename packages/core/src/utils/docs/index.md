# Core Utils Module

The utils module provides deterministic helpers.

## Responsibilities

- Stable hashing.
- Stable JSON serialization.
- Token estimate helpers.

## Invariants

Utilities should be pure and deterministic. Higher-level packages can rely on them for reproducible IDs, summaries, and diagnostics.
