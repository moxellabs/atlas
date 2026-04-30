---
phase: 43
title: Public Package and UX Surface Hardening
status: completed
completed: 2026-04-30
---

# Phase 43 Summary

## Outcome

Phase 43 completed all five plans.

- npm package allowlist now ships runtime assets only: `bin`, `dist`, README/license/security notices, and implicit `package.json`.
- Distribution smoke rejects forbidden tarball paths including `docs/**`, `.moxel/**`, `.planning/**`, `.github/**`, `tooling/**`, and source tests.
- Public artifact filtering now keeps `docs/prd/**`, `docs/archive/**`, and `.planning/**` out of `.moxel/atlas/docs.index.json` and `corpus.db`.
- Added `tooling/scripts/public-artifact-guard.ts` and wired it into workspace verification.
- HTTP search/context schemas and routes accept and forward metadata filters: `profile`, `audience`, `purpose`, `visibility`.
- `ATLAS_MCP_RESOURCE_PREFIX` now propagates through loaded CLI MCP config and server MCP dependency setup.
- Custom identity-root repo metadata lookup now uses shared identity-aware artifact root resolution instead of hardcoded `.moxel/atlas/atlas.repo.json` paths.
- Manual release workflow now checks out requested tag and validates `HEAD` equals tag commit before publishing; release script also checks this in GitHub Actions.
- Top-level `add-repo` remains script-compatible but hidden from help; public docs/help use `repo add` as canonical.
- Runtime contract docs now state installed npm package runs on Node 24+ and source development uses Bun.
- Mounted Commander help now shows host-provided runtime defaults instead of stale standalone `~/.moxel/atlas` wording.

## Key files changed

- `package.json`
- `tooling/scripts/distribution-smoke.ts`
- `tooling/scripts/public-artifact-guard.ts`
- `tooling/scripts/verify.ts`
- `tooling/scripts/release.ts`
- `.github/workflows/release.yml`
- `.moxel/atlas/*`
- `apps/server/src/schemas/{search,context}.schema.ts`
- `apps/server/src/routes/{search,context}.route.ts`
- `apps/server/src/services/{dependencies,retrieval-http}.service.ts`
- `apps/cli/src/{index,commander}.ts`
- `apps/cli/src/commands/{mcp,repo-resolver,repo-target,shared}.ts`
- `packages/compiler/src/canonical/build-canonical-doc.ts`
- `packages/config/src/{index,white-label/profile}.ts`
- public README/docs and CLI docs

## Notes

- `npm pack --dry-run --ignore-scripts --json` now reports 9 packed files and no `docs/**` or `.moxel/**` entries.
- `.moxel/atlas` remains committed for repo artifact consumption but is not included in npm package contents.
- Public artifact freshness passed after rebuild.
