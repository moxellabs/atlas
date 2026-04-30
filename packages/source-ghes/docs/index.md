---
title: Source GHES Package
description: GitHub Enterprise Server REST source reads, artifact fetches, diagnostics, and credential-safe errors.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 260
---

# Source GHES Package

`@atlas/source-ghes` implements GitHub Enterprise Server REST source acquisition.

## Responsibilities

- Build authenticated GHES REST requests from resolved token inputs.
- Normalize GHES API base URLs.
- Read commits, recursive trees, blobs, contents, and compare metadata.
- Page API responses where required.
- Expose a `RepoSourceAdapter` implementation for `ghes-api` repos.
- Surface structured GHES errors and diagnostics without leaking credentials.

## Data Flow

`@atlas/config` resolves credential metadata, then the GHES adapter reads remote repository state through REST endpoints. It resolves refs, lists trees, reads blobs or contents, and compares revisions so the indexer can treat GHES repositories like any other source adapter.

## Invariants

- API base URLs should normalize predictably before requests are made.
- Pagination and tree/blob reads should return deterministic file lists and source content for a given revision.
- Errors should include endpoint and status context where useful, but never token values.
- Live verification should remain opt-in; tests use mocked GHES behavior by default.

## Boundaries

Credential discovery belongs to `@atlas/config`. This package accepts resolved auth metadata and performs GHES API operations only.

`atlas repo add` may read committed `.moxel/atlas` files (`manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json`) through GHES APIs. Adoption templates do not call issue/PR APIs and templates do not require additional write scopes. Enterprise admins own repository permissions, protected branches, required reviews, issue templates, PR templates, and hook policy.

Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Tests

GHES coverage is mocked and deterministic by default. Live verification is opt-in through doctor workflows.

```bash
bun --cwd packages/source-ghes run typecheck
bun test packages/source-ghes
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/source-ghes`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
