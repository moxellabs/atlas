---
phase: 35
plan: 35-01
title: Add embedded Commander mount API
status: complete
completed: 2026-04-28
---

# Summary: 35-01 Add embedded Commander mount API

## What changed

- Added `apps/cli/src/commander.ts` with constrained `AtlasMountConfig`, `createAtlasCommand()`, and `attachAtlas()`.
- Refactored `apps/cli/src/index.ts` so standalone and mounted commands share `registerAtlasCommands()`.
- Added configurable command metadata/help prefix and mount default env/config injection.
- Added `@moxellabs/atlas/commander` package subpath and bundled `dist/commander.js`.
- Extended distribution smoke to verify commander subpath exports.

## Compatibility

- Standalone `atlas` still uses `atlas <command>` help prefix and same command registration path.
- Mount defaults map only to existing supported knobs: `ATLAS_IDENTITY_ROOT`, `ATLAS_MCP_NAME`, `ATLAS_MCP_TITLE`, `ATLAS_CONFIG`, `ATLAS_CACHE_DIR`, `ATLAS_LOG_LEVEL`, `ATLAS_CA_CERT_PATH`.
- No resourcePrefix CLI/env knob added.

## Validation

- `bun test apps/cli/src/cli.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run build:package`
- `bun run smoke:distribution`
