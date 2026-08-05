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
- Resolve configuration-file discovery, explicit config paths, and `ATLAS_CONFIG`. This locates configuration files; it does not discover repositories.
- Normalize cache, corpus DB, local repo, and CA certificate paths.
- Validate local Git and GHES repo source shapes.
- Validate repository refresh lifecycle settings and install the 15-minute default.
- Resolve GHES tokens from repo-specific env vars, standard env vars, or GitHub CLI credentials.
- Mutate config files for CLI and server repository operations.

## Public Surface

The package exports schemas, default builders, loaders, mutation helpers, GHES credential resolution, and structured errors. `loadConfig` returns the effective config and the `runtimeRepos` contracts used by source adapters. Consumers should use `loadConfig` or `resolveAtlasConfig` instead of reading config files directly.

## Invariants

- Schema validation is pure. Runtime profile composition and path normalization happen after validation.
- Relative paths are resolved from the config target before runtime services receive them.
- `runtimeRepos` is the repository contract consumed by indexer, topology, and source adapters.
- Credential resolution returns source metadata and token values without exposing discovery rules downstream.
- Config mutation runs the same defaults, validation, and normalization stages before it writes.

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
