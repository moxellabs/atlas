---
title: Store Package
description: SQLite corpus migrations, repositories, FTS/search rows, diagnostics, and local persistence.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 280
---

# Store Package

`@atlas/store` owns the local SQLite corpus.

## Responsibilities

- Open and migrate SQLite databases.
- Apply local-first pragmas.
- Persist repos, packages, modules, manifests, documents, sections, chunks, summaries, and skills.
- Maintain FTS/search rows for document and chunk text.
- Provide lexical, path, and scope search helpers.
- Surface diagnostics for health, doctor, inspect, server, and MCP workflows.

## Public Surface

The package exports the store client, migrations, repositories for corpus tables, FTS helpers, search helpers, record types, and structured store errors. Higher layers should use repository APIs and transaction helpers instead of issuing ad hoc SQL.

## Invariants

- Schema migrations must be deterministic and versioned.
- Build persistence should keep repos, packages, modules, docs, sections, chunks, summaries, skills, search rows, and manifests consistent.
- FTS rows should be updated when document or chunk text changes.
- Store errors should preserve enough context for diagnostics without exposing unrelated implementation details.

## Boundaries

Store should not fetch sources, compile Markdown, classify docs, or rank retrieval results. It provides durable records and search primitives.

## Tests

Store integration tests live in `packages/store/src/store.test.ts`.

```bash
bun --cwd packages/store run typecheck
bun test packages/store
```

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
