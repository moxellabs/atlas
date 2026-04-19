# @atlas/source-git

Local Git source adapter for ATLAS.

This package manages local repository caches, partial/sparse clone behavior, ref resolution, changed-path detection, and file reads for `local-git` repos.

## Runtime Role

- Implements the shared `RepoSourceAdapter` contract.
- Maintains persistent local Git caches through `RepoCacheService`.
- Uses partial clone and sparse checkout where configured.
- Computes source changes with Git name-status output, preserving raw and normalized change kinds.
- Filters relevant changed paths for incremental build planning.

## Public API

- `LocalGitSourceAdapter`
- `RepoCacheService`
- `diffPaths`
- `filterRelevantPaths`
- Git/source diagnostics and structured Git error classes

## Inputs And Outputs

- Input: core `RepoConfig` with `mode: "local-git"` and `git.remote`, `git.localPath`, `git.ref`.
- Output: `RepoRevision`, `FileEntry[]`, `SourceFile`, and `SourceChange[]`.

## Development

```bash
bun --cwd packages/source-git run typecheck
bun test packages/source-git
```
