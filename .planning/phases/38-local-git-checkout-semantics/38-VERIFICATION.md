---
status: passed
phase: 38-local-git-checkout-semantics
verified: 2026-04-29T17:23:00Z
verifier: inline
---

# Phase 38 Verification: Local-Git Checkout Semantics and Local Branch Support

## Goal

Make `local-git` usable for local-only branches and explicit about whether Atlas reads current checkout or fetches a remote ref.

## Result

**Passed.** Atlas now supports explicit `git.refMode: "remote" | "current-checkout"`. Remote mode remains default and fetches `origin <ref>`. Current-checkout mode validates an existing Git checkout, resolves local `HEAD`, and skips clone/fetch/checkout/sparse mutations.

## Must-Haves

| Requirement                                                                                            | Status | Evidence                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local-only checked-out branch can build in current-checkout mode.                                      | Passed | `LocalGitSourceAdapter integration > builds a local-only branch in current-checkout mode without fetching origin`                             |
| Existing remote-ref cache behavior remains available and tested.                                       | Passed | Full `local-git-source.adapter.test.ts` still passes remote clone/fetch/sparse/update tests.                                                  |
| `ref: "HEAD"` semantics documented and tested.                                                         | Passed | Detached HEAD current-checkout test; docs in `docs/ingestion-build-flow.md` and `docs/troubleshooting.md`.                                    |
| Error text tells users when Atlas tried remote ref resolution and how to choose current-checkout mode. | Passed | `GitRefResolutionError`/`GitCloneError` messages include origin ref and `refMode: current-checkout`; focused remote-ref test asserts message. |
| Docs warn remote mode is not current working tree.                                                     | Passed | `docs/configuration.md`, `docs/ingestion-build-flow.md`, and `docs/troubleshooting.md`.                                                       |

## Automated Checks

```bash
bun test packages/source-git/src/adapters/local-git-source.adapter.test.ts --test-name-pattern "current-checkout|detached HEAD|remote ref|missing remote"
bun test apps/cli/src/cli.test.ts --test-name-pattern "init|current checkout|local-only"
bun test packages/source-git/src/adapters/local-git-source.adapter.test.ts
bun run typecheck
bun run lint
```

All checks passed.

## Requirement Traceability

- `LOCAL-GIT-CHECKOUT`: passed via config/schema/type support, source-git current-checkout branch, CLI init/build metadata, local-only and detached HEAD tests.
- `LOCAL-GIT-ERRORS`: passed via remote-ref error context/messages and docs/troubleshooting updates.

## Notes

GSD verifier subagent unavailable in this runtime (`agents_installed: false`), so verification ran inline. No human verification required.
