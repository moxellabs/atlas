# Store Docs Module

The docs module persists compiled document artifacts.

## Responsibilities

- Canonical document records.
- Section records.
- Chunk records.
- Summary records.

## Invariants

Document replacement should keep sections, chunks, summaries, and FTS state aligned for the same document ID.
