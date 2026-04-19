---
title: "White-Label Artifact Roots and MCP Identity"
prd: "PRD-001-white-label-artifacts-and-mcp"
date: 2026-04-27
author: "Pi"
status: Draft
---

# Plan: White-Label Artifact Roots and MCP Identity

## Source

- **PRD**: `docs/prd/PRD-001-white-label-artifacts-and-mcp.md`
- **Date**: 2026-04-27
- **Author**: Pi

## Architecture Overview

Add one shared white-label profile that resolves physical artifact roots, derived runtime storage roots, and MCP identity from CLI flag, environment, config, and defaults. Commands should not read `.moxel/atlas` or `atlas-mcp` literals directly except through approved defaults and compatibility tests.

The implementation should separate committed repo artifacts from runtime state. `artifactRoot` controls repo-local and remote artifact paths such as `.moxel/atlas` or `.acme/knowledge`; runtime storage continues to use explicit `cacheDir` and `corpusDbPath` when configured, otherwise derives from white-label runtime defaults.

MCP branding changes server metadata plus Atlas-prefixed resources/skill aliases. Generic tool names stay stable (`find_docs`, `read_outline`, etc.) so existing agents keep working while clients that display MCP server identity show the user's brand.

## Components

### White-label profile resolver

**Purpose**: Resolve and validate effective artifact/runtime/MCP identity values with consistent precedence.

**Key Details**:

- Precedence: CLI flag > env var > config file > default.
- Repo-local artifact roots must be relative, normalized, and reject traversal.
- Existing explicit `cacheDir`/`corpusDbPath` remain higher priority than derived runtime root.

**ADR Reference**: None — straightforward implementation from PRD decisions.

### CLI artifact command integration

**Purpose**: Make all repo-local and consumer artifact workflows use the effective artifact root.

**Key Details**:

- Wire `init`, `build`, `artifact verify/inspect`, `add-repo`, adoption templates, and missing artifact guidance.
- Emit migration hint when default root exists and custom root is missing.
- Preserve no-option `.moxel/atlas` behavior.

**ADR Reference**: None.

### Runtime storage integration

**Purpose**: Derive setup/runtime cache paths from white-label profile when not explicitly configured.

**Key Details**:

- Wire setup, config loader defaults, repo cache, clean, prune, and doctor.
- Preserve `ATLAS_CONFIG`, `ATLAS_CACHE_DIR`, explicit `cacheDir`, and explicit `corpusDbPath` semantics.

**ADR Reference**: None.

### MCP identity and surface branding

**Purpose**: Allow LLM-visible MCP identity to use internal brand names.

**Key Details**:

- Add MCP metadata factory for custom `name`, `title`, and description.
- Convert `atlas-*` resource names and `$atlas-*` skill aliases to brand-aware names.
- Keep generic tool names stable.

**ADR Reference**: ADR candidate if implementation pressure appears around renaming generic MCP tools.

### Documentation and hardcode guard

**Purpose**: Make behavior clear to wrapper CLI owners and prevent regressions.

**Key Details**:

- Update README, configuration docs, ingestion/build flow, runtime surfaces, and security docs.
- Add grep/lint guard for hardcoded brand/path strings outside approved locations.

**ADR Reference**: None.

## Implementation Order

| Phase | Component                                                   | Dependencies | Estimated Scope |
| ----- | ----------------------------------------------------------- | ------------ | --------------- |
| 1     | White-label profile resolver + repo-local artifact commands | None         | L               |
| 2     | Runtime storage + consumer import paths                     | Phase 1      | L               |
| 3     | MCP identity + Atlas-prefixed MCP resources/skill aliases   | Phase 1      | M               |
| 4     | Docs, hardcode audit, release readiness                     | Phases 1-3   | M               |

## Risks and Mitigations

| Risk                                                | Likelihood | Impact | Mitigation                                                                                        |
| --------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------- |
| Missed hardcoded `.moxel/atlas` creates mixed roots | Med        | High   | Add hardcode audit test and route all path construction through resolver.                         |
| MCP resource branding breaks clients                | Med        | Med    | Preserve defaults; require explicit opt-in; keep generic tools stable.                            |
| Runtime root conflicts with explicit cache config   | Med        | Med    | Keep explicit cache/corpus config highest priority over derived runtime root.                     |
| Migration warning causes confusion                  | Med        | Low    | Warn only when default root exists and custom root missing; message states no fallback/migration. |

## Open Questions

- Should artifact schema strings such as `moxel-atlas-artifact/v1` remain stable forever or gain branded aliases later?
- Should branded MCP mode expose both custom and default `atlas-*` resources/aliases for compatibility, or custom-only?
- Should wrapper CLIs eventually call a library API rather than shelling out with flags/env?

## ADR Index

Decisions made during this plan:

| ADR | Title                         | Status |
| --- | ----------------------------- | ------ |
| N/A | No standalone ADR created yet | N/A    |
