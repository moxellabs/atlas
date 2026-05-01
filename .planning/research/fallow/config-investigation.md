# Code Context

## Files Retrieved

1. `package.json` (lines 6-10, 77-89) - workspace graph and publish filters. `workspaces` currently `apps/*`, `packages/*`, `tooling/*`; `files` excludes `tooling/**` from publish surface.
2. `tooling/package.json` (lines 1-18) - root tooling package. This is the package fallow warning points at.
3. `tooling/tsconfig/package.json` (lines 1-18) - nested tooling workspace package; useful to confirm workspace layout is split.
4. `tsconfig.json` (lines 1-2) - root TS config just extends `tooling/tsconfig/base.json`.
5. `eslint.config.mjs` (lines 1-29) - current lint ignores only `node_modules`, `apps/server/node_modules`, `dist`, `out`, `coverage`; no fallow config here.
6. `bunfig.toml` (lines 1-2) - Bun preload hook for `tooling/scripts/bootstrap.ts`.
7. `tooling/scripts/verify.ts` (lines 12-25) - shell-invokes `bun tooling/scripts/public-artifact-guard.ts` and `bun tooling/scripts/distribution-smoke.ts`.
8. `tooling/scripts/build-package.ts` (lines 5-10, 17-33) - Bun.build entrypoints include `apps/cli/src/commander.ts`; this explains why source file looks unused to fallow.
9. `tooling/scripts/bootstrap.ts` (line 1) - preload stub; no imports, runtime-loaded by Bun only.
10. `tooling/eslint/base.cjs` (lines 1-7) - config file loaded by tooling, not by import graph.
11. `apps/cli/src/commander.ts` (lines 1-120) - standalone bundle entry used by package build, not imported in repo graph.
12. `packages/source-ghes/src/api/contents.ts` (lines 1-101) - orphan GHES contents helper; no call sites found.
13. `packages/core/src/ids/index.ts` (lines 1-12), `packages/core/src/types/index.ts` (lines 1-48), `packages/core/src/utils/index.ts` (lines 1-3) - barrel modules with no imports.
14. `packages/config/src/atlas-config.schema.ts` (lines 177-233) - self-referential schema exports that still trip unused-export noise.
15. `packages/eval/src/retrieval-harness/render/html.ts` (lines 1-40) and `packages/eval/src/retrieval-harness/types.ts` (lines 1-120) - unresolved import boundary / type graph risk.
16. `apps/server/src/services/dependencies.ts` (lines 1-137) and `apps/server/src/routes/repos.route.ts` (lines 14-80) - representative DI + route path for class-member bucket.
17. `.planning/research/fallow/fallow-baseline.json` (lines 1-34) - current baseline summary: 196 issues, 51 unused files, 58 unused exports, 21 unused types, 9 unused deps, 57 unused class members, 0 unresolved imports.

## Key Code

### Root workspace / publish surface

```json
"workspaces": ["apps/*", "packages/*", "tooling/*"]
```

`tooling/package.json` sits at `tooling/package.json`, so fallow can still warn about it if it wants explicit `tooling` root workspace coverage.

### Bun implicit entry

```toml
# bunfig.toml
preload = ["./tooling/scripts/bootstrap.ts"]
```

Fallow does not learn this preload from import graph; needs config help.

### Script entry hidden behind shell command

```ts
await run(
  "public artifact guard",
  $`bun tooling/scripts/public-artifact-guard.ts`,
);
```

This is runtime execution, not static import.

### Build entry hidden behind Bun.build

```ts
const bundles = [
  { entry: "apps/cli/src/index.ts", output: "dist/atlas.js", name: "atlas" },
  {
    entry: "apps/cli/src/commander.ts",
    output: "dist/commander.js",
    name: "commander",
  },
] as const;
```

`apps/cli/src/commander.ts` is real bundle entry even though repo graph never imports it.

### Unresolved cross-layer import

```ts
import { moxelBandedFieldScript } from "../../../../apps/server/src/openapi/moxel-theme";
```

`packages/eval` reaches into `apps/server`; fallow reports unresolved import here.

## Architecture

Repo uses Bun workspaces + Bun entrypoints, not one flat TS import graph.

- Root `package.json` defines workspace packages.
- `bunfig.toml` injects preload code before app start.
- `tooling/scripts/verify.ts` launches other scripts through shell strings.
- `tooling/scripts/build-package.ts` bundles source files into `dist/` and `bin/`.
- Fallow only sees static imports plus package.json entrypoints unless config teaches it about preload scripts, generated bundle entry files, and runtime-loaded config assets.

Current fallow signal splits into 3 buckets:

1. **False positives / config-only**: test files, Bun preload, shell-invoked guard script, ESLint config, build entry `commander.ts`.
2. **Real dead surface**: core barrel files, GHES contents helper, some unused exports/types, unused devDeps.
3. **Real graph bug**: `packages/eval/src/retrieval-harness/render/html.ts` imports from `apps/server`.

