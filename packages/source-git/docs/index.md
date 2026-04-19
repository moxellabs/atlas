---
title: Source Git Package
description: Local Git cache management, revision/file reads, sparse fetches, and diff normalization.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 270
---

# Source Git Package

`@atlas/source-git` implements local Git-backed source acquisition for Atlas.

## Responsibilities

- Maintain local repository caches.
- Clone, fetch, and update configured refs.
- Support partial clone and sparse checkout behavior where configured.
- Resolve revisions and list files.
- Read source files from local checkouts.
- Compute Git diffs and normalize changed paths for incremental builds.

## Data Flow

The indexer passes a `local-git` repo config into the adapter. The package ensures the cache is present, updates the requested ref, resolves the revision, lists repository-relative files, reads source content, and computes path diffs when prior revision state exists.

## Invariants

- Returned paths should be repository-relative POSIX paths.
- Git command failures should surface as structured source-git errors with enough context for CLI/server diagnostics.
- Cache updates should not decide topology, compilation, or persistence behavior.
- Diff filtering should include documentation, skill, manifest, and config paths relevant to incremental builds.

## Boundaries

This package implements the shared `RepoSourceAdapter` contract for `local-git`. It does not classify docs, compile Markdown, persist corpus records, or plan retrieval context.

## Tests

Coverage includes adapter behavior, diff filtering, Git output parsing, and integration-style local repo flows.

```bash
bun --cwd packages/source-git run typecheck
bun test packages/source-git
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/source-git`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
