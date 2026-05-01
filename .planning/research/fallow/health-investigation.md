# Fallow Health Investigation

## Files Retrieved

1. `tooling/scripts/eval-reporting.ts` (lines 461-977) - highest finding volume; eval/reporting pipeline.
2. `packages/eval/src/retrieval-harness/report.ts` (lines 43-183) - report aggregation and ranking metrics.
3. `apps/cli/src/commands/shared.ts` (lines 194-331, 444-560) - CLI config resolution and repo metadata helpers.
4. `apps/cli/src/commands/add-repo.command.ts` (lines 217-497) - repo add orchestration and artifact import path.
5. `apps/cli/src/commands/build.command.ts` (lines 67-380) - build selector parsing and repo-local build path.
6. `apps/cli/src/commands/repo.command.ts` (lines 71-366) - repo doctor/show/remove flows.
7. `apps/cli/src/index.ts` (lines 40-137, 630-740) - CLI bootstrap, command registration, context build.
8. `apps/cli/src/commander.ts` (lines 28-110) - high-churn CLI mount/bootstrap hotspot.
9. `packages/config/src/loaders/load-config.ts` (lines 120-223, 481-508) - config discovery/validation/loading.
10. `packages/retrieval/src/planner/plan-context.ts` (lines 58-430) - retrieval planning pipeline.
11. `packages/retrieval/src/ranking/rank-candidates.ts` (lines 10-96) - ranking weights and dedupe.
12. `packages/retrieval/src/planner/expand-sections.ts` (lines 21-107) - expansion policy.
13. `packages/retrieval/src/scopes/infer-scopes.ts` (lines 21-192) - scope inference.
14. `packages/indexer/src/artifact.ts` (lines 194-273, 691-895, 965-1115) - artifact build/verify/import pipeline.
15. `packages/store/src/docs/doc.repository.ts` (lines 22-170, 224-325) - document persistence and scope mapping.
16. `packages/store/src/manifests/manifest.repository.ts` (lines 7-150) - manifest persistence.

## Key Code

- `tooling/scripts/eval-reporting.ts:461-977` — `evaluateExpectations`, `buildReport`, `printTerminalSummary`, `renderHtml`, `renderReportCss`.
  - Findings: 22 total (5 critical, 8 high, 9 moderate).
  - Hotspot: score 37.3, 6 entries.
- `packages/eval/src/retrieval-harness/report.ts:43-183` — `buildReport`, `rankBuckets`, `latencyBuckets`, `weakestCases`.
  - Findings: 9 total (3 critical, 4 high, 2 moderate).
- `apps/cli/src/commands/shared.ts:194-331, 444-560` — `resolveRepoConfigInput`, `createRepoMetadata`, repo metadata IO.
  - Findings: 9 total (4 critical, 3 high, 2 moderate).
- `apps/cli/src/commands/add-repo.command.ts:217-497` — `runAddRepoCommand`.
  - Findings: 3 total (2 critical, 1 high).
  - Complexity: cyclomatic 52, cognitive 60.
- `apps/cli/src/commands/build.command.ts:67-380` — `runBuildCommand`, `runRepoLocalBuild`.
  - Findings: 3 total (2 critical, 1 high).
- `apps/cli/src/commands/repo.command.ts:71-366` — `runRepoDoctor`, `renderRepoShowLines`, `runRepoRemove`.
  - Findings: 4 total (3 critical, 1 moderate).
- `apps/cli/src/index.ts:40-137, 630-740` — `runCli`, `registerAtlasCommands`, `buildContext`.
  - Findings: 7 total (2 critical, 4 high, 1 moderate).
- `apps/cli/src/commander.ts:28-110` — mount/bootstrap wrapper.
  - Hotspot only: score 37.5, 5 commits, stable.
- `packages/config/src/loaders/load-config.ts:120-223, 481-508` — config path discovery + `loadConfig`.
  - Findings: 6 total (2 critical, 1 high, 3 moderate).
  - Hotspot: score 20.1, stable.
- `packages/retrieval/src/planner/plan-context.ts:58-430` — `planContext`, `gatherCandidates`, scope enrichment.
  - Findings: 10 total (4 critical, 2 high, 4 moderate).
  - Hotspot: score 21.9, accelerating.
- `packages/retrieval/src/ranking/rank-candidates.ts:10-96` — `rankCandidates`, `queryKindWeight`, `dedupeCandidates`.
  - Findings: 4 total (1 critical, 3 moderate).
  - Target: split_high_impact.
- `packages/retrieval/src/planner/expand-sections.ts:21-107` — `expandSections`, `expansionPriority`.
  - Findings: 4 total (2 critical, 2 moderate).
