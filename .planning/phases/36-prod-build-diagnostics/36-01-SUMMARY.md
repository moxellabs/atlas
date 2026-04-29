---
phase: 36-prod-build-diagnostics
plan: 36-01
subsystem: indexer
tags: [build-diagnostics, errors, reports, redaction]
requires:
  - phase: 35-embedded-enterprise-cli-mount
    provides: commander CLI mount and stable build command surface
provides:
  - redacted nested IndexerDiagnosticCause model
  - failed build reports with stage, repo, entity path, and nested causes
  - source diagnostics preserved on failed builds
affects: [cli-build, indexer-reports, production-debugging]
tech-stack:
  added: []
  patterns:
    - serializable redacted error cause chains
    - source diagnostics captured across failed withDiagnostics scopes
key-files:
  created: []
  modified:
    - packages/indexer/src/types/indexer.types.ts
    - packages/indexer/src/errors/indexer-errors.ts
    - packages/indexer/src/build/build-repo.ts
    - packages/indexer/src/build/rebuild-docs.ts
    - packages/indexer/src/services/create-indexer-services.ts
    - packages/indexer/src/index.ts
    - packages/indexer/src/indexer.test.ts
    - packages/indexer/src/reports/build-report.test.ts
key-decisions:
  - "Build reports carry stack-bearing causes internally; CLI strips stack fields unless verbose output is requested."
  - "Document-level rebuild failures preserve the failing classified document path as diagnostic path/entity."
patterns-established:
  - "Use serializeIndexerDiagnosticCause for unknown thrown values and nested Error.cause chains."
  - "Attach captured source diagnostics to failed build reports before the terminal error diagnostic."
requirements-completed: [PROD-DIAGNOSTICS]
duration: 35 min
completed: 2026-04-29
---

# Phase 36 Plan 36-01: Preserve Nested Build Causes in Indexer Reports Summary

**Redacted nested build diagnostic cause chains now preserve stage, repo, entity path, source diagnostics, and original compiler/source errors in failed indexer build reports**

## Performance

- **Duration:** 35 min
- **Started:** 2026-04-29T16:10:00Z
- **Completed:** 2026-04-29T16:45:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `IndexerDiagnosticCause` and `serializeIndexerDiagnosticCause()` for unknown values, known `Error` objects, `Error.cause`, codes, context, stack, and redaction.
- Failed `buildRepo()` reports now include captured source diagnostics plus terminal error diagnostics with `operation`, `repoId`, `entity`, `path`, and nested cause chain.
- `rebuildDocs()` wraps per-document failures with failing document path and avoids hiding that path behind a broader rebuild wrapper.
- `withDiagnostics()` preserves source diagnostic events when its operation throws.
- Added tests for failed report field stability, redaction, source-diagnostic preservation, and failing document path surfacing.

## Task Commits

1. **Task 1: Add structured cause type to indexer diagnostics** - `b8fdc2a2` (feat)
2. **Task 2: Attach cause chain to failed BuildReport diagnostics** - `b8fdc2a2` (feat)
3. **Task 3: Keep failed build report machine-readable and stable** - `b8fdc2a2` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `packages/indexer/src/types/indexer.types.ts` - adds `IndexerDiagnosticCause` and additive `IndexerDiagnostic.cause`.
- `packages/indexer/src/errors/indexer-errors.ts` - serializes and redacts nested cause chains.
- `packages/indexer/src/build/build-repo.ts` - attaches source diagnostics and structured terminal error diagnostics to failed reports.
- `packages/indexer/src/build/rebuild-docs.ts` - preserves failing document path/entity for compile/read failures.
- `packages/indexer/src/services/create-indexer-services.ts` - carries source diagnostics through thrown `withDiagnostics()` operations.
- `packages/indexer/src/index.ts` - exports cause serializer and type.
- `packages/indexer/src/indexer.test.ts` - asserts failed rebuild recovery keeps nested path/cause diagnostics.
- `packages/indexer/src/reports/build-report.test.ts` - asserts failed report top-level fields and cause redaction stability.

## Decisions Made

- Stack traces remain present in indexer failure reports so CLI can expose them only when verbose mode is requested.
- Source diagnostics captured before failure remain part of failed build reports; consumers must look for severity `error` rather than assuming first diagnostic is terminal.
- Per-document rebuild errors rethrow existing `IndexerBuildError` instances to avoid losing entity path context.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Preserve source diagnostics when withDiagnostics throws**

- **Found during:** Task 2 (Attach cause chain to failed BuildReport diagnostics)
- **Issue:** `withDiagnostics()` returned diagnostics only on success, so failure reports could not include source diagnostics collected before the exception.
- **Fix:** Attach captured diagnostics to thrown error via non-enumerable `__indexerDiagnostics`, then read them in `buildRepo()` catch path.
- **Files modified:** `packages/indexer/src/services/create-indexer-services.ts`, `packages/indexer/src/build/build-repo.ts`
- **Verification:** `bun test packages/indexer/src/indexer.test.ts`
- **Committed in:** `b8fdc2a2`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required to satisfy source diagnostic preservation. No scope creep.

## Issues Encountered

- Existing indexer recovery test assumed the first diagnostic was the terminal error. Updated to assert error diagnostic via `arrayContaining` because failed reports now preserve preceding source diagnostics as intended.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Indexer reports now contain structured nested build failure diagnostics for CLI rendering in Plan 36-02.

---

_Phase: 36-prod-build-diagnostics_
_Completed: 2026-04-29_
