---
phase: 40-command-ux-simplification
plan: 40-02
subsystem: cli
tags: [repo-onboarding, commander, docs]
requires:
  - phase: 40-01
    provides: simplified command model and guided next-step command
provides:
  - primary `atlas repo add <repo>` command alias sharing add-repo implementation
  - role-based docs for consumer, maintainer, and local-only fallback flows
affects: [cli, docs, onboarding]
tech-stack:
  added: []
  patterns: [nested command alias wrapper, role-based onboarding docs]
key-files:
  created: []
  modified:
    [
      apps/cli/src/index.ts,
      apps/cli/src/cli.test.ts,
      README.md,
      docs/ingestion-build-flow.md,
      apps/cli/docs/index.md,
    ]
key-decisions:
  - "Document `atlas repo add` as primary while preserving `atlas add-repo` compatibility."
  - "Keep JSON/script result shape stable by delegating to the existing add-repo implementation."
patterns-established:
  - "Nested aliases can adapt argv before delegating to existing command runners."
requirements-completed: [COMMAND-UX]
duration: 20 min
completed: 2026-04-29
---

# Phase 40 Plan 40-02: Consolidate Repo Onboarding Command Aliases and Docs Summary

**Primary `atlas repo add` lifecycle command with compatibility alias and role-based onboarding docs**

## Performance

- **Duration:** 20 min
- **Started:** 2026-04-29T17:50:00Z
- **Completed:** 2026-04-29T18:10:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `atlas repo add <repo>` under the repo lifecycle namespace while preserving `atlas add-repo`.
- Added tests proving nested and top-level add commands return equivalent JSON result shapes.
- Rewrote onboarding docs around consumer, maintainer, and local-only fallback paths, with `atlas next` as safe first command.

## Task Commits

1. **Task 40-02-01: `repo add` alias** - `f8248f37` (feat)
2. **Task 40-02-02: Role-based docs** - `10b0bb9c` (docs)

## Files Created/Modified

- `apps/cli/src/index.ts` - mounts `repo add` and delegates to existing add-repo runner.
- `apps/cli/src/cli.test.ts` - covers alias result shape.
- `README.md` - adds choose-your-path quickstart.
- `docs/ingestion-build-flow.md` - updates repo consumption, artifact fetch, missing artifact, and local-only fallback wording.
- `apps/cli/docs/index.md` - updates command inventory and groups.

## Decisions Made

- Preferred `repo add` in docs/help to make repository lifecycle discoverable.
- Retained `add-repo` as an explicit compatibility alias without changing its output contract.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope creep.

## Issues Encountered

- Planned docs `docs/quickstart.md`, `docs/consumer-workflow.md`, and `docs/maintainer-workflow.md` do not exist in this repository. Equivalent active docs were updated instead: `README.md`, `docs/ingestion-build-flow.md`, and `apps/cli/docs/index.md`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for final setup no-branding verification and phase-level validation.

---

_Phase: 40-command-ux-simplification_
_Completed: 2026-04-29_
