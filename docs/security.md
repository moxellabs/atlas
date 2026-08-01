---
title: Local-First Security
description: Atlas local-first guarantees, credential handling rules, and adoption permission boundaries.
audience: [consumer, contributor, maintainer]
purpose: [reference]
visibility: public
order: 60
---

# Local-First Security

Atlas is designed as a local developer-machine runtime. Normal retrieval, context planning, CLI inspection, HTTP reads, and MCP tools operate over the local SQLite corpus.

## Local Boundaries

- The default server host is loopback.
- Repository config mutation routes are intended for loopback-bound servers.
- Source synchronization is explicit; retrieval does not fetch remote content.
- Retrieval and MCP context planning read from the compiled local corpus; remote source reads happen only during explicit sync/build workflows.
- The local corpus is persisted in SQLite at the configured path.

## Credentials

GHES tokens are resolved from configured env vars, standard GitHub token env vars, or GitHub CLI credentials. Tokens must not be written to `atlas.config.*`, logs, diagnostics, OpenAPI examples, MCP output, or test snapshots.

Credential values must never be written to config files, request logs, diagnostics, OpenAPI examples, MCP responses, or test snapshots; diagnostics may include safe metadata such as auth kind or env var name.

Authenticated remote MCP is explicit opt-in through `atlas mcp --remote-url` or `atlas agent install --remote-url`. Remote URLs must use HTTPS. A bearer token is read at process start from one named environment variable or an owner-only regular file; Atlas does not persist the value in generated client configuration, integration receipts, output, or logs. The remote bridge forwards MCP requests to the configured Atlas endpoint but does not upload the local SQLite corpus or local repository content.

## Hosted read-only boundary

Remote hosting is an explicit, dedicated-process mode. The Atlas server still binds to loopback and must sit behind an HTTPS reverse proxy; non-loopback listeners are rejected. Configure exactly one of `ATLAS_REMOTE_AUTH_TOKEN` or an owner-only `ATLAS_REMOTE_AUTH_TOKEN_FILE`, set `ATLAS_REMOTE_TLS_TERMINATED=true`, and provide a non-empty comma-separated `ATLAS_REMOTE_REPO_ALLOWLIST`. The process refuses to start if either configured repositories or repository records already present in the selected corpus fall outside that allowlist.

Every remote request requires the proxy's `x-forwarded-proto: https` assertion and the configured bearer token. The boundary exposes only read-only health, repository, document, search, context-planning, and MCP routes; sync, build, config mutation, and other methods fail closed. Repository IDs in paths, API bodies, and MCP tool arguments are checked against the allowlist. Requests use a bounded body size, a fixed-window per-token rate limit, and a bounded response size; oversized event streams are terminated.

Remote audit events record request ID, method, path, outcome, and status. They never record authorization headers, bearer values, request bodies, or response bodies. Use a dedicated corpus for the hosted allowlist; do not point the process at a broader developer-machine corpus.

## No Upload Guarantee

Atlas does not upload indexed corpus content to external services. It reads configured sources during explicit sync/build workflows and serves compiled local artifacts to local runtime surfaces.

## Adoption permission boundaries

Atlas adoption templates are copyable text only. Atlas remote artifact fetches are read-only. Atlas does not request extra repository write permissions for adoption templates.

Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

Atlas does not bypass protected branches, required reviews, CODEOWNERS, or organization approval rules. Users should keep least-privilege read tokens for artifact fetch and follow their normal organization approval process.

## Archive Boundary

`docs/archive/` contains historical specs and checklists. These files are intentionally excluded from the active self-indexed corpus so retrieval reflects current architecture and operations docs.

## Identity root behavior

Default identity uses `.moxel/atlas` in maintainer checkouts and `~/.moxel/atlas` at runtime. Custom identity example: `--atlas-identity-root .acme/knowledge`, `ATLAS_IDENTITY_ROOT=.acme/knowledge`, or config `identity.root: ".acme/knowledge"`. `.acme` is umbrella/team/vendor equivalent to `moxel`; `knowledge` is brand/product/MCP equivalent to `atlas`. MCP identity uses `--atlas-mcp-name acme-knowledge`, `ATLAS_MCP_NAME=acme-knowledge`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`. Precedence is CLI > environment > config > default; explicit cache/corpus config overrides derived runtime paths.

Maintainer committed artifact path is identity root directly: `<repo>/.moxel/atlas/` or `<repo>/.acme/knowledge/`. Consumer imported mirrors preserve identity root directly: `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` or `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`. Files live directly inside identity root: `manifest.json`, `corpus.db`, `docs.index.json`, `checksums.json`, and `atlas.repo.json` when applicable. Legacy nested artifact mirror layouts are not used for fetched/copied mirrors. Custom identity roots do not read, copy, migrate, delete, or fallback to `.moxel/atlas` or `~/.moxel/atlas`.

## Public Docs Security Statements

Retrieval does not fetch remote content. Atlas does not upload indexed corpus content to external services. Atlas does not branch, commit, push, create issues, or create PRs.
