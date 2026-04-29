---
status: passed
phase: 36-prod-build-diagnostics
verified: 2026-04-29
requirements: [PROD-DIAGNOSTICS]
---

# Phase 36 Verification: Production Build Diagnostics and Nested Error Surfacing

## Goal

Preserve and print nested build causes, failing phase/stage, and failing entity path so real production build failures can be debugged from `--json --verbose` output.

## Result

Passed.

## Must-Have Checks

| Requirement                                                                    | Status | Evidence                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed build reports include structured nested cause object                    | Passed | `packages/indexer/src/types/indexer.types.ts` adds `IndexerDiagnosticCause`; `packages/indexer/src/build/build-repo.ts` attaches `diagnostics[].cause`. |
| Cause includes name, message, optional code, verbose-gated stack, nested cause | Passed | `serializeIndexerDiagnosticCause()` covers name/message/code/context/stack/cause; CLI strips stack unless verbose.                                      |
| Indexer catch blocks retain original cause                                     | Passed | `buildRepo()` and `rebuildDocs()` preserve `Error.cause`; per-doc rebuild failures keep document path/entity.                                           |
| Compiler/store/source errors propagate meaningful messages into diagnostics    | Passed | Nested GHES/source failure test asserts path/cause propagation; failed reports preserve source diagnostics collected before terminal error.             |
| JSON contracts remain backward compatible                                      | Passed | New fields are additive; failed report test asserts existing top-level fields.                                                                          |
| `build --json --verbose` exposes structured diagnostics                        | Passed | CLI failure result preserves stacks only when verbose and keeps nested diagnostic payload in `error.details`.                                           |
| Non-verbose output stays concise with rerun guidance                           | Passed | `buildFailureLines(report, false)` includes `Run again with --verbose --json to see nested cause details.`                                              |
| Troubleshooting docs explain production triage                                 | Passed | `docs/troubleshooting.md` documents `CLI_BUILD_FAILED`, `IndexerBuildError`, topology vs build, share/redact fields.                                    |

## Automated Checks

```bash
bun test packages/indexer/src/reports/build-report.test.ts packages/indexer/src/indexer.test.ts
bun test apps/cli/src/cli.test.ts --test-name-pattern "build.*diagnostic|CLI_BUILD_FAILED|verbose"
bun run typecheck
bun run lint
```

All passed on 2026-04-29.

## Notes

GSD subagents were unavailable in this runtime (`agents_installed: false` from `pi-gsd-tools init execute-phase 36`), so plans executed inline sequentially. `pi-gsd-tools state begin-phase` is unavailable in this harness (`Unknown command: state`); roadmap/state were updated through available roadmap/phase commands and manual summaries.
