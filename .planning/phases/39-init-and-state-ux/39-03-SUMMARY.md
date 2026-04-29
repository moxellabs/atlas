---
phase: 39-init-and-state-ux
plan: 39-03
subsystem: cli
tags: [repo-target, build, inspect, repo-command, ambiguity]
requires:
  - phase: 39-01
    provides: shared repo target resolver
provides:
  - shared repo target resolver wired through build, repo doctor/show, and inspect repo/topology
  - optional repo args for cwd-inferred repo doctor/show/inspect repo
  - non-interactive ambiguity errors with candidate IDs
affects: [cli, command-ux, phase-40]
tech-stack:
  added: []
  patterns: [targetResolution JSON metadata]
key-files:
  created:
    - apps/cli/src/commands/repo-target.ts
  modified:
    - apps/cli/src/commands/build.command.ts
    - apps/cli/src/commands/repo.command.ts
    - apps/cli/src/commands/inspect.command.ts
    - apps/cli/src/index.ts
    - apps/cli/src/cli.test.ts
    - docs/troubleshooting.md
    - docs/runtime-surfaces.md
key-decisions:
  - "Build infers a repo target from cwd/config when one is discoverable, but preserves build-all behavior when no target is inferable."
  - "JSON/non-interactive ambiguity never prompts; interactive mode can choose safely via Clack."
patterns-established:
  - "Commands call `resolveRepoTarget()` with explicit/positional input and command label."
requirements-completed: [REPO-TARGET-UX]
duration: 1h
completed: 2026-04-29
---

# Phase 39: Shared Repo Target Resolver Summary

Repo-targeting commands now share cwd, metadata, Git origin, bare-name, and ambiguity resolution instead of duplicating `--repo-id` parsing.

## Performance

- **Duration:** 1h
- **Started:** 2026-04-29T16:49:00Z
- **Completed:** 2026-04-29T17:00:00Z
- **Tasks:** 3/3
- **Files modified:** 8+

## Accomplishments

- Created `resolveRepoTarget()` and `readRepoTargetArg()` helper.
- Wired resolver through `build`, `repo doctor`, `repo show`, `inspect repo`, and `inspect topology`.
- Made `repo doctor`, `repo show`, and `inspect repo` positional repo arguments optional so cwd inference can work.
- Added focused regression coverage for Git origin inference, cwd-config inference, bare-name resolution, and ambiguity candidate output.

## Task Commits

Pending final phase commit.

## Files Created/Modified

- `apps/cli/src/commands/repo-target.ts` - Resolver implementation.
- `apps/cli/src/commands/build.command.ts` - Build target inference and JSON target resolution metadata.
- `apps/cli/src/commands/repo.command.ts` - Repo doctor/show shared target resolution.
- `apps/cli/src/commands/inspect.command.ts` - Inspect repo/topology shared target resolution.
- `apps/cli/src/index.ts` - Optional repo args for inference-capable commands.
- `apps/cli/src/cli.test.ts` - Focused resolver behavior tests.

## Decisions Made

- Unregistered GitHub.com origins can infer canonical IDs without host setup because GitHub default host config is built in.
- Unknown non-GitHub origins are treated as GHES/enterprise and fail with host setup guidance.
- `build` only switches to a single target when resolver finds one; otherwise it retains existing build-all semantics.

## Deviations from Plan

- Interactive chooser support is implemented through resolver prompt path but covered by non-interactive JSON ambiguity tests rather than TTY integration tests.

## Issues Encountered

- Commander arg definitions blocked inference for commands with required `<repo>` args; changed eligible commands to `[repo]`.

## User Setup Required

None.

## Next Phase Readiness

Phase 40 can simplify command UX around inferred targets and use resolver errors for next-step guidance.

## Self-Check: PASSED
