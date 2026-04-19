---
title: Compiler Package
description: Markdown, frontmatter, canonical document, section, code fragment, and skill metadata compilation.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 200
---

# Compiler Package

`@atlas/compiler` converts classified Markdown source files into canonical Atlas document artifacts.

## Responsibilities

- Parse Markdown and frontmatter.
- Normalize Markdown text and extract node text.
- Build canonical documents and sections with stable IDs.
- Extract code block fragments.
- Build outlines and document/module summaries.
- Extract skill metadata from skill docs.
- Emit compiler diagnostics and structured errors.

## Data Flow

The indexer gives the compiler source content plus topology classification. The compiler returns canonical document records, hierarchical sections, outline entries, summaries, extracted code blocks, skill metadata, diagnostics, and stable provenance-ready structures.

## Invariants

- Markdown normalization should be deterministic for the same source text.
- Section IDs and outline order must remain stable unless source structure changes.
- Frontmatter and skill extraction errors should point at the source path and stage.
- Compiler output should not depend on store state, retrieval ranking, or runtime transport.

## Boundaries

Compiler consumes source content and classification metadata. It does not list source files, select topology rules, store records, chunk sections, or rank retrieval candidates.

## Tests

Primary coverage lives in `packages/compiler/src/compiler.test.ts`.

```bash
bun --cwd packages/compiler run typecheck
bun test packages/compiler
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/compiler`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test packages/compiler/src/compiler.test.ts
```
