---
title: Indexer Package
description: Source sync, topology discovery, compile/tokenize/store orchestration, artifact export, and build reports.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 230
---

# Indexer Package

`@atlas/indexer` orchestrates sync and build pipelines.

## Responsibilities

- Resolve configured repos into source adapter inputs.
- Select local Git or GHES source adapters.
- Sync source revision, changed path state, and corpus impact.
- Discover topology snapshots.
- Plan noop, full, incremental, targeted, and deletion builds.
- Compile docs, tokenize chunks, build summaries, and persist results.
- Produce reports, diagnostics, recovery state, freshness state, and timings.

## Data Flow

The indexer is the orchestrator for source-to-corpus work. It loads configured repo inputs, calls the appropriate source adapter, computes source updates and corpus impact, discovers topology, plans the build strategy, invokes compiler and tokenizer services, and persists the resulting artifacts through the store.

## Invariants

- Sync should update source revision evidence without compiling documents and distinguish source-only changes from corpus-affecting changes.
- Sync may fast-forward a compatible manifest when source changed but no docs, skills, topology-sensitive paths, package manifests, or unsafe diffs affected the corpus.
- Build plans should explain whether work is noop, full, incremental, targeted, or deletion-only.
- Failed builds should preserve the last good corpus and report recovery metadata.
- Reports should include timings and diagnostics that can be rendered by CLI, server, tests, and MCP freshness tools.

## Boundaries

Indexer coordinates package services. It should not duplicate source adapter internals, Markdown parsing internals, SQLite repository logic, or retrieval ranking logic.

## Tests

Primary sync/build integration coverage lives in `packages/indexer/src/indexer.test.ts`.

```bash
bun --cwd packages/indexer run typecheck
bun test packages/indexer
```

## Public artifact filtering

Indexer artifact export applies document metadata profiles. Repo-local builds default to the public profile and exclude `.planning/**`, `docs/archive/**`, and internal-visibility docs from `corpus.db`, FTS rows, skill artifacts, and `docs.index.json`.

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/indexer`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test packages/indexer/src/indexer.test.ts
```
