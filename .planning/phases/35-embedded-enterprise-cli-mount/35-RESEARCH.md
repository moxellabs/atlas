# Phase 35 Research — Embedded enterprise CLI mount

**Status:** Complete
**Scope:** Planning-only research from current Atlas CLI/config implementation.

## Current architecture findings

- `apps/cli/src/index.ts` owns all Commander command registration in `createAtlasProgram(runtime)`.
- `runCli(argv, streams)` is current binary/test entrypoint and must keep standalone `atlas` behavior compatible.
- Global options already include `--json`, `--verbose`, `--quiet`, `--cwd`, `--config`, `--atlas-identity-root`, `--atlas-mcp-name`, and `--atlas-mcp-title`.
- `buildContext()` maps global identity flags into command context and environment overrides:
  - `--atlas-identity-root` → `ATLAS_IDENTITY_ROOT`
  - `--atlas-mcp-name` → `ATLAS_MCP_NAME`
  - `--atlas-mcp-title` → `ATLAS_MCP_TITLE`
- `packages/config/src/white-label/profile.ts` owns identity/MCP precedence and validation.
- `packages/config/src/atlas-config.schema.ts` supports `identity.mcp.resourcePrefix` only through config.
- Root `package.json` currently exports only `.` → `./dist/atlas.js`; wrapper API needs a stable subpath such as `@moxellabs/atlas/commander`.
- `tooling/scripts/build-package.ts` currently bundles only `apps/cli/src/index.ts` into `dist/atlas.js`; public subpath output needs build/export updates.

## Planning implications

1. Refactor without duplicating command definitions: extract command registration into helper(s) reused by standalone root program and mounted namespace command.
2. Keep `runCli()` standalone defaults exact: program name `atlas`, help prefix `atlas <command>`, runtime defaults line, unknown-command behavior, JSON failures, and exit codes.
3. Add wrapper API with constrained public schema only:
   - `namespace`
   - `identityRoot`
   - `mcp.name`
   - `mcp.title`
   - `mcp.resourcePrefix`
   - `defaults.config`
   - `defaults.cacheDir`
   - `defaults.logLevel`
   - `defaults.caCertPath`
4. Treat wrapper defaults as lower precedence than explicit user flags. Preferred implementation: seed runtime env/default config for mounted command, while `buildContext()` keeps explicit CLI global flags winning.
5. For `mcp.resourcePrefix`, do not add unsupported CLI/env knobs unless fully implemented. Simpler plan: document as config-only and require `defaults.config` or existing config file for this field; tests guard no `ATLAS_MCP_RESOURCE_PREFIX` or `--atlas-mcp-resource-prefix` appears.
6. Add public subpath exports and distribution smoke coverage so enterprise wrappers can import `attachAtlas` from package tarball.

## Validation architecture

- Unit/CLI tests in `apps/cli/src/cli.test.ts` should exercise mounted Commander program with memory streams and isolated env.
- Schema/type tests should compile-check `AtlasMountConfig` and reject invented fields via TypeScript excess property checks or doc/source guard tests.
- Standalone compatibility tests should cover representative help, JSON error, unknown command, and a no-network command path.
- Distribution tests should verify `@moxellabs/atlas/commander` import from built package exposes `attachAtlas` and `createAtlasCommand`.
