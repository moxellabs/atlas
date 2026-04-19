# @atlas/indexer

Sync and build orchestration for ATLAS.

This package connects config, source adapters, topology, compiler, tokenizer, and store repositories into the main mutation pipeline.

## Runtime Role

- Resolves configured repositories into core `RepoConfig` values.
- Chooses the correct source adapter for local Git or GHES.
- Syncs repository revision state and reports source-versus-corpus impact.
- Computes source updates, relevant changed paths, and whether the indexed corpus needs a build.
- Plans noop, full, incremental, deletion, and targeted builds with explicit reason codes.
- Collects affected documents and skills.
- Rebuilds canonical docs, chunks, summaries, and skills.
- Persists artifacts and manifest state transactionally.

## Public API

- Service factory: `createIndexerServices`
- Entry points: `syncRepo`, `syncAll`, `buildRepo`, `buildAll`
- Planning/rebuild/persistence helpers
- Reports, options, diagnostics, recovery metadata, and structured indexer errors

`syncRepo` and `syncAll` do not compile or rewrite corpus content. They refresh source state, classify the impact of changed paths, and may fast-forward a compatible manifest when a source revision changed but no corpus-affecting paths changed.

Build reports expose strategy, reason code, changed paths, affected docs, deleted docs, skipped docs, timings, diagnostics, and recovery status so CLI, HTTP, and MCP surfaces can report package-layer behavior without redefining it.

## Development

```bash
bun --cwd packages/indexer run typecheck
bun test packages/indexer
```

## Artifact publishing

Maintainer artifact workflow uses `atlas init`, `atlas build`, `atlas artifact inspect`, `atlas artifact verify`, and `atlas artifact verify --fresh`; see `docs/ingestion-build-flow.md#maintainer-artifact-publishing-workflow`.
