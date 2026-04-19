# Tokenizer Chunk Module

The chunk module creates retrieval chunks from canonical sections.

## Responsibilities

- Chunk by section.
- Split oversized text by budget.
- Apply overlap between split units.
- Preserve chunk order, IDs, token counts, and provenance.

## Invariants

Chunking should preserve structure first and use exact-token fallback only when needed for oversized content.
