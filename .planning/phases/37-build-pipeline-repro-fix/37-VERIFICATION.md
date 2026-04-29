---
status: passed
phase: 37-build-pipeline-repro-fix
verified: 2026-04-29
requirements: [PROD-BUILD-REPRO, PROD-BUILD-FIX]
---

# Phase 37 Verification: Real-Repo Build Pipeline Repro and Root-Cause Fixes

## Goal

Reproduce the incident boundary where `inspect topology --live` succeeds but `build` fails, then fix the actual post-discovery build-stage bug exposed by Phase 36 diagnostics.

## Result

Passed.

## Must-Have Checks

| Requirement                                        | Status | Evidence                                                                                                                                                                                          |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topology success/build failure boundary reproduced | Passed | `apps/cli/src/cli.test.ts` includes `inspect topology --live succeeds while build reports post-discovery compile failure`; same checkout passes live topology and fails `build --json --verbose`. |
| Failed build JSON includes nested cause            | Passed | CLI regression asserts `CLI_BUILD_FAILED`, `diagnostics[].stage`, `path`, and nested `CompilerFrontmatterError` cause chain.                                                                      |
| Discovery/planning completion visible on failure   | Passed | `packages/indexer/src/build/build-repo.ts` records selected-doc count before rebuild; tests assert non-zero `docsConsidered` on failed build.                                                     |
| Corpus remains transactional on failure            | Passed | `packages/indexer/src/indexer.test.ts` asserts no docs and no manifest are persisted after post-discovery compile failure.                                                                        |
| Actual build-stage root cause fixed                | Passed | Source listings now ignore generated/vendor directories that live topology skips; malformed ignored `.moxel`/`node_modules` skill docs no longer poison builds.                                   |
| Failing stage/entity diagnostics precise           | Passed | `rebuildDocs()` wraps compile and chunk stages separately; `buildRepo()` wraps persistence stage; tests assert compile path/entity.                                                               |
| Troubleshooting docs cover failure classes         | Passed | `docs/troubleshooting.md` documents source, planning, compile, chunk, persistence, build stages and ignored-directory regression signal.                                                          |

## Automated Checks

```bash
bun test packages/indexer/src/indexer.test.ts apps/cli/src/cli.test.ts --test-name-pattern "post-discovery|build failure|topology.*build|generated and vendored|CLI_BUILD_FAILED"
bun test packages/source-ghes/src/ghes-source.test.ts --test-name-pattern "tree|blob|list"
bun run typecheck
bun run lint
```

All passed on 2026-04-29.

## Notes

GSD subagents were unavailable in this runtime (`agents_installed: false` from `pi-gsd-tools init execute-phase 37`), so plans executed inline sequentially. `pi-gsd-tools state begin-phase` is unavailable in this harness (`Unknown command: state`); roadmap/state were updated through available roadmap/phase commands and manual summaries.