- `packages/retrieval/src/scopes/infer-scopes.ts:21-192` — `inferScopes`, `scoreLabel`, `mergeScopeCandidates`.
  - Findings: 3 total (1 critical, 2 moderate).
- `packages/indexer/src/artifact.ts:194-273, 691-895, 965-1115` — manifest build, corpus validation, artifact verification/import.
  - Findings: 12 total (4 critical, 4 high, 4 moderate).
- `packages/store/src/docs/doc.repository.ts:22-170, 224-325` — document row upsert/replace/scope mapping.
  - Findings: 4 total (3 critical, 1 high).
- `packages/store/src/manifests/manifest.repository.ts:7-150` — manifest upsert/partial-build state.
  - Findings: 4 total (2 critical, 2 moderate).

## Architecture

- CLI flows split into command orchestrators (`apps/cli/src/commands/*`), central bootstrap (`apps/cli/src/index.ts` and `commander.ts`), and shared config/repo helpers (`shared.ts`, `load-config.ts`).
- Retrieval pipeline: `plan-context.ts` builds candidate set, `rank-candidates.ts` scores, `expand-sections.ts` expands detail, `infer-scopes.ts` seeds scopes.
- Artifact pipeline: `artifact.ts` validates manifest/checksums/safety, verifies importability, and imports corpus into store.
- Reporting pipeline: `eval-reporting.ts` and harness `report.ts` compute metrics, thresholds, regressions, and HTML/text views.
- Persistence layer: `doc.repository.ts` and `manifest.repository.ts` own DB row mapping and transaction edges.

## Start Here

- Open `tooling/scripts/eval-reporting.ts` first. Highest issue count, broadest blast radius, and clear extraction slices around expectation scoring, report aggregation, and rendering.

# Prioritized Remediation Plan

## 1) Eval/reporting pipeline

**Files**

- `tooling/scripts/eval-reporting.ts` — 22 findings (5 critical, 8 high, 9 moderate); hotspot score 37.3.
- `packages/eval/src/retrieval-harness/report.ts` — 9 findings (3 critical, 4 high, 2 moderate).

**Why first**

- Largest aggregate count in baseline.
- Heavy mix of metric math, threshold logic, regression logic, terminal output, and HTML/CSS rendering.
- Easy to break report semantics if edited without tests.

**Likely refactor slices**

- `evaluateExpectations` (lines 461-570): isolate expectation matching and scores.
- `buildReport` (lines 727-862 / harness lines 43-183): move metric aggregation + threshold/regression handling into pure helpers.
- `printTerminalSummary` (lines 864-941): split terminal formatting from summary construction.
- `renderHtml` / `renderReportCss` (lines 943-977+): move presentation into renderer module.

**Characterization tests**

- Expectation matrix: path include/exclude, terms, diagnostics, no-results, ranked-hit bounds.
- Baseline regression: delta classification, threshold pass/fail, severity output.
- Render snapshots: terminal summary shape and HTML seed structure.

## 2) CLI orchestration + config resolution

**Files**

- `apps/cli/src/commands/shared.ts` — 9 findings (4 critical, 3 high, 2 moderate); target says `extract_complex_functions`.
- `apps/cli/src/index.ts` — 7 findings (2 critical, 4 high, 1 moderate); hotspot score 23.3.
- `apps/cli/src/commands/repo.command.ts` — 4 findings (3 critical, 1 moderate); target says `extract_complex_functions`.
- `apps/cli/src/commands/add-repo.command.ts` — 3 findings (2 critical, 1 high).
- `apps/cli/src/commands/build.command.ts` — 3 findings (2 critical, 1 high); target says `extract_complex_functions`.
- `packages/config/src/loaders/load-config.ts` — 6 findings (2 critical, 1 high, 3 moderate); hotspot score 20.1.
- `apps/cli/src/commander.ts` — 0 findings, but hotspot score 37.5 and frequent edits.

**Why next**

- One command change fans into config loading, repo targeting, artifact import, and output formatting.
- Central bootstrap plus mount layer make every CLI edit costly.

**Likely refactor slices**

- `resolveRepoConfigInput` (shared.ts lines 194-331): split local-git vs GHES branches, prompt handling, default derivation.
- `runAddRepoCommand` (add-repo.command.ts lines 217-497): split config loading, repo resolution, local/remote artifact acquisition, import/write-back.
- `runBuildCommand` / `runRepoLocalBuild` (build.command.ts lines 67-380): isolate selector parsing, target resolution, repo-local artifact generation.
- `runRepoDoctor`, `renderRepoShowLines`, `runRepoRemove` (repo.command.ts lines 71-366): break status checks, output rendering, delete path.
- `runCli`, `registerAtlasCommands`, `buildContext` (index.ts lines 40-137, 140-627, 630-740): isolate argv parsing, option normalization, command wiring.
- `loadConfig` / `resolveConfigPath` (load-config.ts lines 120-223, 481-508): keep path discovery and env merge pure and testable.

