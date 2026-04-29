---
phase: 38-local-git-checkout-semantics
plan: 38-01
subsystem: source-git
tags: [local-git, current-checkout, ref-mode, cli]
requires:
  - phase: 36-production-build-diagnostics
    provides: nested source diagnostics and CLI build failure surfacing
provides:
  - Explicit local-git refMode schema with remote and current-checkout semantics
  - Current-checkout source-git path that reads local HEAD without fetch or checkout
  - CLI init/build wiring for repo-local artifact builds from local-only branches and detached HEAD
affects: [local-git, cli-init, cli-build, source-git]
tech-stack:
  added: []
  patterns:
    - Explicit ref resolution mode on local-git configs
key-files:
  created: []
  modified:
    - packages/config/src/atlas-config.schema.ts
    - packages/core/src/types/repo.types.ts
    - packages/source-git/src/cache/repo-cache.service.ts
    - packages/source-git/src/cache/fetch-updates.ts
    - packages/source-git/src/adapters/local-git-source.adapter.test.ts
    - apps/cli/src/commands/init.command.ts
    - apps/cli/src/commands/build.command.ts
    - apps/cli/src/commands/shared.ts
    - apps/cli/src/index.ts
key-decisions:
  - "Use git.refMode: remote | current-checkout; remote remains default for configured repos."
  - "current-checkout validates localPath as a Git checkout and resolves git rev-parse HEAD without fetch, checkout, clone, or sparse mutation."
patterns-established:
  - "Repo-local atlas init defaults to current-checkout so local-only branches and detached HEAD can build."
requirements-completed: [LOCAL-GIT-CHECKOUT]
duration: 45min
completed: 2026-04-29
---

# Phase 38: Local-Git Checkout Semantics Summary

**Explicit `local-git` ref mode lets Atlas build current local checkouts without requiring an origin ref**

## Performance

- **Duration:** 45 min
- **Started:** 2026-04-29T16:38:44Z
- **Completed:** 2026-04-29T17:23:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added `git.refMode` schema/type support with `remote` default and `current-checkout` opt-in.
- Added current-checkout cache path that validates existing checkout, skips clone/fetch/checkout/sparse mutations, and resolves local `HEAD`.
- Updated repo-local `atlas init` to record `refMode: current-checkout`; `atlas build` reads checkout `HEAD` for local-only branches and detached HEAD.
- Added regression coverage for local-only branch success, remote-mode failure, and detached HEAD `ref: HEAD` semantics.

## Task Commits

Implemented inline sequentially because GSD subagents unavailable in init output (`agents_installed: false`). Final phase commit contains all task changes.

1. **38-01-01: Design config and source adapter branch** - final phase commit
2. **38-01-02: Add local-only branch regression tests** - final phase commit
3. **38-01-03: Wire CLI init/defaults** - final phase commit

## Files Created/Modified

- `packages/config/src/atlas-config.schema.ts` - adds `atlasGitRefModeSchema` and `git.refMode` default.
- `packages/core/src/types/repo.types.ts` - exposes optional `git.refMode` to source adapters.
- `packages/source-git/src/cache/repo-cache.service.ts` - implements current-checkout ensure/update/status semantics.
- `packages/source-git/src/cache/fetch-updates.ts` - adds current-checkout revision resolver alias and richer remote-ref context.
- `packages/source-git/src/adapters/local-git-source.adapter.test.ts` - covers local-only branch, detached HEAD, and remote-mode failures.
- `apps/cli/src/commands/init.command.ts` - records repo-local artifact metadata with `refMode`.
- `apps/cli/src/commands/build.command.ts` - uses current checkout path when metadata says current-checkout.
- `apps/cli/src/commands/shared.ts` / `apps/cli/src/index.ts` - carry `--ref-mode` and metadata through CLI config paths.

## Decisions Made

- Remote remains default for normal configured repos to preserve existing cache/fetch behavior.
- Current-checkout skips sparse checkout because mutating a user's working tree would be surprising and unsafe.
- Repo-local artifact publishing defaults to current-checkout because it is explicitly run from an existing checkout.

## Deviations from Plan

- Combined implementation into one final commit instead of per-task commits because execution ran inline without GSD executor subagents.

## Issues Encountered

- `pi-gsd-tools state begin-phase` returned `Error: Unknown command: state`; state/roadmap updates were handled manually.
- GSD subagents unavailable (`agents_installed: false`); inline sequential execution used.

## User Setup Required

None.

## Next Phase Readiness

Phase 39 can build on explicit repo state semantics; current-checkout vs remote mode is now represented in config, metadata, docs, and source diagnostics.

---

_Phase: 38-local-git-checkout-semantics_
_Completed: 2026-04-29_
