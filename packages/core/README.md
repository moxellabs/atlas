# @atlas/core

Shared domain contracts for ATLAS.

This package contains stable enums, deterministic IDs, source adapter contracts, document/topology/retrieval types, summary types, and small deterministic utilities. It should not depend on higher-level packages.

## Runtime Role

- Defines the shared `RepoSourceAdapter` interface used by source packages and the indexer.
- Defines source modes, source changes, repo config, file entries, and revisions.
- Defines topology/doc/skill/scope types consumed by topology, compiler, store, retrieval, and MCP packages.
- Provides stable structural ID helpers and deterministic hashing/JSON utilities.

## Public API

- Enums: authority, diagnostic confidence, doc kind, query kind, source mode, transport mode, source change kinds.
- IDs: `createDocId`, `createSectionId`, `createChunkId`, `createPackageId`, `createModuleId`, `createSkillId`.
- Types: repo/source contracts, canonical document/section, topology nodes, retrieval primitives, provenance, summaries.
- Utilities: `stableHash`, `stableJson`, token estimate helpers.

## Development

```bash
bun --cwd packages/core run typecheck
bun test packages/core
```

## Documentation

Indexed package docs live in `packages/core/docs/`. Module-local docs live under `packages/core/src/*/docs/`.
