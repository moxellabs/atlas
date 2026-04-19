---
phase: 33-release-pipeline
plan: 33-02
subsystem: release
tags: [github-actions, npm, dist-tags, checksums]
requires:
  - phase: 33-release-pipeline
    provides: @moxellabs/atlas package metadata and smoke-testable tarball
provides:
  - Tag-driven GitHub Actions release workflow
  - Release channel validation for latest/next
  - Maintainer release documentation
affects: [release, ci, docs]
tech-stack:
  added: [softprops/action-gh-release]
  patterns:
    - Validate on tags/manual dispatch before publish job.
    - NPM_TOKEN only used in publish step environment.
key-files:
  created:
    - .github/workflows/release.yml
    - docs/release.md
  modified:
    - tooling/scripts/release.ts
    - README.md
    - CONTRIBUTING.md
    - .moxel/atlas/*
key-decisions:
  - "Stable tags vX.Y.Z publish npm dist-tag latest."
  - "Prerelease tags vX.Y.Z-* publish npm dist-tag next."
  - "No pull_request trigger, no id-token/provenance, no environment protection."
  - "Maintainer release details live in docs/release.md, not CONTRIBUTING.md."
patterns-established:
  - "release.ts --channel validates tag shape and package version before publish."
  - "GitHub release includes tarball and release-sha256.txt."
requirements-completed: [OSS-RELEASE]
duration: 1h
completed: 2026-04-28
---

# Phase 33: Release Workflow Summary

Atlas now has safe tag-driven npm and GitHub release automation for `@moxellabs/atlas`.

## Performance

- **Duration:** 1h
- **Started:** 2026-04-28T08:56:00Z
- **Completed:** 2026-04-28T09:03:00Z
- **Tasks:** 4
- **Files modified:** 8+

## Accomplishments

- Added `.github/workflows/release.yml` with `v*` tag and manual dispatch triggers, validation job, publish job, tarball smoke install, npm publish, SHA256 generation, and GitHub release creation.
- Extended `tooling/scripts/release.ts` with release channel/tag validation and package version mismatch checks.
- Added maintainer-only release process to `docs/release.md` and kept `CONTRIBUTING.md` contributor-focused per user correction.
- Rebuilt `.moxel/atlas` public artifact after public docs changed.

## Decisions Made

- Use `latest` for stable semver tags and `next` for prerelease tags.
- Use `NPM_TOKEN` only in the publish step as `NODE_AUTH_TOKEN`.
- Do not request `id-token: write`, do not use npm provenance, and do not use a GitHub `releases` environment.
- Keep release internals out of contributor docs except a short note that maintainers handle releases.

## Deviations from Plan

- `actionlint` could not run locally because `bunx actionlint` failed with `could not determine executable to run for package actionlint`; YAML syntax was still parsed by harness and workflow content checks passed.

## Issues Encountered

- Prerelease channel check with `v0.1.0-rc.1` correctly failed because package version is `0.1.0`; this verifies mismatch protection. Stable `v0.1.0` passed.

## Verification

- `bun run release:check` passed.
- `bun run smoke:distribution` passed.
- `bun tooling/scripts/release.ts --channel --tag=v0.1.0` passed.
- Workflow content checks confirmed no `pull_request`, no `id-token`, no `environment`, plus required `NPM_TOKEN`, `npm publish --access public`, `release-sha256`, and `softprops/action-gh-release` entries.
- `bun apps/cli/src/index.ts artifact verify --fresh` passed after rebuilding public artifact.
