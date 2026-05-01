# Roadmap: Atlas v1.2 Codebase Cleanup

## Overview

Atlas v1.2 is a cleanup milestone. The milestone is complete only when `bunx fallow` reports no issues while normal Atlas validation remains green.

Fallow baseline saved at `.planning/research/fallow/fallow-baseline.json` shows substantial analyzer signal: dead code, unused exports/types/class members, unused dev dependencies, duplication, and complexity hotspots. Parallel investigation outputs under `.planning/research/fallow/` guide implementation order.

## Phases

**Phase Numbering:** Continue from v1.1. Previous milestone ended at Phase 44, so this milestone starts at Phase 45.

- [x] **Phase 45: Fallow Baseline and Signal Normalization** - Make Fallow output actionable by fixing workspace/config entrypoint signal and classifying every finding.
- [x] **Phase 46: Dead Code and Dependency Pruning** - Remove unused files, exports, types, class members, and dependencies or justify public/API exceptions.
- [x] **Phase 47: Duplication Consolidation** - Collapse duplicated eval/reporting/test/helper logic into shared source-of-truth modules or documented narrow suppressions.
- [x] **Phase 48: Complexity Hotspot Reduction** - Split highest-priority eval, CLI/config, retrieval, artifact, and store hotspots into tested maintainable units.
- [x] **Phase 49: Fallow Zero-Issue Validation Gate** - Run final Fallow and Atlas validation, document decisions, and prepare milestone completion.

## Phase Details

### Phase 45: Fallow Baseline and Signal Normalization

**Goal**: Ensure `bunx fallow` reports project-relevant findings instead of Bun/test/script false positives.
**Depends on**: Nothing (first cleanup phase)
**Requirements**: FALL-01, FALL-02, FALL-03

**Success Criteria** (what must be TRUE):

1. `bunx fallow --format json --no-cache` baseline is reproducible and stored/compared during the phase.
2. Fallow workspace discovery no longer warns about undeclared `tooling` workspace, or rationale is documented if tool behavior differs from Bun workspaces.
3. Bun preload, script entrypoints, bundle entrypoints, and test discovery are represented through narrow config patterns.
4. Every remaining finding is assigned to fix, narrow config/suppression, public API review, or later phase.

**Plans**: 2 plans

Plans:

- [x] 45-01: Add narrow Fallow config and workspace discovery fixes.
- [x] 45-02: Classify baseline findings and document cleanup queue.

### Phase 46: Dead Code and Dependency Pruning

**Goal**: Remove dead code and dependency findings with public-surface review where needed.
**Depends on**: Phase 45
**Requirements**: DEAD-01, DEAD-02, DEAD-03, DEAD-04

**Success Criteria** (what must be TRUE):

1. Unused files and dead barrels identified as safe removals are deleted or wired intentionally.
2. Unused internal exports/types are unexported or removed while public API candidates are reviewed before change.
3. Unused dependencies/devDependencies reported by Fallow are removed from manifests and lockfile updated with Bun.
4. Class-member findings are resolved through deletion, legitimate call-site wiring, or narrow documented suppressions.
5. `bun run typecheck`, targeted tests, and `bunx fallow --only dead-code` pass for affected areas or have no remaining dead-code issues.

**Plans**: 3 plans

Plans:

- [x] 46-01: Remove safe dead files, barrels, and unused dependencies.
- [x] 46-02: Prune unused exports/types with public API review.
- [x] 46-03: Resolve class-member findings without broad suppressions.

### Phase 47: Duplication Consolidation

**Goal**: Remove or justify duplication findings, starting with eval/reporting duplication.
**Depends on**: Phase 46
**Requirements**: DUPL-01, DUPL-02, DUPL-03

**Success Criteria** (what must be TRUE):

1. `tooling/scripts/eval-reporting.ts` no longer duplicates metric, expectation, baseline, narrative, or report-building logic that belongs in `packages/eval`.
2. Exact eval-runner duplication between `packages/eval/src/index.ts` and `packages/testkit/src/eval-runner.ts` is eliminated with one source of truth.
3. Cross-suite test/helper duplication is extracted only where it improves maintainability; intentional test matrix repetition is narrowly documented or configured.
4. `bunx fallow --only dupes` reports no duplication issues or only documented, accepted suppressions that keep full `bunx fallow` clean.

