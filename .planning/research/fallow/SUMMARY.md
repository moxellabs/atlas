# Fallow Cleanup Research Summary

**Generated:** 2026-05-01
**Baseline command:** `bunx fallow --format json --no-cache`
**Baseline artifact:** `.planning/research/fallow/fallow-baseline.json`

## Baseline Counts

| Category                   | Count |
| -------------------------- | ----- |
| Unused files               | 51    |
| Unused exports             | 58    |
| Unused types               | 21    |
| Unused class members       | 57    |
| Unused dev dependencies    | 9     |
| Duplication clone groups   | 97    |
| Duplication clone families | 62    |
| Health findings            | 369   |
| Health hotspots            | 29    |
| Large functions            | 130   |

## Key Findings

### Stack/config additions

- Add root `.fallowrc.jsonc` with narrow entrypoint/dynamic-load/test patterns.
- Include explicit `tooling` workspace if Fallow still warns that `tooling/package.json` is outside workspaces.
- Avoid broad class-member suppressions; they can hide real dead service/repository API drift.

### Table stakes

- Fallow must understand Bun-specific entrypoints: `bunfig.toml` preload, shell-invoked scripts, test discovery, and Bun.build bundle entries.
- Dead files and dependencies should be removed before large refactors.
- Public package/API surfaces need review before export removal.
- `bunx fallow` zero issues is milestone completion gate.

### Watch out for

- `tooling/scripts/eval-reporting.ts` duplicates large chunks of `packages/eval/src/retrieval-harness/*` and is biggest duplication/complexity target.
- `packages/eval/src/index.ts` and `packages/testkit/src/eval-runner.ts` appear to be exact runner copies.
- `packages/eval/src/retrieval-harness/render/html.ts` imports theme code from `apps/server`, an app-to-package boundary smell.
- Some test/script/public API findings are false positives unless Fallow config knows project-specific entrypoints.
- Current working tree has unrelated pre-existing dirty code/docs; planning commits should include only `.planning/**` files unless user approves broader commit.

## Parallel Investigation Outputs

- Dead code: `.planning/research/fallow/dead-code-investigation.md`
- Duplication: `.planning/research/fallow/duplication-investigation.md`
- Health: `.planning/research/fallow/health-investigation.md`
- Config: `.planning/research/fallow/config-investigation.md`
