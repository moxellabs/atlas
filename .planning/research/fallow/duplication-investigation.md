# Duplication Investigation

## Scope

Only `dupes.clone_groups` and `dupes.clone_families` in `.planning/research/fallow/fallow-baseline.json`.

## Baseline Snapshot

- 97 clone groups.
- 62 clone families.
- Biggest hotspot: `tooling/scripts/eval-reporting.ts` mirrors `packages/eval/src/retrieval-harness/*`.
- Next biggest exact copy: `packages/eval/src/index.ts` ↔ `packages/testkit/src/eval-runner.ts`.

## Prioritized Remediation Plan

### P0 — Unify eval reporting core

**Why:** highest duplication mass. 19 clone groups, 1,743 duplicated lines, 9,082 duplicated tokens across 8 families.

**Files / ranges:**

- `packages/eval/src/retrieval-harness/report.ts` (45-165, 168-550, 552-797, 785-831)
- `packages/eval/src/retrieval-harness/types.ts` (3-174, 176-223, 242-318)
- `packages/eval/src/retrieval-harness/expectations.ts` (3-111, 114-170)
- `packages/eval/src/retrieval-harness/health.ts` (1-46)
- `packages/eval/src/retrieval-harness/dataset.ts` (6-80)
- `packages/eval/src/retrieval-harness/terminal.ts` (4-74)
- `packages/eval/src/retrieval-harness/metric-glossary.ts` (4-137)
- `packages/eval/src/retrieval-harness/baseline.ts` (5-32)
- `tooling/scripts/eval-reporting.ts` (10-55, 94-227, 229-396, 413-456, 461-569, 572-648, 650-724, 729-861, 864-940, 1762-2188, 2190-2217, 2220-2474, 2476-2544, 2534-2574)

**Safe shared abstraction:**

- One shared `eval-reporting-core` / `report-core` module for metric math, thresholds, narrative, baseline diff, expectation scoring, and formatting.
- Keep script-only HTML/CSS/terminal rendering in `tooling/scripts/eval-reporting.ts`.

**Action:**

- Make package modules single source-of-truth.
- Replace copied logic in script with imports.

### P1 — Dedup eval runner exactly

**Why:** exact copy. 1 clone group, 344 lines, 1,852 tokens.

**Files / ranges:**

- `packages/eval/src/index.ts` (1-344)
- `packages/testkit/src/eval-runner.ts` (1-344)

**Safe shared abstraction:**

- One runner module in `packages/eval`; `packages/testkit` re-exports it.

**Action:**

- Keep one source file; delete mirror copy.

### P2 — Shared test fixture for repo seed data

**Why:** 2 clone groups, 44 duplicated lines, 324 duplicated tokens.

**Files / ranges:**

- `apps/cli/src/cli.test.ts` (1634-1648, 3948-3976)
- `packages/indexer/src/indexer.test.ts` (607-621, 836-864)

**Safe shared abstraction:**

- Small origin-repo fixture helper for docs/packages/module seed data.
- Keep scenario-specific assertions local.

**Action:**

- Extract only if more cases land. Otherwise accept as test-local duplication.

### P3 — Shared server/MCP test harness

**Why:** 4 clone groups, 112 duplicated lines, 396 duplicated tokens.

**Files / ranges:**

- `apps/server/src/server.test.ts` (1243-1267, 1306-1346)
- `packages/mcp/src/mcp.test.ts` (1047-1071, 1207-1247)

**Safe shared abstraction:**

- Common transport/identity setup, close/noise assertions, server fixture builder.

**Action:**

- Extract setup only. Keep behavior assertions in each suite.

### P4 — Shared topology mapping helper

**Why:** 1 clone group, 27 duplicated lines, 157 duplicated tokens.

**Files / ranges:**

- `apps/cli/src/commands/doctor.command.ts` (119-145)
- `packages/indexer/src/services/create-indexer-services.ts` (290-316)

**Safe shared abstraction:**

- Helper for `repoCache.getStatus` topology shaping and config-to-core mapping.

### P5 — Shared recovery / source-diff plumbing

**Why:** 2 clone groups, 117 duplicated lines, 263 duplicated tokens.

**Files / ranges:**

- `packages/indexer/src/build/build-repo.ts` (201-259)
- `packages/indexer/src/sync/sync-repo.ts` (72-118)
- `apps/cli/src/runtime/dependencies.ts` (116-173)
- `apps/server/src/services/dependencies.ts` (98-135)

**Safe shared abstraction:**

- Reusable `createSourceDiffProvider`, `recoveryForRepoState`, and config-normalization helpers.

### P6 — Shared skill alias helpers

**Why:** 1 clone group, 40 duplicated lines, 257 duplicated tokens.

**Files / ranges:**

- `packages/mcp/src/tools/list-skills.tool.ts` (45-71)
- `packages/mcp/src/tools/use-skill.tool.ts` (183-222)

**Safe shared abstraction:**

- `skillSlug`, `slugify`, and `invocationAliasesForSkill` helper module.

## Suppress / Accept

- `apps/cli/src/cli.test.ts` internal clones: 9 groups, 177 lines, 524 tokens. Accept/suppress; mostly test matrix repetition.
- `packages/config/src/loaders/load-config.test.ts` internal clones: 6 groups, 150 lines, 382 tokens. Accept/suppress; fixture permutations.
- `packages/indexer/src/indexer.test.ts` internal clones: 3 groups, 29 lines, 176 tokens. Accept/suppress; tiny same-file fixture reuse.
- Tiny same-file clones in `apps/cli/src/index.ts`, `apps/cli/src/commands/build.command.ts`, `packages/indexer/src/artifact.ts`, `packages/mcp/src/mcp.test.ts`: accept.

## Bottom Line

- Fix `tooling/scripts/eval-reporting.ts` first.
- Then dedup exact eval runner copy.
- Then pull shared test fixtures/helpers only where same setup keeps repeating across files.
