---
phase: 42
title: Post-release Bug Hunt Remediation
created: 2026-04-29
source: parallel bughunt after v0.1.3 release
status: planned
---

# Phase 42 Context: Post-release Bug Hunt Remediation

## Background

After releasing `@moxellabs/atlas@0.1.3`, user requested parallel agents across the codebase to find bugs. Codex dispatch agents failed/ignored prompts; Pi agents produced usable read-only audits across CLI, store/indexer, source/config, and server/release surfaces.

This phase captures actionable follow-up work. It should be executed before the next patch release.

## Recent Release Context

- `v0.1.2` shipped production onboarding improvements but had regressions:
  - Enterprise host detection asked for manual `atlas hosts add` instead of auto-configuring during `init`.
  - Setup-generated config was not consistently discovered without `--config` / `ATLAS_CONFIG`.
  - Packaged Node build hit SQLite `cannot start a transaction within a transaction`.
- `v0.1.3` fixed those and added regression tests.
- Current head after release:
  - `f4a50cba fix: repair setup and build regressions`
  - npm `@moxellabs/atlas@0.1.3`
  - GitHub release `v0.1.3`

## Parallel Bug Hunt Sessions

Useful Pi sessions:

- `bughunt-cli-pi`: CLI onboarding/config/command audit.
- `bughunt-store-indexer-pi`: store/indexer persistence audit.
- `bughunt-source-config-pi`: source adapters/host/config audit.
- `bughunt-server-release-pi`: server/MCP/retrieval/release audit.

Discarded sessions:

- `bughunt-cli`, `bughunt-store-indexer`, `bughunt-source-config`, `bughunt-server-release` used Codex and produced unusable/irrelevant output.

## Findings to Address

### P1/P2: `serve` ignores CLI runtime env

**Files:**

- `apps/cli/src/commands/serve.command.ts`
- `apps/cli/src/runtime/dependencies.ts`

**Finding:**

`runServeCommand()` calls `buildCliDependencies({ cwd, configPath })` but omits `env: context.env`.

Current shape:

```ts
const deps = await buildCliDependencies({
  cwd: context.cwd,
  ...(configPath === undefined ? {} : { configPath }),
});
```

**Impact:**

`atlas serve` can ignore runtime env supplied through CLI harness, including:

- `HOME` used for setup-generated config discovery.
- `ATLAS_CONFIG`.
- `ATLAS_IDENTITY_ROOT`.
- `ATLAS_CACHE_DIR`.
- GHES auth tokens.

This is same bug class as the v0.1.2 config-discovery production regression.

**Expected fix direction:**

Pass `env: context.env` into `buildCliDependencies()` and add a focused test proving `serve` discovers setup-generated config under temp `HOME` without `--config`.

### P2: Mounted Commander MCP `resourcePrefix` is accepted but ignored

**Files:**

- `apps/cli/src/commander.ts`
- `apps/cli/src/index.ts`
- `packages/config/src/white-label/profile.ts`
- `apps/cli/src/commands/mcp.command.ts`

**Finding:**

`AtlasMountConfig.mcp.resourcePrefix` is exposed and validated, but `mountDefaults()` does not store or plumb it anywhere.

Current behavior:

```ts
if (config.mcp?.resourcePrefix !== undefined) {
  validateMcpIdentifier(
    config.mcp.resourcePrefix,
    "identity.mcp.resourcePrefix",
  );
}
```

There is no `ATLAS_MCP_RESOURCE_PREFIX` runtime default and no config override path for mount defaults.

**Impact:**

Enterprise wrapper can call:

```ts
createAtlasCommand({
  namespace: "acme",
  mcp: {
    name: "acme-knowledge",
    title: "Acme Knowledge",
    resourcePrefix: "acme",
  },
});
```

Validation passes, but mounted MCP aliases/resources still use config/default resource prefix unless config file separately sets `identity.mcp.resourcePrefix`.

**Expected fix direction:**

Either:

1. Fully plumb a mount default for resource prefix into MCP identity resolution, or
2. Remove/reject the field as unsupported.

Preferred: support it, because docs and public type already advertise it.

### P2: MCP public barrel missing first-party skill/use-skill exports

**Files:**

- `packages/mcp/src/index.ts`
- `packages/mcp/src/tools/use-skill.tool.ts`
- `packages/mcp/src/resources/skill-artifact.resource.ts`
- `packages/mcp/src/schemas/tool-schemas.ts`

**Finding:**

`packages/mcp/src/index.ts` does not export first-party skill tool/resource symbols that are registered internally.

