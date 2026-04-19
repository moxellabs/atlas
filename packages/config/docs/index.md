---
title: Config Package
description: Config schema loading, identity roots, runtime paths, host/source settings, and credential resolution.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 210
---

# Config Package

`@atlas/config` loads, validates, normalizes, and mutates Atlas configuration.

## Responsibilities

- Validate config files and environment inputs with schemas.
- Resolve config file discovery, explicit config paths, and `ATLAS_CONFIG`.
- Normalize cache, corpus DB, local repo, and CA certificate paths.
- Validate local Git and GHES repo source shapes.
- Resolve GHES tokens from repo-specific env vars, standard env vars, or GitHub CLI credentials.
- Mutate config files for CLI and server repository operations.

## Public Surface

The package exports config and environment schemas, default builders, config loaders, config mutation helpers, GHES auth resolution, and structured config errors. Consumers should use `loadConfig` or `resolveAtlasConfig` instead of reading config files directly.

## Invariants

- Validation happens before runtime services consume config.
- Relative paths are resolved consistently from the config target.
- Credential resolution returns source metadata and token values without requiring downstream packages to know discovery rules.
- Config mutation helpers should preserve valid schema output and avoid unrelated rewrites.

## Boundaries

Config resolves settings and credentials. It should not perform source sync, build operations, topology classification, or store writes.

## Tests

Loader and env behavior is covered under `packages/config/src/loaders/*.test.ts`.

```bash
bun --cwd packages/config run typecheck
bun test packages/config
```

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
