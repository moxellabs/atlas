---
title: Self-Indexing Atlas
description: Build, verify, inspect, and consume Atlas public self-indexed artifact and first-party skills.
audience: [consumer, contributor, maintainer]
purpose: [workflow]
visibility: public
order: 70
---

# Self-Indexing Atlas

Atlas dogfoods its maintainer artifact workflow by publishing this repository's public docs and first-party skills as a committed `.moxel/atlas` public artifact. Consumers can import Atlas itself with the same `atlas repo add` path used for any other maintained repository.

## Why Atlas Publishes Its Own Public Artifact

The committed public artifact proves Atlas can compile, filter, verify, and consume its own docs without special cases. It also gives users a ready public corpus for Atlas docs, including the `document-codebase` and `skill-creator` first-party skills, while keeping planning and historical internals out of retrieval results.

## Initialize Or Refresh Metadata

Run repo-local initialization from this checkout when `.moxel/atlas/atlas.repo.json` is missing or needs a forced refresh:

```bash
bun apps/cli/src/index.ts init \
  --repo-id github.com/moxellabs/atlas \
  --ref $(git rev-parse --abbrev-ref HEAD) \
  --force
```

The metadata file uses the normal repo-local artifact root, `.moxel/atlas`.

## Rebuild The Public Artifact

Build the committed public artifact from current HEAD:

```bash
bun apps/cli/src/index.ts build --profile public
```

Generated files:

- `.moxel/atlas/manifest.json`
- `.moxel/atlas/corpus.db`
- `.moxel/atlas/checksums.json`
- `.moxel/atlas/docs.index.json`

Atlas does not stage, commit, branch, push, create issues, or create PRs. Maintainers review and commit `.moxel/atlas` through normal project flow.

## Verify Freshness

Before committing or releasing, verify checksums, safety, importability, and HEAD freshness:

```bash
bun apps/cli/src/index.ts artifact verify --fresh
```

A stale artifact fails with `Artifact is stale; run atlas build and commit .moxel/atlas.` Re-run `atlas build --profile public` after changing public docs, skills, or metadata.

## Public Profile Exclusions

Atlas self-indexing uses the public profile. The committed artifact intentionally excludes:

- `.planning/**`
- `docs/archive/**`
- docs marked `visibility: internal`

The public artifact should include active docs such as `README.md`, `docs/self-indexing.md`, app/package docs, and public skills such as `skills/document-codebase/SKILL.md` and `skills/skill-creator/SKILL.md`.

## Consumer Import And Search

Use a clean runtime to verify the consumer view:

```bash
HOME=$(mktemp -d) bun apps/cli/src/index.ts setup --non-interactive
HOME=$HOME bun apps/cli/src/index.ts add-repo .
HOME=$HOME bun apps/cli/src/index.ts search "self-indexing" --json
```

Consumers can also run normal commands after import:

```bash
atlas repo add .
atlas search "document-codebase" --json
atlas inspect retrieval --query "How does Atlas self-index?"
atlas mcp
```

Default search, retrieval, server, and MCP surfaces read the imported public corpus only. They should return public Atlas docs and first-party skills, not `.planning/**`, `docs/archive/**`, or internal docs.

## First-Party Skills

Atlas publishes public first-party skills through the self-indexed artifact:

- `document-codebase` helps agents inventory source truth and create or update durable codebase documentation.
- `skill-creator` researches Atlas docs, source structure, and existing skills; recommends candidate skills; discusses and specifies them with follow-up questions; and creates only explicitly approved assets after exact skill names and target paths are approved.

After importing the public artifact, MCP `list_skills` and `use_skill` expose first-party skills with Atlas invocation aliases and read-only supporting artifacts.

After changing public skills, maintainers must refresh and verify the committed artifact:

```bash
bun apps/cli/src/index.ts build --profile public
bun apps/cli/src/index.ts artifact verify --fresh
```

## Static-Site Readiness Checks

The public artifact includes active docs and first-party skills, including `skills/document-codebase/SKILL.md` and `skills/skill-creator/SKILL.md`. It excludes `.planning/**` and `docs/archive/**`.

```bash
bun apps/cli/src/index.ts build --profile public
bun apps/cli/src/index.ts artifact verify --fresh
rg -n "skills/skill-creator/SKILL.md" .moxel/atlas/docs.index.json
! rg -n "\.planning/|docs/archive/" .moxel/atlas/docs.index.json
```
