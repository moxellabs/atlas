---
phase: 35
status: passed
verified: 2026-04-28
requirements: ENTERPRISE-CLI-MOUNT
---

# Phase 35 Verification — Embedded Enterprise CLI Mount

## Result

Status: passed.

Phase goal met: enterprise users can import `@moxellabs/atlas/commander`, call `attachAtlas(program, config)`, and mount the Atlas command tree under a Commander namespace without rebuilding Atlas commands or adding unsupported branding/auth schema.

## Must-haves

- [x] `attachAtlas(program, config)` mounts a namespace command and returns the parent program.
- [x] `createAtlasCommand(config)` returns a namespace command.
- [x] Standalone `atlas` behavior remains on shared command registration path.
- [x] Wrapper schema constrained to supported fields only.
- [x] Mount defaults inject only existing supported env/config knobs.
- [x] `mcp.resourcePrefix` stays config-only; no CLI/env resource-prefix knob added.
- [x] Package export `@moxellabs/atlas/commander` builds and passes distribution smoke.
- [x] Public docs show one-minute setup and explicit limits.

## Automated checks

```sh
bun test apps/cli/src/cli.test.ts --test-name-pattern "mounted Commander|mount defaults|unsupported mount fields|help|unknown"
bun test apps/cli/src/cli.test.ts
bun test
bun run typecheck
bun run lint
bun run build:package
bun run smoke:distribution
rg "ATLAS_MCP_RESOURCE_PREFIX|--atlas-mcp-resource-prefix" apps packages docs README.md
rg "logo|color|docsUrl|supportUrl|productName|authProvider|tokenProvider" apps/cli/src/commander.ts
```

All required pass conditions met. `rg` guards returned no matches for unsupported resource-prefix CLI/env and no unsupported schema fields in `apps/cli/src/commander.ts`.
