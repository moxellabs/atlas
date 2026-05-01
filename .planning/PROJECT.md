# Atlas

## What This Is

Atlas is a local-first documentation ingestion, retrieval, and MCP/server access system for multi-repo engineering docs. It builds and imports repo documentation artifacts, exposes search/context through CLI, HTTP, OpenAPI, and MCP surfaces, and keeps enterprise-friendly local runtime state under Moxel/Atlas identity roots.

## Core Value

Local-first documentation ingestion, compilation, retrieval planning, and MCP/server access for multi-repo engineering docs remain reliable, explainable, and safe to ship.

## Current Milestone: v1.2 Codebase Cleanup

**Goal:** Remove or justify every `bunx fallow` finding until `bunx fallow` reports no issues.

**Target features:**

- Normalize Fallow configuration and workspace discovery so analyzer signal reflects real codebase issues.
- Remove dead code, unused exports/types/class members, and unused dependencies without breaking public/runtime surfaces.
- Consolidate duplicated eval/reporting/test/helper code and reduce high-priority complexity hotspots.
- Add a final cleanup gate where `bunx fallow`, `bun run typecheck`, `bun run lint`, and `bun test` pass.

## Requirements

### Validated

- ✓ Atlas provides local-first CLI, server, MCP, indexing, artifact, retrieval, eval, public package, and docs workflows through Phase 44 / v1.1.
- ✓ Public package/release surfaces, production onboarding UAT, and published visual eval report validation passed in v1.1.

### Active

- [ ] Maintainer can run `bunx fallow` and receive zero reported issues.
- [ ] Fallow configuration distinguishes real issues from Bun/test/script/build entrypoints without broad suppressions.
- [ ] Dead files, unused exports/types/class members, and unused dependencies are removed or explicitly justified.
- [ ] Major duplication findings are resolved through shared source-of-truth modules or documented narrow suppressions.
- [ ] High-priority complexity hotspots are split into tested, maintainable units.
- [ ] Existing Atlas verification remains green after cleanup.

### Out of Scope

- New product capabilities - milestone is cleanup-only.
- Cosmetic refactors not tied to Fallow findings - avoid scope drift.
- Broad global suppressions that hide real dead code or complexity - success requires meaningful cleanup.
- Changing public API/package exports without review - avoid accidental breaking changes.

## Context

- Previous milestone v1.1 completed through Phase 44 with all validation passed.
- `.planning/PROJECT.md` and `.planning/MILESTONES.md` were missing on disk at milestone start, so this milestone recreates living project context from `STATE.md`, `ROADMAP.md`, package metadata, and current project state.
- Baseline `bunx fallow --format json --no-cache` saved to `.planning/research/fallow/fallow-baseline.json`.
- Baseline signal: 51 unused files, 58 unused exports, 21 unused types, 57 unused class members, 9 unused dev dependencies, 97 duplication clone groups, and 369 health findings.
- Parallel investigation outputs live under `.planning/research/fallow/` and identify cleanup order: config/workspace signal, dead-code pruning, eval duplication, complexity hotspots, then final gate.
- Current repo has pre-existing dirty code/docs changes from prior work; planning docs should be committed independently from implementation changes.

## Constraints

- **Runtime**: Use Bun commands (`bun`, `bunx`, `bun test`, `bun run`) rather than Node/npm equivalents.
- **Completion gate**: Milestone is done only when `bunx fallow` reports no issues.
- **Regression safety**: Cleanup must preserve `bun run typecheck`, `bun run lint`, and `bun test` success.
- **Public surface**: Package exports, CLI behavior, MCP/server contracts, and docs-visible APIs require review before removal.
- **Analyzer config**: Prefer narrow entrypoint/dynamic-load/test patterns over blanket ignores.

## Key Decisions

| Decision                                                    | Rationale                                                                                   | Outcome   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| Treat Fallow zero-issue report as milestone completion gate | User explicitly defined done as `bunx fallow` reporting no issues                           | ✓ Good |
| Continue phase numbering from v1.1                          | `--reset-phase-numbers` not provided; previous milestone ended at Phase 44                  | ✓ Good |
| Skip domain research                                        | User passed skip-research intent; this is cleanup milestone driven by analyzer output       | ✓ Good |
| Use parallel investigation before implementation            | Fallow baseline has many findings across dead code, duplication, health, and config buckets | ✓ Good    |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-05-01 after completing v1.2 Codebase Cleanup milestone_
