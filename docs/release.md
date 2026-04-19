---
title: Release process
description: Maintainer-only npm and GitHub release process for Atlas.
audience: [maintainer]
purpose: [guide]
visibility: public
order: 12
---

# Release process

Atlas publishes exactly one public npm package: `@moxellabs/atlas`. Workspace internals remain private until their APIs are intentionally stabilized.

## Prerequisites

- GitHub repository secret `NPM_TOKEN` contains an npm token with publish rights for `@moxellabs/atlas`.
- `package.json` version matches the release tag without leading `v`.
- Local preflight passes:

```bash
bun run release:check
bun run smoke:distribution
```

## Release tags and dist-tags

Tags drive release channel:

```bash
git tag v1.0.0-rc.1 && git push origin v1.0.0-rc.1 # npm dist-tag next
git tag v1.0.0 && git push origin v1.0.0           # npm dist-tag latest
```

Stable semver tags like `v1.2.3` publish with npm dist-tag `latest`. Prerelease tags like `v1.2.3-rc.1` publish with npm dist-tag `next` and create prerelease GitHub releases.

## Automation

The release workflow runs only from `v*` tags or manual `workflow_dispatch`. It validates, packs, smoke-tests installed tarball, publishes with `npm publish --access public`, generates `release-sha256.txt`, and creates the GitHub release with the tarball and checksums.

The workflow does not run from pull requests, does not request npm provenance, and does not use GitHub environment protection.

## Safety notes

Never paste token values into logs, docs, commits, issues, or pull requests. If rollback or deprecation is needed after publish, use npm owner controls manually and update the GitHub release notes with the maintenance status.
