# Requirements: Atlas v1.2 Codebase Cleanup

**Defined:** 2026-05-01
**Core Value:** Local-first documentation ingestion, compilation, retrieval planning, and MCP/server access for multi-repo engineering docs remain reliable, explainable, and safe to ship.

## v1 Requirements

### Fallow Signal

- [x] **FALL-01**: Maintainer can run `bunx fallow` from repo root without workspace-discovery warnings.
- [x] **FALL-02**: Maintainer sees false-positive-prone test files, Bun preload files, script entrypoints, and bundle entrypoints handled through narrow Fallow configuration.
- [x] **FALL-03**: Maintainer can inspect every remaining Fallow finding and determine whether it is fixed, intentionally configured, or explicitly deferred with rationale.

### Dead Code

- [x] **DEAD-01**: Maintainer can remove unused files, dead barrels, and orphan helpers reported by Fallow without breaking repository builds.
- [x] **DEAD-02**: Maintainer can remove or unexport unused internal exports and types while preserving reviewed public API surfaces.
- [x] **DEAD-03**: Maintainer can remove unused package dependencies and devDependencies reported by Fallow.
- [x] **DEAD-04**: Maintainer can resolve unused class-member findings through deletion, call-site wiring, or narrow justification.

### Duplication

- [x] **DUPL-01**: Maintainer can consolidate eval/reporting duplication so metric, baseline, expectation, and report-building logic has one source of truth.
- [x] **DUPL-02**: Maintainer can eliminate exact eval-runner duplication between eval and testkit packages.
- [x] **DUPL-03**: Maintainer can resolve remaining duplication findings through shared helpers or documented narrow suppressions where test repetition is intentional.

### Complexity

- [x] **HLTH-01**: Maintainer can reduce top eval/reporting complexity hotspots into tested pure helpers and renderers.
- [x] **HLTH-02**: Maintainer can reduce CLI/config orchestration hotspots by splitting config resolution, repo target resolution, artifact acquisition, and output rendering.
- [x] **HLTH-03**: Maintainer can reduce retrieval/artifact/store hotspots with characterization tests around ranking, scope inference, verification, import, and persistence boundaries.

### Validation

- [x] **VALD-01**: Maintainer can run `bunx fallow` and receive no reported issues.
- [x] **VALD-02**: Maintainer can run `bun run typecheck`, `bun run lint`, and `bun test` successfully after cleanup.
- [x] **VALD-03**: Maintainer can update planning docs with final Fallow cleanup decisions and any accepted analyzer configuration rationale.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Cleanup Automation

- **AUTO-01**: Maintainer can run Fallow as part of CI/release gating.
- **AUTO-02**: Maintainer can track Fallow trend snapshots over time.
- **AUTO-03**: Maintainer can enforce no-regression Fallow checks on changed workspaces only.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                           | Reason                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| New Atlas product capabilities    | Milestone is analyzer-driven cleanup only                           |
| Full architecture rewrite         | Cleanup should target Fallow findings, not redesign every subsystem |
| Broad ignore-all Fallow config    | Would satisfy command cosmetically while hiding real issues         |
| Public API removal without review | Cleanup must not accidentally break package consumers               |
| CI gating as first milestone step | Gate should land after repo reaches zero Fallow issues              |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

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

**Coverage:**

- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---

_Requirements defined: 2026-05-01_
_Last updated: 2026-05-01 after zero-Fallow validation_
