---
title: Atlas Documentation
description: Start here for Atlas concepts, workflows, runtime surfaces, security, and self-indexing docs.
audience: [consumer, contributor, maintainer]
purpose: [guide, reference]
visibility: public
order: 10
---

# Atlas Documentation

Atlas is a local-first documentation compiler, topology engine, retrieval planner, HTTP server, CLI, and MCP runtime for multi-repo engineering documentation.

This directory contains active architecture and operations documentation. Historical implementation plans and checklists live under `docs/archive/` and are excluded from the normal self-indexing corpus.

## Start Here

- `architecture.md`: package boundaries and system shape.
- `ingestion-build-flow.md`: how sync and build turn source docs into the local corpus.
- `retrieval-and-context.md`: how Atlas searches, ranks, and plans context.
- `runtime-surfaces.md`: CLI, HTTP, OpenAPI, and MCP entrypoints.
- `self-indexing.md`: how to use Atlas as its own test corpus.
- `configuration.md`: repo config, topology rules, source modes, and local paths.
- `security.md`: local-first boundaries and credential handling.
- `troubleshooting.md`: production failure triage, including `CLI_BUILD_FAILED` build diagnostics.

## Documentation Layers

Atlas documentation is intentionally arranged to match Atlas topology rules:

- Root architecture docs live in `docs/`.
- App and package docs live in `apps/*/docs/` and `packages/*/docs/`.
- Module-local docs live next to source modules at `*/src/<module>/docs/`.

This layout gives retrieval meaningful repo, package, and module scopes instead of a flat Markdown corpus.

## Phase 20 workflow guides

- [Consumer repo consumption workflow](ingestion-build-flow.md#consumer-repo-consumption-workflow)
- [Maintainer artifact publishing workflow](ingestion-build-flow.md#maintainer-artifact-publishing-workflow)
- [Enterprise host setup and troubleshooting](configuration.md#enterprise-host-setup-and-troubleshooting)

## Public Site Source Boundary

Active public docs are docs-site source content. Historical/internal docs are not public site source content. `.planning/**` and `docs/archive/**` are excluded from generated public docs and the public self-index artifact.

## Consumers

- [Configuration](configuration.md) for identity root, runtime paths, hosts, profiles, `audience`, `purpose`, and `visibility` metadata.
- [Ingestion And Build Flow](ingestion-build-flow.md) for `atlas setup`, `atlas add-repo org/repo`, local-only fallback, and public artifact adoption.
- [Retrieval And Context Planning](retrieval-and-context.md) for search, filters, and local corpus behavior.
- [Runtime Surfaces](runtime-surfaces.md) for CLI, HTTP, OpenAPI, MCP, and skills.
- [Local-First Security](security.md) for credential and no-upload boundaries.
- [Troubleshooting](troubleshooting.md) for `CLI_BUILD_FAILED`, `IndexerBuildError`, and nested build diagnostic triage.

## Contributors

- [CLI App](../apps/cli/docs/index.md) for command ownership and tests.
- [Server App](../apps/server/docs/index.md) for HTTP/OpenAPI/MCP route ownership.
- [Compiler Package](../packages/compiler/docs/index.md), [Indexer Package](../packages/indexer/docs/index.md), [Retrieval Package](../packages/retrieval/docs/index.md), and package docs for implementation boundaries.
- [Atlas Contributor Skill](../skills/atlas-contributor/SKILL.md) for source-truth workflow and validation gates.

## Maintainers

- [Self-Indexing Atlas](self-indexing.md) for building and verifying this repository's `.moxel/atlas` public artifact.
- [Ingestion And Build Flow](ingestion-build-flow.md) for `atlas init`, `atlas build --profile public`, `atlas artifact inspect`, and `atlas artifact verify --fresh`.
- [Configuration](configuration.md) for metadata profiles and repository identity.

## Enterprise Operators

- [Configuration](configuration.md) for GHES hosts, custom identity root examples, and token resolution.
- [Security](security.md) for local-first, credential, and adoption permission boundaries.
- [Runtime Surfaces](runtime-surfaces.md) for local server, OpenAPI, and MCP deployment surfaces.

## Agents And Skills

- [Document Codebase Skill](../skills/document-codebase/SKILL.md) helps agents document codebases from source truth.
- [Skill Creator Skill](../skills/skill-creator/SKILL.md) helps agents recommend and create approved Atlas skills.
- [Runtime Surfaces](runtime-surfaces.md) explains `list_skills`, `use_skill`, `document-codebase`, and `skill-creator` access.
