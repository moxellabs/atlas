# Fallow Dead-Code Investigation

Scope: `check.unused_files`, `check.unused_exports`, `check.unused_types`, `check.unused_class_members`, `unused_dev_dependencies` only.
Baseline: 196 findings total (`51 + 58 + 21 + 57 + 9`).

## Priority 1 — Safe removals now

### 1) Delete dead files / dead barrels

Low blast radius. No repo refs, no package export surface.

- `packages/source-ghes/src/api/contents.ts` — 1 `unused_file`
- `packages/core/src/ids/index.ts` — 1 `unused_file`
- `packages/core/src/types/index.ts` — 1 `unused_file`
- `packages/core/src/utils/index.ts` — 1 `unused_file`
- `packages/core/src/enums/index.ts` — 9 export/type findings; redundant barrel, package root already exports same enums directly
- `tooling/eslint/base.cjs` — 1 `unused_file`; legacy config unused because repo uses `eslint.config.mjs`

### 2) Drop internal-only exports from non-public modules

These are only used inside same file or not used anywhere in repo.

- `apps/cli/src/commands/add-repo.command.ts` — 2 exports (`findLocalCheckoutArtifact`, `copyLocalArtifactToRepoStorage`)
- `apps/cli/src/commands/artifact.command.ts` — 2 exports (`CLI_ARTIFACT_VERIFY_FAILED`, `CLI_ARTIFACT_FRESH_REF_UNAVAILABLE`)
- `apps/cli/src/commands/next.command.ts` — 1 export (`probeNextStepState`)
- `apps/cli/src/commands/repo-resolver.ts` — 1 export (`parseRepoInput`)
- `apps/cli/src/commands/shared.ts` — 1 export (`repoRows`)
- `apps/cli/src/runtime/dependencies.ts` — 4 exports (`createSourceDiffProvider`, `repoInternalRoot`, `repoArtifactStorageDir`, `repoTmpDir`)
- `apps/cli/src/utils/errors.ts` — 2 exports (`EXIT_RUNTIME_ERROR`, `toCliError`)
- `apps/cli/src/utils/topology-templates.ts` — 1 export (`listTopologyTemplates`)
- `apps/server/src/constants.ts` — 3 exports (`APP_ID`, `API_PREFIX`, `MCP_ROUTE`)
- `apps/server/src/errors.ts` — 1 export (`ServerUnsupportedOperationError`)
- `apps/server/src/openapi/moxel-theme.ts` — 1 export (`MOXEL_SCALAR_THEME_MARKER`)
- `apps/server/src/routes/route-utils.ts` — 1 export (`MAX_JSON_BODY_BYTES`)
- `apps/server/src/schemas/common.schema.ts` — 1 export (`booleanQuerySchema`)
- `apps/server/src/services/dependencies.ts` — 1 type export (`AtlasStoreClient`)
- `packages/mcp/src/resources/manifest.resource.ts` — 1 export (`MANIFEST_AGENT_GUIDANCE`)
- `packages/mcp/src/types.ts` — 1 type export (`InferSchema`)
- `packages/source-ghes/src/api/commits.ts` — 1 type export (`GhesCompareResponse`)

### 3) Remove unused devDependencies

Straight manifest cleanup, no code changes needed.

- `apps/cli/package.json` — `@clack/core` (1), `yaml` (1)
- `apps/server/package.json` — `@elysiajs/eden` (1)
- `packages/compiler/package.json` — `shiki` (1)
- `packages/source-git/package.json` — `fast-glob` (1)
- `packages/topology/package.json` — `fast-glob` (1)

## Priority 2 — Likely false positives, keep

### 1) Test files / Bun discovery

31 `.test.ts` files are flagged as `unused_files`, but repo runs `bun test` and Bun auto-discovers them.
Examples:

- `apps/cli/src/cli.test.ts`
- `apps/server/src/server.test.ts`
- `packages/indexer/src/indexer.test.ts`
- `packages/store/src/store.test.ts`
- `tooling/scripts/eval-reporting.test.ts`

Also keep `apps/cli/src/cli.test-helpers.ts`; it is imported by `apps/cli/src/cli.test.ts`.

### 2) Entrypoints / scripts referenced outside static import graph

- `apps/cli/src/commander.ts` — used by `tooling/scripts/build-package.ts` and distribution smoke checks
- `tooling/scripts/bootstrap.ts` — loaded by `bunfig.toml` preload
- `tooling/scripts/public-artifact-guard.ts` — invoked from `tooling/scripts/verify.ts`
- `packages/eval/src/retrieval-harness/*` — public eval surface re-exported through `packages/eval/src/index.ts`; analyzer misses export-chain usage

### 3) Class-member findings that are used through route/service composition

No clear deletions yet. Examples:

- `apps/server/src/services/store-read.service.ts` — 8 members used by route handlers
- `packages/store/src/skills/skill.repository.ts` — 6 members used by indexer/MCP/store tests
- `apps/cli/src/io/console.ts` — 5 members used by CLI command helpers
- `packages/topology/src/adapters/module-local-docs.adapter.ts` — 5 members used by adapter selection
- `packages/topology/src/adapters/package-top-level.adapter.ts` — 5 members used by adapter selection
- `apps/server/src/services/retrieval-http.service.ts` — 3 members used by routes
- `apps/server/src/services/build-operations.service.ts` — 2 members used by routes
- `packages/store/src/docs/*.ts`, `packages/store/src/repos/*.ts` — used by indexer/retrieval/MCP code paths

## Priority 3 — Needs tests/docs/consumer review before pruning

These look public or externally consumed, so deleting/removing export surfaces needs API/docs/test updates first.

- `packages/config/src/atlas-config.schema.ts` — 5 unused export symbols, 3 unused type exports; package root re-exports them
- `apps/server/src/schemas/context.schema.ts` — 1 unused type export, but route code imports it via `import("...")` type query
- `apps/server/src/schemas/docs.schema.ts` — 1 unused type export; same pattern
- `apps/server/src/schemas/repo.schema.ts` — 3 unused type exports; same pattern
- `apps/server/src/schemas/search.schema.ts` — 2 unused type exports; same pattern
- `apps/server/src/schemas/sync.schema.ts` — 2 unused type exports; same pattern
- `packages/eval/src/retrieval-harness/health.ts` — 6 unused exports, but package root exports them and html/report code uses them
- `packages/eval/src/retrieval-harness/types.ts` — 5 unused type exports, part of eval package API
- `packages/eval/src/retrieval-harness/metric-glossary.ts` — 1 unused export, part of eval package API
- `packages/source-ghes/src/client/ghes-client.ts` — 1 unused class member (`baseUrl` getter); public API change if removed
- `packages/config/src/loaders/load-env.ts` — 1 unused class member (`code`); public error surface if removed

## Blocker note

Unrelated type-check cascade still present in eval harness:

- `packages/eval/src/retrieval-harness/report.ts` imports `HealthLevel` / `HealthMetric` from `./types`, but `packages/eval/src/retrieval-harness/types.ts` only imports them from `./health` and does not re-export them.

## Suggested order

1. Delete dead files/barrels + trim safe internal exports.
2. Remove 6 obvious unused devDeps.
3. Suppress or ignore test/script/public-API false positives.
4. Do public API prune only with tests/docs/consumer sweep.