Missing expected exports:

- `USE_SKILL_TOOL`
- `executeUseSkill`
- `registerUseSkillTool`
- `useSkillInputSchema`
- `UseSkillInput`
- `skillArtifactResource`

**Impact:**

SDK/package consumers cannot import full first-party skill MCP surface from `@atlas/mcp`, despite server registration supporting it.

**Expected fix direction:**

Add barrel exports and package-level tests asserting these symbols exist.

### P2/P3: Commander positional args duplicated in command context

**File:**

- `apps/cli/src/index.ts`

**Finding:**

`emitCommandResult()` builds `positionals` from both Commander action values and `command.args`:

```ts
const positionals = [
  ...(values.filter((value) => typeof value === "string") as string[]),
  ...command.args,
];
```

Commander already passes declared positional args in `values`; `command.args` also includes them. Example: `add-repo foo` can produce `context.argv` like `['foo', 'foo', ...opts]`.

**Impact:**

Mostly hidden today because commands often read first positional, but `context.args.arg1` and future commands can be wrong.

**Expected fix direction:**

Use either action string values or `command.args`, not both. Preserve excess-argument behavior intentionally.

### P2/P3: `repo remove` bypasses repo target resolver

**File:**

- `apps/cli/src/commands/repo.command.ts`

**Finding:**

`runRepoRemove()` uses raw `context.argv[1]` instead of `resolveRepoTarget()`.

Current behavior:

```ts
const repoId = context.argv[1];
```

**Impact:**

- `atlas repo remove my-repo --yes` cannot resolve unique bare repo name.
- Canonical validation is inconsistent with `repo show`, `repo doctor`, `build`, and `init`.
- Typos can produce misleading output like removed repo with no config entry removed.

**Expected fix direction:**

Use shared repo target resolver with explicit/positional handling. Fail unknown targets unless dry-run/no-op semantics are intentionally documented.

### P3: Current-checkout mode with sparse user checkout can silently omit docs

**Files:**

- `packages/source-git/src/cache/repo-cache.service.ts`
- `packages/source-git/src/adapters/local-git-source.adapter.test.ts`

**Finding:**

For `refMode: "current-checkout"`, `RepoCacheService` returns:

```ts
const sparseCheckout = { enabled: false, patterns: [] };
event("sparse_checkout_disabled", ...);
```

It does not inspect whether the user's actual working tree is sparse.

**Impact:**

If user checkout is sparse, docs outside materialized paths are absent from build while diagnostics say sparse checkout disabled. This can create incomplete artifacts and confusing diagnostics.

**Expected fix direction:**

Detect sparse checkout in current-checkout mode and either:

- emit explicit `current_checkout_sparse_detected` warning, or
- refuse build unless user opts in, or
- document and surface omitted-doc risk clearly.

### P3: `SectionRepository.deleteForDocument()` leaves FTS rows stale

**Files:**

- `packages/store/src/docs/section.repository.ts`
- `packages/store/src/search/fts.ts`
- `packages/store/src/store.test.ts`

**Finding:**

`SectionRepository.deleteForDocument()` deletes chunks and sections, but does not delete associated `fts_entries`.

Main persistence path often reindexes later, so normal builds may not hit this. Direct repository API can leave stale section/chunk search rows.

**Expected fix direction:**

Either delete section/chunk FTS rows in `deleteForDocument()` or explicitly mark API structural-only and avoid using it where stale FTS matters. Preferred: clean FTS rows.

### P3: `@atlas/store` Node fallback depends on root dependency

**Files:**

- `packages/store/src/db/client.ts`
- `packages/store/package.json`
- `package.json`

**Finding:**

`packages/store/src/db/client.ts` requires `better-sqlite3` in Node runtime. Root package declares `better-sqlite3`, but `packages/store/package.json` does not.

**Impact:**

Published CLI bundle/root package likely OK. Isolated `@atlas/store` consumption under Node may fail with `Cannot find module 'better-sqlite3'`. Since `@atlas/store` is currently private, lower urgency.

**Expected fix direction:**

Decide package boundary:

- If package remains private forever, no code change needed; document assumption.
- If package can be consumed independently, declare dependency/peer or improve error.

## Verification Baseline

Before phase execution, current release validation was green:

- `bun run typecheck`
- `bun run lint`
- `bun test` → 276 pass, 0 fail
- `bun run uat:production`
- `bun tooling/scripts/release.ts --dry-run --tag=v0.1.3`

Phase 42 changes must keep these green.
