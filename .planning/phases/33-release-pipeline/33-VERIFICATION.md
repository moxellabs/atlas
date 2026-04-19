---
status: passed
phase: 33-release-pipeline
verified: 2026-04-28T09:04:00Z
requirements: [OSS-RELEASE]
---

# Phase 33 Verification: Release Pipeline

## Result

**Passed.** Atlas has safe tag-driven npm and GitHub release automation for one public package, `@moxellabs/atlas`.

## Must-haves

- [x] Public package shape decided: publish only `@moxellabs/atlas`.
- [x] Workspace internals remain private and have OSS metadata.
- [x] Root package includes public metadata, `publishConfig.access: public`, and `bin.atlas`.
- [x] Tarball smoke installs package in temp project and runs `atlas --help`.
- [x] Tarball excludes `.planning/**`, `docs/archive/**`, `.github/**`, caches, tooling, and tests.
- [x] Release workflow triggers on `v*` tags and `workflow_dispatch` only.
- [x] No `pull_request` trigger.
- [x] Stable tags map to npm dist-tag `latest`; prerelease tags map to `next`.
- [x] Workflow validates before publish.
- [x] Workflow uses `NPM_TOKEN` only in publish step environment.
- [x] No `id-token: write`, no npm provenance, no `environment: releases`.
- [x] Workflow creates SHA256 checksums and GitHub release.
- [x] Maintainer release details live in `docs/release.md`, not `CONTRIBUTING.md`.

## Automated checks

```bash
bun run smoke:distribution
bun run release:check
bun tooling/scripts/release.ts --channel --tag=v0.1.0
bun apps/cli/src/index.ts artifact verify --fresh
rg -n "pull_request" .github/workflows/release.yml && exit 1 || true
rg -n "id-token|environment:" .github/workflows/release.yml && exit 1 || true
rg -n "NPM_TOKEN|npm publish|--access public|softprops/action-gh-release|release-sha256" .github/workflows/release.yml
```

All checks passed except optional `bunx actionlint .github/workflows/release.yml`, which could not run locally because package executable resolution failed: `error: could not determine executable to run for package actionlint`. Workflow YAML parsed cleanly in harness and content checks passed.

## Notes

`bun tooling/scripts/release.ts --channel --tag=v0.1.0-rc.1` correctly fails for current `package.json` version `0.1.0`; prerelease tags require matching prerelease package version.
