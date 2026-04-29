---
phase: 37-build-pipeline-repro-fix
plan: 37-02
subsystem: indexer
tags: [build, source-git, source-ghes, diagnostics, persistence]
requires:
  - phase: 37-build-pipeline-repro-fix
    provides: topology-success/build-failure reproduction harness
provides:
  - generated/vendor directory ignore parity between live topology and build source listing
  - compile/chunk/persistence stage classification for build failures
  - troubleshooting guidance for common build failure stages
affects: [phase-38, local-git, source-adapters, troubleshooting]
tech-stack:
  added: []
  patterns:
    [source-listing ignore boundary, explicit build-stage error wrapping]
key-files:
  created: []
  modified:
    - packages/source-git/src/adapters/local-git-source.adapter.ts
    - packages/source-ghes/src/api/trees.ts
    - packages/indexer/src/build/rebuild-docs.ts
    - packages/indexer/src/build/build-repo.ts
    - docs/troubleshooting.md
key-decisions:
  - "Build source listing must ignore the same generated/vendor directories as live topology so topology/build boundaries do not diverge on `.moxel`, `.atlas`, `node_modules`, `dist`, coverage, and build output roots."
  - "Wrap chunk and persistence errors with explicit stages instead of collapsing every post-discovery failure into compile/build."
patterns-established:
  - "Source adapters filter ignored generated/vendor directories before topology classification."
  - "Build pipeline records terminal stage at the narrowest failing boundary."
requirements-completed: [PROD-BUILD-FIX]
duration: 55min
completed: 2026-04-29
---

# Phase 37 Plan 37-02: Fix Real Build-Stage Failures Exposed by Diagnostics Summary

**Build pipeline ignore-boundary fix with narrow compile/chunk/persistence diagnostics and no partial persistence regressions**

## Performance

- **Duration:** 55 min
- **Started:** 2026-04-29T16:35:00Z
- **Completed:** 2026-04-29T16:55:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Fixed root divergence where live topology skipped generated/vendor dirs but build source adapters listed them, allowing committed `.moxel`, `.atlas`, `node_modules`, `dist`, or coverage docs/skills to poison builds.
- Added explicit build failure stage wrapping for `compile`, `chunk`, and `persistence` failures.
- Updated troubleshooting docs with stage meanings, bug-report fields, and ignored-directory regression guidance.

## Task Commits

1. **37-02-01: Classify failing stage from diagnostic cause** - `39d6da63`
2. **37-02-02: Implement minimal targeted fix** - `39d6da63`
3. **37-02-03: Document known build failure classes** - `39d6da63`

## Files Created/Modified

- `packages/source-git/src/adapters/local-git-source.adapter.ts` - Added generated/vendor directory ignore set for local-git materialized file walks.
- `packages/source-ghes/src/api/trees.ts` - Filtered GHES recursive tree entries and blob lookup through same ignore boundary.
- `packages/indexer/src/build/rebuild-docs.ts` - Preserved narrow compile/chunk stage context for document rebuild failures.
- `packages/indexer/src/build/build-repo.ts` - Preserved failed-build document count and classified persistence failures.
- `packages/indexer/src/reports/build-report.ts` - Accepted explicit `docsConsidered` for failed reports.
- `docs/troubleshooting.md` - Documented build stages, next actions, and ignored-directory regression signal.

## Decisions Made

- Ignored-directory filtering belongs at source listing boundary, before topology classification, because both local-git and GHES builds consume adapter file lists.
- `findTreeBlob()` returns `undefined` for ignored GHES paths so ignored generated/vendor docs cannot be read later through source adapter internals.
- Persistence failures are wrapped at `buildRepo()` because persistence runs after in-memory rebuild artifacts are produced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Build source listing included generated/vendor docs that live topology skipped**

- **Found during:** Task 37-02-01
- **Issue:** `inspect topology --live` ignored generated/vendor roots, while local-git/GHES build source listing included them. Broken committed generated docs/skills could make build fail after topology looked healthy.
- **Fix:** Added matching ignore boundaries to local-git directory walks and GHES tree conversion/blob lookup.
- **Files modified:** `packages/source-git/src/adapters/local-git-source.adapter.ts`, `packages/source-ghes/src/api/trees.ts`
- **Verification:** CLI and indexer tests with malformed ignored `SKILL.md` files pass build and exclude ignored paths.
- **Committed in:** `39d6da63`

**2. [Rule 1 - Bug] Build-stage errors were too broad for chunk/persistence root causes**

- **Found during:** Task 37-02-01
- **Issue:** Rebuild errors collapsed under `compile`, and persistence failures collapsed under outer `build`.
- **Fix:** Wrapped compile and chunk operations separately in `rebuildDocs()` and persistence in `buildRepo()`.
- **Files modified:** `packages/indexer/src/build/rebuild-docs.ts`, `packages/indexer/src/build/build-repo.ts`
- **Verification:** Focused build failure tests and typecheck/lint passed.
- **Committed in:** `39d6da63`

---

**Total deviations:** 2 auto-fixed (2 bugs).
**Impact on plan:** Both fixes directly target Phase 37 root cause and diagnostics. No broad rewrite.

## Issues Encountered

- GSD subagents unavailable (`agents_installed: false`), so plan executed inline sequentially.
- `pi-gsd-tools state begin-phase` unavailable (`Unknown command: state`); tracking updated manually.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 38 can proceed with local-git checkout semantics using improved build diagnostics and consistent source ignore boundaries.

## Self-Check: PASSED

- Key files exist.
- Commit present: `39d6da63`.
- Verification commands passed: focused CLI/indexer/source-ghes tests, `bun run typecheck`, `bun run lint`.

---

_Phase: 37-build-pipeline-repro-fix_
_Completed: 2026-04-29_