I validated a narrow temp config (`entry` + `dynamicallyLoaded` + test ignore patterns + `ignoreExportsUsedInFile`) drops unused-files from 41 to 4 and unused-exports from 52 to 19. So config can kill obvious noise, but cannot get repo green alone.

## Start Here

Open `package.json` first. Fix workspace boundary + config knobs there drive most fallow noise and the `tooling` workspace warning.

## Remediation Plan

### 1) Add fallow config file

Create root `.fallowrc.jsonc`.

Use narrow knobs:

- `entry`: `apps/cli/src/commander.ts`, `tooling/scripts/public-artifact-guard.ts`
- `dynamicallyLoaded`: `tooling/scripts/bootstrap.ts`, `tooling/eslint/base.cjs`
- `ignorePatterns`: `**/*.test.ts`, `**/*.test-helpers.ts`, `**/*.spec.ts`
- keep `ignoreExportsUsedInFile: true` only if team accepts self-used export suppression across repo

Why:

- kills test/helper false positives
- covers Bun preload and shell-invoked scripts
- covers bundle entry used by `build-package.ts`

Risk:

- `ignoreExportsUsedInFile` is repo-wide. Good for schema/helper files, but can hide real dead exports if abused. Use only after manual review.

### 2) Fix workspace warning

Update root `package.json` `workspaces` to include explicit `"tooling"` root package, not just `tooling/*`.

Why:

- root `tooling/package.json` is separate workspace root.
- removes warning about tooling package not being declared workspace.

Risk:

- low. Only changes package discovery.

### 3) Delete or wire real dead files

Current non-config unused files after narrow config:

- `packages/core/src/ids/index.ts`
- `packages/core/src/types/index.ts`
- `packages/core/src/utils/index.ts`
- `packages/source-ghes/src/api/contents.ts`

Plan:

- delete barrel files if no consumer exists, or import them from `packages/core/src/index.ts` if they are intended API
- either wire `api/contents.ts` into GHES adapter or delete it

Risk:

- deleting barrels can break future subpath imports if any external code relied on them. Search repo + package exports first.

### 4) Remove unused dev dependencies

Static grep says these are unused in source trees:

- `apps/cli/package.json`: `@clack/core`, `yaml`
- `apps/server/package.json`: `@elysiajs/eden`
- `packages/compiler/package.json`: `shiki`
- `packages/retrieval/package.json`: `zod`
- `packages/source-ghes/package.json`: `zod`
- `packages/source-git/package.json`: `fast-glob`
- `packages/topology/package.json`: `fast-glob`, `zod`

Risk:

- low if grep stays clean. If hidden dynamic use exists, promote dep or document the runtime loader instead of keeping it in devDeps.

### 5) Fix unresolved import in eval harness

`packages/eval/src/retrieval-harness/render/html.ts` imports server theme from `apps/server/src/openapi/moxel-theme`.

Plan:

- move shared `moxelBandedFieldScript` to shared eval/server-neutral module, or duplicate minimal script in eval package
- avoid package-to-app import from `packages/eval`

Risk:

- medium. This is architecture smell, not just fallow noise.

### 6) Remaining export/type/class-member noise

After narrow config, still left:

- 19 unused exports
- 15 unused types
- 75 unused class members

Do **not** solve this bucket with global `usedClassMembers`.

Reason:

- class-member suppression is too blunt for repo-wide service/repository APIs
- would hide real dead methods across many classes

Better split:

- remove dead exports/types in obvious dead modules first (`apps/server/src/constants.ts`, `apps/server/src/errors.ts`, `apps/server/src/openapi/moxel-theme.ts`, `packages/core/src/enums/index.ts`, `packages/mcp/src/types.ts`, `packages/source-ghes/src/api/commits.ts`, `tooling/scripts/eval-reporting.ts`, etc.)
- then reassess class-member bucket per class, not globally

## Risks / Open Questions

1. `tooling` workspace warning: if fallow still complains after adding explicit root workspace, then its workspace discovery is diverging from Bun’s. Capture exact warning text before changing more.
2. `ignoreExportsUsedInFile` helps schema/helper files, but can mask real dead exports. Keep only if total noise stays high.
3. Class-member bucket likely mixes real dead methods and false positives from DI/service style. No safe global config ignore.
4. `packages/eval/src/retrieval-harness/report.ts` currently imports `HealthLevel` / `HealthMetric` from `./types`, but `types.ts` only imports those from `./health` and does not re-export them. Separate typecheck blocker; not a fallow issue, but it can bite cleanup work in eval harness.
5. `.fallow` dir in repo is cache-only right now (`cache.bin`, `churn.bin`); no checked-in config exists.
