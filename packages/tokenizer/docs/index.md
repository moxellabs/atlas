---
title: Tokenizer Package
description: Exact token counting, budget validation, text splitting, overlap, and chunk construction.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 300
---

# Tokenizer Package

`@atlas/tokenizer` owns exact token accounting and chunk construction.

## Responsibilities

- Resolve supported encodings and model aliases.
- Encode text and count exact tokens.
- Validate token budgets and calculate remaining budget.
- Split oversized text by budget.
- Apply bounded overlap.
- Build tokenized chunks from canonical sections with stable provenance.

## Data Flow

Tokenizer receives canonical sections, chunking options, model/encoding settings, and provenance metadata. It returns tokenized chunks, split diagnostics, and budget results that can be persisted by the store and consumed by retrieval planning.

## Invariants

- Token counts should use the configured exact encoder, not rough estimates, when building corpus chunks.
- Oversized content should split predictably under the configured budget.
- Overlap should preserve useful trailing context without making chunks exceed budget.
- Chunk provenance should still point back to the original document and section.

## Boundaries

Tokenizer does not parse Markdown, classify topology, query the store, or choose retrieval results. It receives canonical sections and returns tokenized artifacts.

## Tests

Tokenizer tests cover encoding, budget helpers, split behavior, overlap, and section chunking.

```bash
bun --cwd packages/tokenizer run typecheck
bun test packages/tokenizer
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/tokenizer`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
