# Contributing to Atlas

Thanks for helping improve Atlas. Atlas is local-first: public contributions must preserve credential safety, local corpus boundaries, and maintainer-controlled publishing workflows.

## Setup

```bash
bun install
```

## Validate changes

Run relevant focused tests first, then full CI-equivalent checks before opening a PR:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run smoke:distribution
bun run release:check
bun apps/cli/src/index.ts artifact verify --fresh
```

The public artifact freshness check may fail after public docs or public skills change. Rebuild `.moxel/atlas` with `bun apps/cli/src/index.ts build --profile public`, then rerun freshness verification.

Use Bun commands. Do not use npm, yarn, pnpm, ts-node, webpack, or vite for project workflows.

## Releases

Maintainers handle releases separately from contributor pull requests. Contributor changes should focus on validation, tests, docs, and artifact safety; maintainers own package publishing.

## Public artifact workflow

Atlas commits a public self-indexed artifact at `.moxel/atlas`. Rebuild it only when public docs or public skills change:

```bash
bun apps/cli/src/index.ts build --profile public
bun apps/cli/src/index.ts artifact verify --fresh
git add .moxel/atlas
```

Public artifacts must not include `.planning/**`, `docs/archive/**`, credentials, proprietary docs, machine-local absolute paths, or private host details.

## Pull request expectations

- Keep changes scoped and explain user impact.
- Include tests or docs when behavior changes.
- Run validation commands above and paste results, not secrets.
- Update `.moxel/atlas` only for public docs/skills changes.
- Do not commit local runtime state, logs, caches, tokens, private hostnames, or proprietary documentation.
- Respect existing local-first and no-remote-query-time guarantees.

## Security and secrets

Never add real tokens, passwords, private keys, private hostnames, proprietary docs, or customer data to code, docs, tests, fixtures, issue templates, or PR descriptions. Use placeholders such as `<token>` or `ATLAS_TOKEN_ENV_VAR`.

Report vulnerabilities privately using `SECURITY.md`; do not open public security issues.

## License and branding

Contributions are accepted under AGPL-3.0-or-later. See `LICENSE`.

Moxel, Moxel Labs, Atlas project branding, and related logos are trademarks or brand assets. Code license does not grant trademark rights. Forks must not imply official affiliation or endorsement.