**Characterization tests**

- Non-interactive path: no prompts, explicit required flags, default derivation.
- Repo identity mismatch: explicit `--repo-id` vs resolved repo.
- Artifact error cases: missing, stale, remote ref mismatch.
- Build selectors: `--doc-id`, `--package-id`, `--module-id` mutual exclusion.
- CLI bootstrap: argv parsing, help fallback, hidden alias behavior.

## 3) Retrieval planning/ranking

**Files**

- `packages/retrieval/src/planner/plan-context.ts` — 10 findings (4 critical, 2 high, 4 moderate); hotspot score 21.9.
- `packages/retrieval/src/ranking/rank-candidates.ts` — 4 findings (1 critical, 3 moderate); target says `split_high_impact`.
- `packages/retrieval/src/planner/expand-sections.ts` — 4 findings (2 critical, 2 moderate); target says `extract_complex_functions`.
- `packages/retrieval/src/scopes/infer-scopes.ts` — 3 findings (1 critical, 2 moderate); target says `extract_complex_functions`.

**Why next**

- Core retrieval quality path. Change here changes ranking, scope, and token-budget behavior.
- `rank-candidates.ts` is a high-impact file with dependents; small edits ripple.

**Likely refactor slices**

- `planContext` and `gatherCandidates` (plan-context.ts lines 58-430): separate classification, candidate generation, and scope enrichment.
- `rankCandidates` / `queryKindWeight` / `dedupeCandidates` (rank-candidates.ts lines 10-96): move weight tables and dedupe into helpers.
- `expandSections` / `expansionPriority` (expand-sections.ts lines 21-107): split target policy from selection loop.
- `inferScopes` / `scoreLabel` / `mergeScopeCandidates` (infer-scopes.ts lines 21-192): isolate store iteration, scoring, and merge policy.

**Characterization tests**

- Query-kind matrix: overview, usage, troubleshooting, skill-invocation, exact-lookup.
- Scope precedence: repo vs package vs module vs skill.
- Expansion budget: limit, duplicate doc suppression, summary-first behavior.
- Ranking invariants: lexical vs authority vs locality vs freshness vs redundancy.

## 4) Artifact verification/import

**Files**

- `packages/indexer/src/artifact.ts` — 12 findings (4 critical, 4 high, 4 moderate).

**Why next**

- Core file/DB IO. Validation and import errors can corrupt cleanup/migration paths.
- Heavy side effects, weak tolerance for regressions.

**Likely refactor slices**

- `buildArtifactManifest` (lines 194-229): keep manifest assembly pure.
- `validateArtifactCorpusDb` (lines 691-770): split manifest parse, schema check, row-mix check, count capture.
- `verifyMoxelAtlasArtifact` (lines 796-895): separate file existence, checksum, safety, importability, freshness.
- `importArtifactCorpus` (lines 965-1115): isolate attach/copy/detach transaction.

**Characterization tests**

- Bad manifest parse/schema.
- RepoId mismatch in manifest vs corpus rows.
- Mixed repo rows in artifact DB.
- Stale revision / freshness failure.
- Checksum and safety failures.
- Import rollback on copy/attach error.

## 5) Store persistence watchlist

**Files**

- `packages/store/src/docs/doc.repository.ts` — 4 findings (3 critical, 1 high).
- `packages/store/src/manifests/manifest.repository.ts` — 4 findings (2 critical, 2 moderate).
- `packages/store/src/json.ts` — 2 findings (2 moderate).

**Why watch**

- DB row mapping and transactions. Changes here spread through build/import/query paths.
- `doc.repository.ts` and `manifest.repository.ts` are thin but critical persistence edges.

**Likely refactor slices**

- `DocRepository.upsert/replaceCanonicalDocument` and row mappers (doc.repository.ts lines 22-325).
- `ManifestRepository.upsert/recordPartialBuild/clearPartialBuild` and `mapManifestRow` (manifest.repository.ts lines 7-150).
- JSON helper paths in `packages/store/src/json.ts` before any broad cleanup.

**Characterization tests**

- Persist/restore row shape.
- Scope row mapping.
- Partial-build state round-trip.
- JSON helper invariants before edits.

## 6) Direct characterization-test targets from `health.targets`

**Files**

- `packages/indexer/src/reports/sync-report.ts` — 2 findings (2 critical); `add_test_coverage` target.
- `packages/retrieval/src/ranking/redundancy-penalty.ts` — 2 findings (2 high); `add_test_coverage` target.
- `packages/store/src/json.ts` — 2 findings (2 moderate); `add_test_coverage` target.

**Action**

- Add tests first. Then refactor.
- These are exact files baseline says are risky to edit blind.
