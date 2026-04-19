---
phase: 35
plan: 35-02
title: Add mount tests docs and compatibility guards
status: complete
completed: 2026-04-28
---

# Summary: 35-02 Add mount tests docs and compatibility guards

## What changed

- Added mounted Commander API tests for attach/create, namespace validation, supported default shape, lower-kebab `mcp.resourcePrefix` validation, and unsupported-field type guard.
- Added `docs/enterprise-cli-mount.md` with one-minute Commander setup and constrained schema table.
- Linked enterprise mount docs from `README.md`, `docs/configuration.md`, and `docs/runtime-surfaces.md`.
- Extended distribution package smoke coverage for `@moxellabs/atlas/commander`.

## Guards

- Public schema remains limited to `namespace`, `identityRoot`, `mcp.name`, `mcp.title`, `mcp.resourcePrefix`, and `defaults.config/cacheDir/logLevel/caCertPath`.
- Unsupported visual/auth fields appear only in limits/negative type assertions.
- `mcp.resourcePrefix` documented as config-only; no `ATLAS_MCP_RESOURCE_PREFIX` or `--atlas-mcp-resource-prefix` added.

## Validation

- `bun test apps/cli/src/cli.test.ts --test-name-pattern "mounted Commander|mount defaults|unsupported mount fields|help|unknown"`
- `bun test apps/cli/src/cli.test.ts`
- `bun test`
- `bun run typecheck`
- `bun run lint`
- `bun run build:package`
- `bun run smoke:distribution`
