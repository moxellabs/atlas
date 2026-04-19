---
status: passed
phase: 32-ci-validation
requirements: [OSS-CI]
verified: 2026-04-28T08:48:00Z
---

# Phase 32 Verification: CI validation

## Result

Passed. Atlas now has public pull-request and push CI using Bun, tests, distribution smoke, release dry-run, and public artifact freshness without secrets.

## Must-haves

| Requirement                               | Status | Evidence                                                                                                    |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --- | -------------------------- |
| CI has no `NPM_TOKEN` or registry auth.   | Passed | `rg -n "NPM_TOKEN                                                                                           | publish" .github/workflows/ci.yml && exit 1 |     | true` returned no matches. |
| CI does not call publish.                 | Passed | Workflow runs release dry-run only via `bun run release:check`; no publish command present.                 |
| CI validates `.moxel/atlas` freshness.    | Passed | Workflow runs `bun apps/cli/src/index.ts artifact verify --fresh`; local command passed with `fresh: true`. |
| CI commands match local contributor docs. | Passed | README and CONTRIBUTING list same install/typecheck/lint/test/smoke/release/artifact commands.              |
| CI runs on push and pull_request.         | Passed | Workflow parsed and includes `push` and `pull_request` triggers.                                            |
| CI requires no secrets.                   | Passed | Workflow only grants `contents: read`; no secrets or tokens referenced.                                     |

## Automated Checks

Passed:

```bash
bun run typecheck
bun run lint
bun test
bun run smoke:distribution
bun run release:check
bun apps/cli/src/index.ts artifact verify --fresh
```

Additional checks:

```bash
rg -n "NPM_TOKEN|publish" .github/workflows/ci.yml && exit 1 || true
python - <<'PY'
import yaml
with open('.github/workflows/ci.yml') as f:
    data = yaml.safe_load(f)
assert data['name'] == 'CI'
assert 'push' in data[True] and 'pull_request' in data[True]
print('workflow yaml parsed')
PY
```

## Notes

Optional `bunx actionlint .github/workflows/ci.yml` was attempted but unavailable in this environment: `error: could not determine executable to run for package actionlint`. YAML parse and workflow content validation were performed inline instead.
