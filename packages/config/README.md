# @atlas/config

Configuration and environment loading for ATLAS.

This package validates user config files, merges defaults and env overrides, resolves local paths, resolves GHES credentials, and returns a normalized runtime config object.

## Runtime Role

- Discovers `atlas.config.yaml`, `atlas.config.yml`, or `atlas.config.json`.
- Supports explicit `--config` and `ATLAS_CONFIG` paths.
- Normalizes cache, corpus DB, local Git cache, and CA cert paths.
- Validates local Git and GHES repo source config shapes.
- Resolves GHES bearer tokens from configured env vars, standard GitHub env vars, or GitHub CLI credentials without exposing secrets in config files.

## Public API

- Schemas: `atlasConfigSchema`, repo/source/workspace/topology schemas, env schema.
- Loaders: `loadConfig`, `resolveAtlasConfig`, `loadEnv`.
- Defaults: `buildDefaultConfig`, `buildDefaultCorpusDbPath`, server defaults.
- Errors: structured config/env read, parse, path, and validation errors.

## Relevant Env

| Variable | Purpose |
|---|---|
| `ATLAS_CONFIG` | Explicit config path |
| `ATLAS_CACHE_DIR` | Override configured cache directory |
| `ATLAS_LOG_LEVEL` | Override configured log level |
| `ATLAS_CA_CERT_PATH` | Optional enterprise CA path |
| `GHES_TOKEN` | Default GHES token env var |
| `GH_ENTERPRISE_TOKEN` | Standard GitHub CLI enterprise token env var |
| `GH_TOKEN` | Standard GitHub CLI token env var |
| `GITHUB_TOKEN` | Standard GitHub token env var |

Repos can use custom GHES token env names with `github.tokenEnvVar`. If no env token is set, ATLAS tries `gh auth token --hostname <host>`.

## Development

```bash
bun --cwd packages/config run typecheck
bun test packages/config
```

## Atlas home and repo identity

CLI setup writes `~/.moxel/atlas/config.yaml`. Runtime state uses `~/.moxel/atlas`, and canonical repo IDs use `host/owner/name` such as `github.mycorp.com/platform/docs`.
