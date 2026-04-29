---
phase: 39-init-and-state-ux
plan: 39-01
subsystem: cli
tags: [repo-target, init, git-origin, cwd-inference]
requires:
  - phase: 38
    provides: local-git current-checkout semantics for repo-local artifact publishing
provides:
  - init target inference from repo metadata, cwd/config, Git origin, and config fallback
  - precise missing/ambiguous target errors with checked sources and candidates
affects: [cli, repo-targeting, phase-40]
tech-stack:
  added: []
  patterns: [shared repo target resolver]
key-files:
  created:
    - apps/cli/src/commands/repo-target.ts
  modified:
    - apps/cli/src/commands/init.command.ts
    - apps/cli/src/cli.test.ts
    - apps/cli/docs/index.md
key-decisions:
  - "GitHub.com origin inference uses built-in default host semantics; unknown GHES origins still require host setup."
  - "Explicit --repo/--repo-id and --host/--owner/--name continue to win over inferred targets."
patterns-established:
  - "Repo target resolution returns repoId, source, reason, hostStatus, and ambiguity candidates."
requirements-completed: [INIT-STATE-UX]
duration: 1h
completed: 2026-04-29
---

# Phase 39: Init Target Inference Summary

`atlas init` can infer repo identity from current checkout signals instead of forcing repeated canonical repo IDs.

## Performance

- **Duration:** 1h
- **Started:** 2026-04-29T16:49:00Z
- **Completed:** 2026-04-29T17:00:00Z
- **Tasks:** 2/2
- **Files modified:** 4+

## Accomplishments

- Added shared repo target resolver with explicit, positional, bare-name, repo metadata, cwd/config, Git origin, and single-config sources.
- Wired `atlas init` to emit `targetResolution` in JSON and show source in human output.
- Added CLI regression coverage for GitHub origin inference, cwd inference, bare-name resolution, and ambiguity candidate lists.

## Task Commits

Pending final phase commit.

## Files Created/Modified

- `apps/cli/src/commands/repo-target.ts` - Shared resolver and ambiguity handling.
- `apps/cli/src/commands/init.command.ts` - Init target inference and JSON source metadata.
- `apps/cli/src/cli.test.ts` - Repo target inference regression coverage.
- `apps/cli/docs/index.md` - CLI docs for shared target inference.

## Decisions Made

- Built resolver as CLI command helper, not config package API, because it depends on cwd, prompts, Git, and command mode.
- Allowed canonical explicit targets to preserve existing behavior even when host is not configured; Git-origin inference for unknown non-GitHub hosts still asks for host setup.

## Deviations from Plan

- Resolver implemented directly in new `repo-target.ts` instead of `shared.ts` to avoid bloating shared command utilities.

## Issues Encountered

- GSD subagents unavailable; executed inline sequentially.
- `pi-gsd-tools state begin-phase` unavailable (`Unknown command: state`); tracking updated manually.

## User Setup Required

None.

## Next Phase Readiness

Phase 40 can build guided next-step UX on `targetResolution.source` and structured missing/ambiguous errors.

## Self-Check: PASSED
