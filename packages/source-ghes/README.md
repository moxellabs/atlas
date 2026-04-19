# @atlas/source-ghes

GitHub Enterprise Server REST source adapter for ATLAS.

This package provides authenticated GHES API access, pagination, revision resolution, recursive tree listing, blob/content reads, compare-based diffs, structured errors, diagnostics, and a `RepoSourceAdapter` implementation.

## Runtime Role

- Implements the shared `RepoSourceAdapter` contract for `ghes-api` repos.
- Uses explicit GHES REST base URLs such as `https://ghe.example.com/api/v3`.
- Applies bearer-token auth resolved by `@atlas/config`.
- Reads commits, trees, blobs, contents, and compare metadata through GHES REST endpoints.
- Refuses to return truncated tree listings as complete file lists.

## Public API

- `GhesSourceAdapter`
- `GhesClient`
- `buildAuthHeaders`, `describeAuth`
- GHES auth/client option types
- Structured GHES error classes

Endpoint wrappers are intentionally internal; the package public surface is adapter/client/error oriented.

## Inputs And Outputs

- Input: core `RepoConfig` with `mode: "ghes-api"` and `github.baseUrl`, `owner`, `name`, `ref`.
- Auth input: `GhesAuthConfig`, normally built by `@atlas/config` and passed through the indexer.
- Output: `RepoRevision`, `FileEntry[]`, `SourceFile`, and `SourceChange[]`.

## Development

```bash
bun --cwd packages/source-ghes run typecheck
bun test packages/source-ghes
```

## Notes

This package does not acquire credentials. It accepts a resolved token and keeps browser login, GitHub CLI integration, and env lookup in the config/CLI layer.

## Enterprise host docs

For GHES auth, host setup, SSH/HTTPS inputs, and troubleshooting, see `docs/configuration.md#enterprise-host-setup-and-troubleshooting`. Use `gh auth login --hostname github.mycorp.com` or least-privilege read tokens.
