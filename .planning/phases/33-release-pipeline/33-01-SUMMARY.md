---
phase: 33-release-pipeline
plan: 33-01
subsystem: release
tags: [npm, package, smoke-test, metadata]
requires:
  - phase: 32-ci-validation
    provides: CI-equivalent validation baseline
provides:
  - Single public npm package shape for @moxellabs/atlas
  - OSS-ready package metadata across workspaces
  - Pack/install distribution smoke test
affects: [release, packaging, ci]
tech-stack:
  added: []
  patterns:
    - Root package is the only publishable package; workspaces remain private.
key-files:
  created:
    - .npmignore
    - bin/atlas
    - tooling/scripts/build-package.ts
  modified:
    - package.json
    - apps/cli/package.json
    - apps/server/package.json
    - packages/*/package.json
    - tooling/package.json
    - tooling/tsconfig/package.json
    - tooling/scripts/distribution-smoke.ts
    - tooling/scripts/release.ts
key-decisions:
  - "Publish exactly one public package: @moxellabs/atlas."
  - "Keep @atlas/* workspaces private with OSS metadata but no publishConfig."
  - "Pack a bundled Bun CLI plus schema.sql and expose bin/atlas."
patterns-established:
  - "npm pack prepack builds dist/atlas.js and bin/atlas before tarball creation."
  - "Distribution smoke installs the tarball in a temp project and executes atlas --help."
requirements-completed: [OSS-RELEASE]
duration: 1h
completed: 2026-04-28
---

# Phase 33: Release Pipeline Summary

Atlas now packs as one public `@moxellabs/atlas` npm package while internal workspace packages remain private.

## Performance

- **Duration:** 1h
- **Started:** 2026-04-28T08:56:00Z
- **Completed:** 2026-04-28T09:03:00Z
- **Tasks:** 3
- **Files modified:** 20+

## Accomplishments

- Set root package identity to `@moxellabs/atlas@0.1.0` with public publish metadata, license, repository, homepage, bugs, funding, keywords, files allowlist, and `bin.atlas`.
- Added professional OSS metadata to all workspace `package.json` files while preserving `private: true` for non-published internals.
- Added `tooling/scripts/build-package.ts`, `bin/atlas`, `.npmignore`, and tarball install smoke coverage that verifies required files and excludes planning/archive/cache/test paths.

## Decisions Made

- Public package list is exactly `@moxellabs/atlas`.
- Workspace APIs remain internal because `@atlas/*` dependency graph is not yet public API-stable.
- Publish artifact is a bundled Bun CLI, not raw workspace TypeScript imports, so installed package does not depend on private workspace package resolution.

## Deviations from Plan

- Added `build:package`/`prepack` because raw workspace TypeScript package could not execute after tarball install: private `@atlas/*` imports were unresolved.
- Added `.npmignore` and `files` negations to enforce tarball boundaries.

## Issues Encountered

- Initial tarball smoke caught missing packed `package.json` path assumptions and test files in package contents; fixed smoke path handling and package allowlist.
- Installed CLI initially failed resolving `@atlas/config`; fixed by bundling CLI into `dist/atlas.js` during prepack.

## Verification

- `bun run smoke:distribution` passed.
- `npm pack --dry-run` showed tarball contents without `.planning/**`, `docs/archive/**`, caches, or tests.
- `bun run release:check` passed as part of full release validation.
