---
phase: 36-prod-build-diagnostics
plan: 36-02
subsystem: cli
tags: [cli-build, json-errors, verbose-output, troubleshooting]
requires:
  - phase: 36-prod-build-diagnostics
    provides: nested indexer diagnostic cause chains in failed build reports
provides:
  - CLI_BUILD_FAILED JSON details with diagnostics and verbose-only stacks
  - human verbose build failure cause-chain rendering
  - CLI_BUILD_FAILED troubleshooting documentation
affects: [cli-errors, docs, production-debugging]
tech-stack:
  added: []
  patterns:
    - recursive stack stripping for non-verbose JSON failures
    - shared buildFailureLines formatter for build command failures
key-files:
  created:
    - docs/troubleshooting.md
  modified:
    - apps/cli/src/commands/build.command.ts
    - apps/cli/src/commands/shared.ts
    - apps/cli/src/utils/errors.ts
    - apps/cli/src/cli.test.ts
    - apps/cli/docs/index.md
    - docs/index.md
key-decisions:
  - "Non-verbose human build failures stay concise and point operators to --verbose --json."
  - "CLI JSON keeps nested cause messages/codes/paths in all modes but recursively omits stack unless verbose is requested."
patterns-established:
  - "Use buildFailureLines(report, verbose) for CLI build failures instead of raw reportLines()."
  - "Use toFailureResult(..., verbose) to enforce verbose-only stack emission."
requirements-completed: [PROD-DIAGNOSTICS]
duration: 25 min
completed: 2026-04-29
---

# Phase 36 Plan 36-02: Print Actionable Verbose and JSON Build Diagnostics in CLI Summary

**CLI build failures now print concise rerun guidance by default, nested cause chains in verbose human output, and stack-safe structured JSON diagnostics**

## Performance

- **Duration:** 25 min
- **Started:** 2026-04-29T16:45:00Z
- **Completed:** 2026-04-29T17:10:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `build` and repo-local `build` failures now use `buildFailureLines()` so non-verbose output stays concise and verbose output includes stage, path, code, message, context, stack, and nested cause chain.
- CLI JSON failure envelopes recursively remove `stack` fields unless `--verbose` is present, while preserving nested cause messages, codes, stage, path, and details.
- Added CLI coverage proving `CLI_BUILD_FAILED` diagnostics are stack-safe by default, verbose stacks remain available, and human verbose output includes nested root cause and failing path.
- Added production troubleshooting guidance for `CLI_BUILD_FAILED`, `IndexerBuildError`, topology-vs-build distinction, and what to share/redact.

## Task Commits

1. **Task 1: Propagate report diagnostics into CLI_BUILD_FAILED payload** - `b436fce3` (feat)
2. **Task 2: Improve human build failure output** - `b436fce3` (feat)
3. **Task 3: Document production build failure triage** - `b436fce3` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `apps/cli/src/commands/build.command.ts` - uses verbose-aware build failure formatter for global and repo-local build failures.
- `apps/cli/src/commands/shared.ts` - adds `buildFailureLines()` and nested cause formatter.
- `apps/cli/src/utils/errors.ts` - strips stack fields recursively from non-verbose JSON failure details.
- `apps/cli/src/cli.test.ts` - covers `CLI_BUILD_FAILED` verbose-only stack behavior and cause-chain rendering.
- `docs/troubleshooting.md` - documents production build failure triage.
- `docs/index.md` - links troubleshooting guide.
- `apps/cli/docs/index.md` - documents CLI build diagnostic behavior.

## Decisions Made

- Default human output remains short: build summary plus rerun command for nested diagnostics.
- Verbose human output prints stack traces because stacks are already redacted at indexer cause-serialization boundaries and are explicitly requested.
- JSON output uses one error envelope; report diagnostics remain in `error.details` for machine consumers.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** No deviations.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Production build failures now expose nested causes through `atlas build --json --verbose`, enabling Phase 37 to reproduce and fix real-repo build root causes using actionable diagnostics.

---

_Phase: 36-prod-build-diagnostics_
_Completed: 2026-04-29_
