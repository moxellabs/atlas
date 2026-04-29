---
phase: 37-build-pipeline-repro-fix
plan: 37-01
subsystem: testing
tags: [topology, build, diagnostics, cli, indexer]
requires:
  - phase: 36-prod-build-diagnostics
    provides: nested build cause diagnostics and CLI_BUILD_FAILED verbose JSON output
provides:
  - topology-success/build-failure regression harness
  - production-shaped ignored-directory fixture coverage
  - post-discovery failed-build docsConsidered assertion
affects: [phase-37, build-pipeline, topology, cli-diagnostics]
tech-stack:
  added: []
  patterns:
    [CLI boundary regression tests, indexer post-discovery failure tests]
key-files:
  created: []
  modified:
    - packages/testkit/src/fake-repo.ts
    - packages/testkit/src/index.ts
    - packages/indexer/src/indexer.test.ts
    - apps/cli/src/cli.test.ts
key-decisions:
  - "Use malformed frontmatter as deterministic post-discovery compile failure because live topology discovers paths without reading Markdown content."
  - "Assert docsConsidered on failure so diagnostics prove discovery and affected-doc planning completed before the terminal build error."
patterns-established:
  - "Topology/build boundary tests run live inspection first, then build same repo with verbose JSON."
requirements-completed: [PROD-BUILD-REPRO]
duration: 45min
completed: 2026-04-29
---

# Phase 37 Plan 37-01: Add Topology-Success Build-Failure Reproduction Harness Summary

**Live topology/build boundary harness with deterministic post-discovery compile failure and verbose nested-cause assertions**

## Performance

- **Duration:** 45 min
- **Started:** 2026-04-29T16:25:00Z
- **Completed:** 2026-04-29T16:45:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added CLI regression where `inspect topology --live --json` succeeds on same checkout that `build --json --verbose` rejects.
- Added indexer regression proving failed builds report `docsConsidered`, compile stage, failing path, nested frontmatter cause, and no partial persistence.
- Added reusable production-like fake repo fixture shape with nested app/package/module docs, skills, generated output, and optional ignored broken docs.

## Task Commits

1. **37-01-01: Build production-shaped monorepo fixture** - `39d6da63`
2. **37-01-02: Add post-discovery failure injection coverage** - `39d6da63`
3. **37-01-03: Add CLI reproduction commands as regression tests** - `39d6da63`

## Files Created/Modified

- `packages/testkit/src/fake-repo.ts` - Added `productionLikeFakeRepoFiles()` fixture for private-monorepo-shaped repos and ignored broken docs.
- `packages/testkit/src/index.ts` - Exported production-like fixture types and builder.
- `packages/indexer/src/indexer.test.ts` - Added post-discovery compile failure and transactional no-persistence coverage.
- `apps/cli/src/cli.test.ts` - Added live topology success/build failure boundary regression.

## Decisions Made

- Malformed frontmatter is deterministic and local-only, so it cleanly reproduces a post-discovery compile failure without private repo data.
- `docsConsidered` is part of failure assertions to prove topology and affected-doc selection completed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Failure reports lost post-discovery document count**

- **Found during:** Task 37-01-02
- **Issue:** Failed builds only derived `docsConsidered` from completed artifacts, so compile failures reported `0` even after affected-doc planning selected documents.
- **Fix:** Preserve selected-doc count before rebuild and pass it into failed `BuildReport` creation.
- **Files modified:** `packages/indexer/src/build/build-repo.ts`, `packages/indexer/src/reports/build-report.ts`
- **Verification:** Focused indexer and CLI boundary tests assert non-zero `docsConsidered` on failure.
- **Committed in:** `39d6da63`

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** Required for diagnostics to prove incident boundary. No scope creep.

## Issues Encountered

- GSD subagents unavailable (`agents_installed: false`), so plan executed inline sequentially.
- `pi-gsd-tools state begin-phase` unavailable (`Unknown command: state`); tracking updated manually.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 37-02 can classify the concrete failing stage and fix build-stage behavior using this harness.

## Self-Check: PASSED

- Key files exist.
- Commit present: `39d6da63`.
- Verification commands passed.

---

_Phase: 37-build-pipeline-repro-fix_
_Completed: 2026-04-29_