**Plans**: 2 plans

Plans:

- [x] 47-01: Consolidate eval reporting and eval runner duplication.
- [x] 47-02: Resolve remaining duplication families and intentional test repetition.

### Phase 48: Complexity Hotspot Reduction

**Goal**: Reduce health findings by splitting risky large functions into tested units.
**Depends on**: Phase 47
**Requirements**: HLTH-01, HLTH-02, HLTH-03

**Success Criteria** (what must be TRUE):

1. Eval/reporting complexity hotspots are split into pure metric/expectation/baseline helpers plus rendering layers with characterization tests.
2. CLI/config orchestration hotspots are split along config resolution, repo target resolution, artifact acquisition, build selection, and output rendering boundaries.
3. Retrieval planning/ranking/scope expansion hotspots are split without changing ranking/context quality semantics.
4. Artifact verification/import and store persistence hotspots are split with rollback/row-shape characterization tests.
5. `bunx fallow --only health` reports no health issues or only narrow accepted suppressions that keep full `bunx fallow` clean.

**Plans**: 3 plans

Plans:

- [x] 48-01: Reduce eval/reporting and CLI/config hotspots.
- [x] 48-02: Reduce retrieval planning/ranking/scope hotspots.
- [x] 48-03: Reduce artifact/store persistence hotspots.

### Phase 49: Fallow Zero-Issue Validation Gate

**Goal**: Prove cleanup complete and preserve Atlas validation.
**Depends on**: Phase 48
**Requirements**: VALD-01, VALD-02, VALD-03

**Success Criteria** (what must be TRUE):

1. `bunx fallow` exits cleanly and reports no issues.
2. `bun run typecheck` passes.
3. `bun run lint` passes.
4. `bun test` passes.
5. Planning docs capture final Fallow configuration rationale, accepted suppressions, and validation evidence.

**Plans**: 1 plan

Plans:

- [x] 49-01: Run final Fallow and Atlas validation gate.

## Progress

**Execution Order:**
Phases execute in dependency order: 45 → 46 → 47 → 48 → 49

| Phase                                        | Plans Complete | Status  | Completed |
| -------------------------------------------- | -------------- | ------- | --------- |
| 45. Fallow Baseline and Signal Normalization | 2/2            | Complete | 2026-05-01 |
| 46. Dead Code and Dependency Pruning         | 3/3            | Complete | 2026-05-01 |
| 47. Duplication Consolidation                | 2/2            | Complete | 2026-05-01 |
| 48. Complexity Hotspot Reduction             | 3/3            | Complete | 2026-05-01 |
| 49. Fallow Zero-Issue Validation Gate        | 1/1            | Complete | 2026-05-01 |

**Total:** 11/11 plans complete (100%)

## Requirement Coverage

| Requirement | Phase    | Status  |
| ----------- | -------- | ------- |
| FALL-01     | Phase 45 | Complete |
| FALL-02     | Phase 45 | Complete |
| FALL-03     | Phase 45 | Complete |
| DEAD-01     | Phase 46 | Complete |
| DEAD-02     | Phase 46 | Complete |
| DEAD-03     | Phase 46 | Complete |
| DEAD-04     | Phase 46 | Complete |
| DUPL-01     | Phase 47 | Complete |
| DUPL-02     | Phase 47 | Complete |
| DUPL-03     | Phase 47 | Complete |
| HLTH-01     | Phase 48 | Complete |
| HLTH-02     | Phase 48 | Complete |
| HLTH-03     | Phase 48 | Complete |
| VALD-01     | Phase 49 | Complete |
| VALD-02     | Phase 49 | Complete |
| VALD-03     | Phase 49 | Complete |

**Coverage:** 16/16 requirements mapped (100%) ✓

---

_Roadmap created: 2026-05-01 for v1.2 Codebase Cleanup_
