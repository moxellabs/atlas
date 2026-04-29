---
phase: 42
title: Post-release Bug Hunt Remediation
status: completed
completed: 2026-04-29
---

# Phase 42 Summary

## Completed scope

- Fixed `serve` runtime env propagation so config discovery honors harness-provided `HOME`, `ATLAS_CONFIG`, identity, cache, and auth env.
- Removed Commander positional duplication while preserving excess args.
- Routed `repo remove` through shared repo target resolver for bare-name, canonical, unknown, and ambiguous targets.
- Plumbed mounted MCP `resourcePrefix` through mount defaults and MCP identity resolution.
- Exported first-party skill MCP tool/resource/schema surface from `@atlas/mcp` barrel.
- Added sparse current-checkout diagnostic `current_checkout_sparse_detected` with materialized-files warning.
- Cleaned section/chunk FTS rows when `SectionRepository.deleteForDocument()` / replacement deletes document children directly.
- Declared `better-sqlite3` in private `@atlas/store` package dependency metadata for Node fallback boundary clarity.

## Plans

- 42-01 complete: CLI runtime and repo command regressions.
- 42-02 complete: mounted MCP identity and public MCP exports.
- 42-03 complete: source checkout diagnostics and store consistency footguns.

## Notes

- Standalone setup help remains free of wrapper-only MCP branding prompts.
- `repo remove` no longer reports success for unknown bare names.
- Current-checkout sparse mode remains allowed, but now emits explicit warning diagnostics.
