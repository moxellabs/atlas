---
phase: 38-local-git-checkout-semantics
plan: 38-02
subsystem: diagnostics
tags: [local-git, remote-ref, diagnostics, docs]
requires:
  - phase: 38-local-git-checkout-semantics
    provides: current-checkout ref mode
provides:
  - Actionable remote-ref error text for missing origin refs
  - Documentation explaining remote mode versus current checkout mode
  - Troubleshooting guidance for local-only branch failures
affects: [source-git-errors, troubleshooting, ingestion-docs]
tech-stack:
  added: []
  patterns:
    - Product-level Git error messages include attempted mode and recovery path
key-files:
  created: []
  modified:
    - packages/source-git/src/git/git-errors.ts
    - packages/source-git/src/cache/fetch-updates.ts
    - packages/source-git/src/cache/partial-clone.ts
    - docs/configuration.md
    - docs/ingestion-build-flow.md
    - docs/troubleshooting.md
key-decisions:
  - "Remote-ref failures say the ref was not found on origin and suggest refMode: current-checkout."
  - "Docs define HEAD/current branch/detached HEAD semantics separately for remote and current-checkout modes."
patterns-established:
  - "Remote mode diagnostics should name origin ref resolution instead of generic Git failure."
requirements-completed: [LOCAL-GIT-ERRORS]
duration: 20min
completed: 2026-04-29
---

# Phase 38: Remote-Ref Error and Docs Summary

**Remote-ref failures now explain origin ref resolution and point local-only branch users to current-checkout mode**

## Performance

- **Duration:** 20 min
- **Started:** 2026-04-29T17:03:00Z
- **Completed:** 2026-04-29T17:23:00Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Improved `GitRefResolutionError` and clone fetch failures with origin-ref wording and `refMode: current-checkout` recovery guidance.
- Attached `ref` and `refMode` to source-git error context for structured diagnostics.
- Documented local-git remote mode versus current-checkout mode in configuration, ingestion/build flow, and troubleshooting docs.
- Verified focused remote-ref and current-checkout tests plus typecheck/lint.

## Task Commits

Implemented inline sequentially because GSD subagents unavailable in init output (`agents_installed: false`). Final phase commit contains all task changes.

1. **38-02: Clarify remote-ref errors and docs** - final phase commit

## Files Created/Modified

- `packages/source-git/src/git/git-errors.ts` - adds actionable messages for remote ref failures.
- `packages/source-git/src/cache/fetch-updates.ts` - includes `ref` and `refMode` context for failed remote fetch resolution.
- `packages/source-git/src/cache/partial-clone.ts` - includes ref context when clone-time ref fetch fails.
- `docs/configuration.md` - documents `refMode` values and semantics.
- `docs/ingestion-build-flow.md` - documents repo-local init/build current-checkout defaults and remote-mode caveat.
- `docs/troubleshooting.md` - adds `GIT_REF_RESOLUTION_FAILED` recovery section.

## Decisions Made

- Use exact product-level wording: remote mode fetches `origin <ref>` and is not current working tree reading.
- Keep structured context small: `ref` and `refMode` are enough for verbose/JSON diagnostics without parsing stderr.

## Deviations from Plan

None beyond inline sequential execution due unavailable GSD subagents.

## Issues Encountered

None for this plan.

## User Setup Required

None.

## Next Phase Readiness

Phase 39 can reference clear state layers and command guidance without also explaining hidden local-git checkout behavior.

---

_Phase: 38-local-git-checkout-semantics_
_Completed: 2026-04-29_
