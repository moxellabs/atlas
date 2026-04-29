---
phase: 39-init-and-state-ux
plan: 39-02
subsystem: cli
tags: [doctor, repo-doctor, state-layers, build-diagnostics]
requires:
  - phase: 39-01
    provides: shared repo target resolver for doctor commands
provides:
  - doctor output with runtime/config/db/cache/server layer labels
  - repo doctor output with config/registry/store/artifact metadata layer labels
  - build verbose output mapping diagnostic stage to state layer
affects: [cli, troubleshooting, phase-40]
tech-stack:
  added: []
  patterns: [stable layer fields in health checks]
key-files:
  created: []
  modified:
    - apps/cli/src/commands/repo.command.ts
    - apps/cli/src/commands/doctor.command.ts
    - apps/cli/src/commands/shared.ts
    - apps/cli/src/cli.test.ts
    - docs/runtime-surfaces.md
    - docs/troubleshooting.md
key-decisions:
  - "JSON doctor data remains backward-compatible as an array while each check now carries a stable layer field."
  - "Human doctor output explicitly says doctor/repo doctor do not run build."
patterns-established:
  - "Health checks include `layer` and optional `nextAction` for recovery guidance."
requirements-completed: [STATE-LAYER-UX]
duration: 1h
completed: 2026-04-29
---

# Phase 39: State Layer Doctor Summary

Doctor surfaces now distinguish runtime config, DB/store, local-git cache/source, registry, and artifact metadata state from actual builds.

## Performance

- **Duration:** 1h
- **Started:** 2026-04-29T16:49:00Z
- **Completed:** 2026-04-29T17:00:00Z
- **Tasks:** 2/2
- **Files modified:** 6+

## Accomplishments

- Added `layer` and `nextAction` fields to runtime doctor checks while preserving JSON array shape.
- Added layer-aware repo doctor output for registry/config/store/manifest/artifact metadata checks.
- Added verbose build diagnostic layer mapping for source/cache, topology, compile, persistence, and build failures.
- Documented doctor-vs-build boundaries and troubleshooting workflow.

## Task Commits

Pending final phase commit.

## Files Created/Modified

- `apps/cli/src/commands/doctor.command.ts` - Runtime doctor layer labels and next actions.
- `apps/cli/src/commands/repo.command.ts` - Repo doctor layer labels and build-boundary note.
- `apps/cli/src/commands/shared.ts` - Build diagnostic stage-to-layer rendering.
- `docs/troubleshooting.md` - State-layer and repo-target troubleshooting guidance.
- `docs/runtime-surfaces.md` - Repo doctor/runtime surface docs.

## Decisions Made

- Preserved existing `doctor --json` array data contract to avoid breaking callers; layer metadata is added per check.
- `repo doctor --json` returns richer object because repo target source is useful for debugging inference.

## Deviations from Plan

- Build preflight layer classification was implemented in failure rendering rather than adding a separate preflight abstraction, matching existing build report architecture.

## Issues Encountered

- Existing tests expected `doctor --json` data array; implementation adjusted to keep compatibility.

## User Setup Required

None.

## Next Phase Readiness

Phase 40 can use layer names and next actions for guided command recommendations.

## Self-Check: PASSED
