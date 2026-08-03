---
title: Release process
description: Maintainer-only npm and GitHub release process for Atlas.
audience: [maintainer]
purpose: [guide]
visibility: public
order: 12
---

# Release process

Atlas publishes exactly one public npm package: `@mrmendez/atlas`. Workspace internals remain private until their APIs are intentionally stabilized.

## Prerequisites

- GitHub repository secret `NPM_TOKEN` contains an npm token with publish rights for `@mrmendez/atlas` and bypass 2FA enabled for non-interactive publishing.
- `package.json` version matches the release tag without leading `v`.
- The candidate reached `main` through a pull request, and both `CI / quality` and `Evals / report` succeeded for the resulting main-branch commit.
- Local preflight passes from that exact commit:

```bash
bun install --frozen-lockfile
bun run audit:production
bun run eval:ci
bun run release:check
bun run build:package
```

`bun run release:check` is the authoritative release preflight. It enforces, in order, the zero-advisory production audit, typecheck, lint, full tests, public-artifact boundary guard, artifact freshness, deterministic eval thresholds, installed-distribution smoke, and production onboarding UAT.

## Release tags and dist-tags

Tags drive release channel:

```bash
git tag v1.0.0-rc.1 && git push origin v1.0.0-rc.1 # npm dist-tag next
git tag v1.0.0 && git push origin v1.0.0           # npm dist-tag latest
```

Stable semver tags like `v1.2.3` publish with npm dist-tag `latest`. Prerelease tags like `v1.2.3-rc.1` publish with npm dist-tag `next` and create prerelease GitHub releases.

## Automation

The release workflow runs only from `v*` tags or manual `workflow_dispatch`. Manual dispatch checks out the requested tag and verifies that `HEAD` equals its commit. The `validate` job resolves the release channel, then runs the same `--release-ready` gate as local preflight. Any audit, quality, artifact-boundary, artifact-freshness, eval, distribution, or UAT failure stops validation and prevents npm publication.

Only after validation succeeds does the dependent `publish` job pack and smoke-test the installed tarball, publish with `npm publish --access public`, generate `release-sha256.txt`, and create the GitHub release with the tarball and checksum. Release validation rejects npm tarballs containing `docs/**`, `.moxel/**`, `.planning/**`, `.github/**`, `tooling/**`, or source test internals; full docs are distributed through committed repo artifacts instead.

The independent Evals workflow still reports on pull requests, `main`, and release tags and deploys the tag dashboard to GitHub Pages. Publication remains deterministic because release validation runs `bun run eval:ci` inside the `validate` dependency boundary.

The release workflow does not run from pull requests, does not request npm provenance, and does not use GitHub environment protection.

## Partial-publication recovery

Release tags are immutable after push. If validation fails before npm publication, do not move the tag; fix the release sequence under the next patch version. If npm publication succeeds but GitHub release or asset creation fails, do not republish the npm version. Fetch the existing registry tarball with `npm pack @mrmendez/atlas@<version>`, regenerate `release-sha256.txt`, and create or upload the missing assets against the original tag commit.

## Safety notes

Never paste token values into logs, docs, commits, issues, or pull requests. If rollback or deprecation is needed after publish, use npm owner controls manually and update the GitHub release notes with the maintenance status.
