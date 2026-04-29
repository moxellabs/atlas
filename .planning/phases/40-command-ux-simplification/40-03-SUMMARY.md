---
phase: 40-command-ux-simplification
plan: 40-03
subsystem: cli
tags: [setup, no-branding, commander, docs]
requires:
  - phase: 40-01
    provides: simplified command model and guided next-step command
provides:
  - standalone setup help without MCP display identity options
  - setup prompt/output wording focused on functional runtime setup
  - docs separating wrapper defaults from end-user setup
affects: [cli, docs, enterprise-wrapper]
tech-stack:
  added: []
  patterns: [setup-specific global option filtering, wrapper-only docs boundary]
key-files:
  created: []
  modified:
    [
      apps/cli/src/index.ts,
      apps/cli/src/commands/init.command.ts,
      apps/cli/src/cli.test.ts,
      docs/configuration.md,
      README.md,
    ]
key-decisions:
  - "Filter MCP display identity flags out of setup/init command help while preserving global and wrapper support."
  - "Keep enterprise wrapper identity/default examples in wrapper docs rather than standalone setup onboarding."
patterns-established:
  - "Standalone setup help has narrower options than global runtime surfaces where wrapper/MCP defaults still exist."
requirements-completed: [CLI-NO-BRANDING]
duration: 20 min
completed: 2026-04-29
---

# Phase 40 Plan 40-03: Remove Branding and Wrapper-Only Identity Prompts from Standalone Setup Summary

**Standalone setup now stays functional, with no MCP display identity options in setup help and docs pointing wrapper defaults to Commander code**

## Performance

- **Duration:** 20 min
- **Started:** 2026-04-29T18:10:00Z
- **Completed:** 2026-04-29T18:30:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Removed MCP display identity flags from standalone `setup`/`init` command help by using setup-specific global options.
- Changed interactive setup prompt/output wording from identity-branded language to functional runtime/artifact root language.
- Added regression tests ensuring setup help excludes wrapper-only branding, namespace, MCP title/name, and resource prefix terms.
- Updated docs to say wrapper display identity/defaults belong in embedded Commander wrapper code, not normal `atlas setup` onboarding.

## Task Commits

1. **Task 40-03-01: Setup/help audit** - `f8248f37` (feat)
2. **Task 40-03-02: No-branding tests** - `f8248f37` (feat)
3. **Task 40-03-03: Docs separation** - `10b0bb9c` (docs)

## Files Created/Modified

- `apps/cli/src/index.ts` - filters setup/init help options and preserves global/wrapper MCP defaults elsewhere.
- `apps/cli/src/commands/init.command.ts` - uses functional setup prompt/output and points next step to `atlas repo add <repo>`.
- `apps/cli/src/cli.test.ts` - adds no-branding setup help regression coverage.
- `docs/configuration.md` - separates standalone setup from wrapper display identity/defaults.
- `README.md` - keeps default onboarding simple and role-based.

## Decisions Made

- Preserved global `--atlas-mcp-name` / `--atlas-mcp-title` support for MCP/wrapper use, but hid those options from setup help.
- Kept JSON `identityRoot` setup output for compatibility while changing human wording to `Artifact root`.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope creep.

## Issues Encountered

- Planned file `apps/cli/src/commands/setup.command.ts` does not exist; setup is implemented by `apps/cli/src/commands/init.command.ts`, so audit and changes happened there.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 40 command UX is ready for focused tests, typecheck/lint, and phase verification.

---

_Phase: 40-command-ux-simplification_
_Completed: 2026-04-29_
