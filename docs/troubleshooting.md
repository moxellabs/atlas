---
title: Troubleshooting
description: Debug Atlas build, sync, artifact, and runtime failures.
audience: [consumer, maintainer]
purpose: [guide, reference]
visibility: public
order: 90
---

# Troubleshooting

## `CLI_BUILD_FAILED` or `IndexerBuildError`

`inspect topology --live` can succeed while `build` still fails. Topology inspection proves Atlas can discover packages, modules, docs, and skills; build also reads document content, compiles metadata, chunks text, summarizes docs, and persists corpus records.

When build fails:

```bash
bunx @moxellabs/atlas inspect topology --live --repo <repo-id> --config <config>
bunx @moxellabs/atlas build --json --verbose --repo <repo-id> --config <config>
```

If running inside the configured checkout, omit `--repo`; Atlas can infer it from repo metadata, the configured `localPath`, or Git origin. If multiple configured repos share the same final name, pass the full canonical ID.

Use JSON output first. Inspect:

- `error.code` for `CLI_BUILD_FAILED`.
- `error.details.diagnostics[]` for build diagnostics.
- `diagnostics[].stage` for failing phase such as `source`, `planning`, `compile`, `chunk`, `persistence`, or `build`.
- `diagnostics[].path` or `diagnostics[].details.entity` for failing doc/entity path.
- `diagnostics[].cause` for nested `IndexerBuildError`, compiler, tokenizer, store, or source failures.
- `docsConsidered`, `docsRebuilt`, and `manifestUpdated` to confirm whether failure happened after topology discovery and before persistence.
- `diagnostics[].cause.cause` recursively for original root cause.

Non-verbose JSON omits stack traces. Add `--verbose` when reporting a bug so stack fields appear in structured cause objects.

Common stage meanings:

- `config`: CLI/config loading or repo configuration failed before source access.
- `registry`: repo folder metadata under the runtime repo registry is missing or inconsistent.
- `source`: Git/GHES checkout, fetch, tree, diff, or blob read failed. Check repo ref, auth, and network/API access. For `local-git` remote mode, Atlas runs `git fetch origin <ref>`; local-only branches fail until pushed or configured with `refMode: current-checkout`.
- `planning`: topology or targeted selector planning failed before document content compilation. Check repo ID, package/module/doc selector, and topology rules.
- `compile`: Atlas read a selected Markdown/skill doc and failed parsing or normalization. Check `path` and nested cause for malformed frontmatter or invalid document metadata.
- `chunk`: document text was compiled but tokenization/chunk splitting failed. Share tokenizer error names and budget settings.
- `persistence`: compiled artifacts could not be written transactionally to SQLite. Check disk permissions, database path, lock errors, and store cause chain.
- `build`: outer build orchestration failed before a narrower stage could classify it. Use nested cause to find the lower-level operation.

Generated/vendor directories such as `.moxel`, `.atlas`, `node_modules`, `dist`, `coverage`, and `target` are ignored by live topology and build source listing. If a failing path appears under those roots, run the current Atlas build and share the exact path because that indicates an ignore-boundary regression.

## `GIT_REF_RESOLUTION_FAILED` for `local-git`

Message like `Remote ref <name> was not found on origin` means Atlas used `local-git` remote mode. Remote mode is explicit: Atlas tries `git fetch origin <ref>` and detaches `FETCH_HEAD`. It does not read your current working tree branch.

Fix choices:

- Push/create the branch or tag on `origin`, then keep `refMode: remote`.
- For local-only branches, detached HEAD, or unpushed work, set `refMode: current-checkout` and point `localPath` at the checkout.
- For repo-local artifact publishing, rerun `atlas init` or use `atlas init --ref-mode current-checkout`; `atlas build` will read current checkout `HEAD`.

Semantics:

- `ref: main` + `refMode: remote`: fetches `origin main` and checks out `FETCH_HEAD`.
- `ref: HEAD` + `refMode: remote`: still goes through remote ref resolution.
- `ref: HEAD` + `refMode: current-checkout`: resolves local `HEAD`, including detached HEAD.
- `ref: local-branch` + `refMode: current-checkout`: records label `local-branch` but revision comes from current checkout `HEAD`.

Share these fields in bug reports:

- Atlas version and command.
- `repoId`, build `strategy`, `reasonCode`, and failing `stage`.
- Failing `path` / `entity` if present.
- Nested `cause.name`, `cause.message`, and `cause.code` chain.
- Redacted stack trace from `--json --verbose` if needed.

Redact before sharing:

- access tokens, API keys, cookies, and authorization headers;
- private repository URLs if sensitive;
- proprietary document content excerpts not needed for diagnosis.

Atlas redacts token-like context values in build diagnostic causes, but review output before posting externally.

## State layer checks versus builds

`atlas doctor` checks runtime config, SQLite DB access, local-git cache paths, server environment, and source credentials. `atlas repo doctor` checks one repo's config entry, registry metadata, store rows, manifest row, and artifact metadata. Neither command compiles docs or proves `atlas build` will pass.

Use this sequence when state looks healthy but build fails:

```bash
atlas doctor --config <config>
atlas repo doctor <repo-or-bare-name> --config <config>
atlas build --json --verbose --repo <repo-or-bare-name> --config <config>
```

Human output labels layers such as `runtime-config`, `db`, `local-git-cache`, `config`, `registry`, `store`, and `artifact-metadata`. JSON check objects include the same `layer` field and `nextAction` when Atlas knows a recovery command.

## Repo target errors

Repo-targeting commands check, in order, explicit flags, positional repo argument, repo-local metadata, configured checkout paths from cwd, Git origin, and config fallbacks. Missing-target errors list what was checked. Ambiguous bare names list candidate canonical IDs and require `--repo host/owner/name` in JSON/non-interactive mode; interactive human mode can show a chooser.
## Production onboarding release gate

Before release, run the scripted production UAT:

```bash
bun run uat:production
```

This gate uses only temporary local fixtures and no external network. It blocks release if any of these production usability contracts regress:

- Top-level help shows command order: `setup`, `repo add`, `init && build`, fallback `index <path>`, and `next`.
- `atlas setup --help` does not surface wrapper-only branding, namespace, logo/color, MCP title, or resource-prefix setup knobs.
- `atlas next --json` recommends `atlas setup` before runtime config exists and `atlas repo add <repo>` after setup.
- `atlas repo add <local-checkout>` delegates to the same implementation as `add-repo` and infers `github.com/owner/name` from Git origin without manual GitHub host setup.
- `atlas init --ref-mode current-checkout` works from a local-only branch and records current-checkout semantics.
- `inspect topology --live --json` succeeds in the local-only checkout and discovers docs.
- A production-shaped build failure returns `CLI_BUILD_FAILED` with `diagnostics[].path` and nested `diagnostics[].cause` in `--json --verbose` output.
- `atlas doctor --json` reports state-layer fields so operators can distinguish config, registry, store, cache, and build checks.

When filing production build bugs, include these redacted commands/output:

```bash
atlas next --json --config <config>
atlas doctor --json --config <config>
atlas repo doctor <repo-or-bare-name> --json --config <config>
atlas inspect topology --live --json --cwd <checkout> --config <config>
atlas build --json --verbose --cwd <checkout> --config <config>
```

Do not include tokens, cookies, proprietary document content, or private URLs unless necessary and approved for sharing.
