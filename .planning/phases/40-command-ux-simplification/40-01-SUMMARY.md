---
phase: 40-command-ux-simplification
plan: 40-01
subsystem: cli
tags: [commander, cli, onboarding, diagnostics]
requires:
  - phase: 39
    provides: shared repo target inference and command-state clarity
provides:
  - atlas next guided command with state probe and JSON/human output
  - intent-grouped top-level help and distinct setup/init/build/index descriptions
affects: [cli, docs, onboarding]
tech-stack:
  added: []
  patterns: [shared command state probe, intent-based help footer]
key-files:
  created: [apps/cli/src/commands/next.command.ts]
  modified: [apps/cli/src/index.ts, apps/cli/src/cli.test.ts]
key-decisions:
  - "Use a standalone `atlas next` command as the guided next-step surface."
  - "Keep one recommendation primary and expose alternatives for advanced paths."
patterns-established:
  - "Next-step command probes setup, checkout metadata, registry, artifact, and corpus state before recommending a command."
requirements-completed: [COMMAND-UX]
duration: 35 min
completed: 2026-04-29
---

# Phase 40 Plan 40-01: Define Simplified Command Model and Guided Next-Step Command Summary

**Guided `atlas next` command with setup/repo/artifact/corpus state detection and intent-grouped command help**

## Performance

- **Duration:** 35 min
- **Started:** 2026-04-29T17:15:00Z
- **Completed:** 2026-04-29T17:50:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `atlas next` with human and JSON output containing `recommendedCommand`, `reason`, `state`, and `alternatives`.
- Added reusable next-step probe for missing setup, empty setup, checkout metadata without artifact, stale imports, empty corpus, and ready-to-search states.
- Updated top-level help with quick path and intent groups: Start, Use repos, Build artifacts, Search/query, Diagnose.

## Task Commits

1. **Task 40-01-01: State detection** - `f8248f37` (feat)
2. **Task 40-01-02: `atlas next` command** - `f8248f37` (feat)
3. **Task 40-01-03: Intent help** - `f8248f37` (feat)

## Files Created/Modified

- `apps/cli/src/commands/next.command.ts` - probes Atlas state and recommends next command.
- `apps/cli/src/index.ts` - registers `next` and adds intent-based help footer.
- `apps/cli/src/cli.test.ts` - covers next-step recommendations and help order.

## Decisions Made

- Chose `atlas next` rather than `status --next` because it is shorter and directly matches user intent.
- Kept `atlas index` as an alternative/fallback recommendation, never the primary happy path.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope creep.

## Issues Encountered

- GSD subagents unavailable (`agents_installed: false`), so execution ran inline sequentially.
- `pi-gsd-tools state begin-phase` is unavailable in this harness (`Unknown command: state`); tracking files updated manually.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for repo onboarding alias/docs and setup no-branding guardrails.

---

_Phase: 40-command-ux-simplification_
_Completed: 2026-04-29_
