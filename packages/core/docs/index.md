---
title: Core Package
description: Shared Atlas contracts, enums, IDs, source types, provenance, freshness, and deterministic utilities.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 220
---

# Core Package

`@atlas/core` is the shared contract package. It defines the language used by every other Atlas subsystem.

## Responsibilities

- Shared enums for authority, document kind, query kind, source mode, transport mode, and change kinds.
- Deterministic ID helpers for docs, sections, chunks, packages, modules, and skills.
- Source adapter contracts and repo/source data types.
- Canonical document, topology, retrieval, summary, provenance, freshness, and chunk types.
- Deterministic utility functions for hashing, stable JSON, and token estimates.

## Public Surface

The package exports enums, deterministic ID factories, source adapter contracts, topology contracts, canonical document records, retrieval result types, provenance/freshness types, and small deterministic utilities. Higher-level packages should import shared contracts from here instead of duplicating string unions or ID rules.

## Invariants

- ID helpers must be deterministic for the same repo/path/scope inputs.
- Shared enums are compatibility-sensitive because they are persisted, serialized, and used in topology rules.
- Utilities should avoid runtime-specific dependencies so the package remains safe for every Atlas layer.
- Contract types should describe behavior without importing implementation packages.

## Boundaries

Core must remain dependency-light and must not import higher-level packages. It should express stable contracts, not runtime orchestration.

## Tests

Core tests cover IDs, source change normalization, stable JSON, and token utilities.

```bash
bun --cwd packages/core run typecheck
bun test packages/core
```

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
