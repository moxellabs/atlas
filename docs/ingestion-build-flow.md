---
title: Ingestion And Build Flow
description: Understand Atlas sync, build, artifact publishing, repo add, local-only indexing, and adoption workflows.
audience: [consumer, contributor, maintainer]
purpose: [guide, workflow]
visibility: public
order: 30
---

# Ingestion And Build Flow

Atlas separates source synchronization from corpus building. Sync updates source state and manifests. Build compiles source documents into persisted retrieval artifacts.

This split lets Atlas know whether source state changed before it spends work parsing Markdown, chunking text, and updating SQLite records. It also gives operators separate recovery points for source acquisition problems and corpus build problems.

## Sync Flow

1. The CLI, server, or tests load config through `@atlas/config`.
2. `@atlas/indexer` resolves each repo and selects a source adapter.
3. `@atlas/source-git` updates local Git caches for `local-git` repos.
4. `@atlas/source-ghes` reads GHES commits, trees, blobs, and compare metadata for `ghes-api` repos.
5. The indexer computes source updates and writes manifest state.

Sync does not parse Markdown or update document sections. It establishes source freshness and changed path evidence for a later build.

Sync reports should be safe for humans and agents to inspect. They can include revisions, changed paths, timings, recovery state, and diagnostics, but they should not expose credentials.

## Build Flow

1. The indexer lists source files and asks `@atlas/topology` to discover packages, modules, docs, and skills.
2. Incremental planning decides whether to noop, rebuild everything, rebuild changed docs, delete removed docs, or apply a targeted build selector.
3. The compiler parses Markdown, extracts frontmatter, builds canonical documents, sections, outlines, summaries, and skill metadata.
4. The tokenizer builds chunks with exact token counts and stable provenance.
5. The store persists repos, packages, modules, docs, sections, chunks, summaries, skills, FTS rows, and manifests transactionally.

Failed rebuilds must not replace the last good corpus. Recovery status and diagnostics are surfaced through reports, CLI output, server routes, and MCP freshness tools.

## Repo Artifact Format

Maintainers can run `atlas init` and `atlas build` inside a normal Git checkout to produce a committed repo-local artifact at `.moxel/atlas/`. `atlas init` records `refMode: current-checkout` by default, so `atlas build` reads the current checkout `HEAD` and does not require the active branch or detached commit to exist on `origin`.

Artifact files are exact:

- `.moxel/atlas/manifest.json`
- `.moxel/atlas/corpus.db`
- `.moxel/atlas/checksums.json`
- `.moxel/atlas/docs.index.json`

`manifest.json` uses schema `moxel-atlas-artifact/v1` and records `repoId`, `host`, `owner`, `name`, `ref`, `indexedRevision`, `createdAt`, `atlasVersion`, and format metadata. `checksums.json` uses `sha256` over `manifest.json`, `corpus.db`, and `docs.index.json`. `docs.index.json` is readable metadata for document paths, titles, kinds, authorities, package/module/skill IDs, content hashes, source versions, and counts.

Artifact JSON must not contain secrets or absolute machine-local paths. Remote artifact fetch/import, stale warnings, artifact verify, and CI freshness are supported by later workflows.

Maintainer workflow:

```bash
cd repo
atlas init
atlas build
atlas artifact verify
git add .moxel/atlas
```

Use `atlas init --ref-mode remote --ref <branch>` only when published artifacts must be built from a ref that is resolvable on `origin`. Remote mode is not the same as reading the current working tree: it runs `git fetch origin <ref>` and checks out `FETCH_HEAD` in a managed cache. `--ref HEAD` with current-checkout mode means the current checkout HEAD, including detached HEAD; `--ref HEAD` with remote mode still requires remote ref resolution.

Maintainers control branch names, commit messages, hooks, PR templates, staging, commit, and push. Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Artifact verification and inspection

Maintainers should run `atlas artifact verify` after `atlas build` and before `git add .moxel/atlas`. Verification checks manifest schema, checksums, corpus importability, and secret/path safety.

```bash
atlas artifact verify
atlas artifact verify --path .moxel/atlas
atlas artifact inspect
atlas artifact inspect --json
```

`atlas artifact inspect` summarizes repo ID, ref, indexed revision, created timestamp, Atlas version, format version, artifact files, and docs counts. `atlas artifact verify --fresh` additionally fails stale artifacts with `Artifact is stale; run atlas build and commit .moxel/atlas.`.

## Artifact verification in CI

Repo owners should prefer CI verification first: run `atlas artifact verify --fresh` after `.moxel/atlas` is committed so stale artifacts fail before merge.

```yaml
name: atlas-artifact
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bunx @moxellabs/atlas artifact verify --fresh
```

For monorepos using this checkout before package publishing, replace last step with `bun run cli -- artifact verify --fresh` or equivalent local command. Manual alternatives remain valid:

```bash
atlas artifact verify
atlas artifact verify --fresh --ref $(git rev-parse HEAD)
atlas artifact inspect
```

CI bots or custom org automation may run same commands, but Atlas does not choose branch names, commit messages, hooks, PR templates, approvals, or permissions. Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Incremental Behavior

Incremental planning uses manifest state, source diffs, topology classification, and optional build selectors. A plan may:

- return `noop` when the indexed revision and build inputs are current;
- rebuild all docs when compiler, topology, tokenizer, or schema compatibility requires it;
- rebuild only affected docs when source changes map cleanly to classified docs;
- delete persisted records for removed docs; or
- apply a targeted repo/package/module/doc/skill selector.

The indexer should make these decisions before invoking expensive compiler or store work. Build reports expose `reasonCode`, `changedPaths`, `affectedDocPaths`, `deletedDocPaths`, and `skippedDocPaths` so operators can debug missed or excessive rebuilds. Diagnostic values are repository-relative paths/revisions only, never credentials.

## Persistence Boundary

The store persists the build result at the operation boundary. Repositories, packages, modules, documents, sections, chunks, summaries, skills, FTS rows, and manifests are written in one transaction, with manifest update last. Successful builds index document, section, and chunk entries in FTS. Failed persistence preserves previous corpus and search rows.

Partial failures should surface as recovery metadata and diagnostics rather than silently mixing old and new corpus records. Consumers should read freshness from manifests instead of inferring it from individual document rows.

## Important Invariants

- Source adapters return repository-relative POSIX paths. Local Git and GHES diff handling covers add, modify, delete, rename, copy, and type-change where supported. Unsafe GHES compare shapes trigger full rebuild reason `GHES compare response could not provide trustworthy file-level changes; full rebuild required.`
- IDs are deterministic and derived from repo/path/scope inputs.
- Compiler and tokenizer outputs must be stable for the same source content and options.
- Store writes for a build are transactional at the operation boundary.
- Retrieval reads from the persisted local corpus, not directly from remote sources.
- Runtime surfaces should report build/sync diagnostics without changing package-layer semantics.

## Consumer repo consumption workflow

When unsure, start with `atlas next`; it inspects setup, repo metadata, registry state, and corpus contents, then recommends one command.

```bash
atlas setup
atlas repo add platform/docs
atlas search "deployment rollback" --repo github.mycorp.com/platform/docs
atlas inspect retrieval --query "deployment rollback" --repo github.mycorp.com/platform/docs
atlas mcp
atlas repo remove github.mycorp.com/platform/docs --yes
```

`atlas setup` creates `~/.moxel/atlas/config.yaml` and runtime directories. `atlas repo add` lazy-creates setup if missing; legacy `atlas add-repo` remains script-compatible with the same JSON behavior. Remote repo onboarding fetches committed `.moxel/atlas` artifacts through the configured GitHub/GHES API without cloning the full repo. Local checkout artifacts are preferred when present.

Stale artifacts print `Artifact is stale; importing anyway.` and are still imported. Missing artifact choices are `clone and index locally only`, `skip`, `show maintainer instructions`, and `generate issue/PR instructions`. Use `atlas index` for the local-only fallback only; it writes to the user-home global corpus and never writes `.moxel/atlas` into the managed checkout. Runtime search/retrieval/MCP/server read `~/.moxel/atlas/corpus.db` and do not fetch remote source at query time.

## Maintainer artifact publishing workflow

```bash
cd repo
atlas init
atlas build
atlas artifact inspect
atlas artifact verify
atlas artifact verify --fresh
git add .moxel/atlas
```

Committed artifact files are `.moxel/atlas/manifest.json`, `.moxel/atlas/corpus.db`, `.moxel/atlas/checksums.json`, and `.moxel/atlas/docs.index.json`. `atlas artifact verify` checks manifest schema, checksums, corpus importability, and secret/path safety. `atlas artifact verify --fresh` exits non-zero when artifact indexed revision differs from current HEAD/ref.

Maintainers own docs quality. Improve weak docs before `atlas build`; the `document-codebase` skill can be used before indexing/building. Atlas never chooses branch names, commit messages, hooks, PR templates, staging, commit, or push. Use [artifact verification in CI](#artifact-verification-in-ci) for freshness gates.

## Artifact-only repo add fetch

`atlas repo add org/repo` downloads committed `.moxel/atlas` artifact files via GitHub/GHES API into `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` without cloning full repositories when artifacts exist. Legacy `atlas add-repo org/repo` remains a compatibility alias. Files fetched are exactly `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json`.

Validation order is manifest schema and identity, checksums, then safety scanner. Errors include `CLI_ARTIFACT_NOT_FOUND`, `CLI_ARTIFACT_FETCH_FAILED`, `CLI_ARTIFACT_SCHEMA_INVALID`, `CLI_ARTIFACT_ID_MISMATCH`, and `CLI_ARTIFACT_CHECKSUM_INVALID`. Tokens come from environment variables only and are not persisted.

Local Atlas knowledge bundles take precedence over remote bundles for local path and cwd inputs. If `indexedRevision` differs from remote HEAD, Atlas warns: `Artifact is stale; importing anyway.` Missing bundles do not trigger clone automatically; Atlas prints next-step commands instead.

## Global corpus import lifecycle

`atlas repo add` acquires and validates `.moxel/atlas` artifacts, then imports the artifact `corpus.db` into the global runtime database at `~/.moxel/atlas/corpus.db`. A re-import replaces rows for the same repo (`host/owner/name`) before copying new artifact rows, so other imported repositories remain intact.

If validation or import fails, `repo.json` is not marked as `imported`; previous global rows remain intact on failed re-import. `atlas repo remove` deletes global corpus rows for that repo and removes its repo folder metadata.

Runtime search/retrieval/MCP reads the global corpus and does not fetch remote source at query time.

## Missing artifact fallback

When `atlas repo add` cannot fetch published Atlas docs, Atlas prints `This repo doesn't publish an Atlas knowledge bundle yet.` and shows next-step commands: build a local-only index, ask maintainers to publish Atlas docs, draft issue/PR text, or rerun with `-i` for an interactive chooser. Default mode is non-interactive and skips the repo unless `--local-only`, `--skip-missing-artifact`, `--maintainer-instructions`, `--issue-pr-instructions`, or `-i` is provided.

Consumers can run `atlas repo add org/repo --local-only` to get an exact `atlas index org/repo --repo-id <host/owner/name> --ref <ref>` handoff. Maintainer instructions mention `atlas init`, `atlas build`, and `git add .moxel/atlas`.

Atlas does not branch, commit, push, create issues, or create PRs.

## Maintainer adoption templates

Consumers can generate copyable maintainer request text when `.moxel/atlas` is missing:

```bash
atlas repo add org/repo --maintainer-instructions
atlas repo add org/repo --issue-pr-instructions
atlas adoption-template org/repo --repo-id github.com/org/repo
```

Generated text includes maintainer setup instructions, issue template text, PR template text, artifact files (`manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json`), and commands (`atlas init`, `atlas build`, and `git add .moxel/atlas`). Atlas adoption templates are copyable text only. Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Consumer-to-maintainer adoption workflow

1. Consumer runs `atlas repo add org/repo`.
2. When `.moxel/atlas` is missing, consumer runs `atlas repo add org/repo --maintainer-instructions` or `atlas repo add org/repo --issue-pr-instructions`.
3. Consumer copies generated text into their org's normal issue, PR, support, or maintainer-request process.
4. Maintainer reviews request and decides whether published Atlas docs fit repo policy.
5. Maintainer runs `atlas init`, `atlas build`, and `git add .moxel/atlas` in their checkout.
6. Maintainer uses their own branch, commit message, hooks, PR template, CI, approvals, and permissions.
7. Consumer retries `atlas repo add org/repo` after artifact lands.

`.moxel/atlas` lets consumers add remote docs without cloning, improves retrieval speed, records a reproducible corpus snapshot, exposes readable `docs.index.json`, and enables checksum validation.

After maintainers add `.moxel/atlas`, they can manually rerun `atlas build` when docs change and use `atlas artifact verify --fresh` in CI before merge.

## Local-only index fallback

`atlas index <repo-input> --repo-id <host/owner/name> --ref <ref>` is the consumer fallback for repos without maintained artifacts. It clones or updates a managed checkout under `~/.moxel/atlas/repos/<host>/<owner>/<name>/checkout`, analyzes documentation signal, then imports into the global corpus at `~/.moxel/atlas/corpus.db`.

README-only or weak-doc repositories warn before indexing. Consider running the document-codebase skill before indexing. Use `--force` to continue in automation after reviewing weak docs. Local-only indexing never writes .moxel/atlas into the managed checkout.

## Artifact and runtime root behavior

Default artifact/runtime roots use `.moxel/atlas` in maintainer checkouts and `~/.moxel/atlas` at runtime. Advanced embedded or enterprise wrappers can supply alternate roots through supported wrapper/default mechanisms; see [Enterprise CLI Mount](enterprise-cli-mount.md). Standalone `atlas setup` stays focused on functional runtime paths, hosts, and credentials, not wrapper display identity. Precedence is CLI > environment > config > default; explicit cache/corpus config overrides derived runtime paths.

Maintainer committed artifact path is identity root directly: `<repo>/.moxel/atlas/` or `<repo>/.acme/knowledge/`. Consumer imported mirrors preserve identity root directly: `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` or `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`. Files live directly inside identity root: `manifest.json`, `corpus.db`, `docs.index.json`, `checksums.json`, and `atlas.repo.json` when applicable. Legacy nested artifact mirror layouts are not used for fetched/copied mirrors. Custom identity roots do not read, copy, migrate, delete, or fallback to `.moxel/atlas` or `~/.moxel/atlas`.

## Public profile artifact publishing

Repo-local `atlas build` defaults to the public profile and writes one committed public `.moxel/atlas` artifact: `manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json`. Atlas itself uses this same public artifact flow: maintainers run `atlas init`, `atlas build --profile public`, `atlas artifact verify --fresh`, then commit `.moxel/atlas` so consumers can `atlas repo add .`. Public artifact filtering excludes `.planning/**`, `docs/archive/**`, `docs/prd/**`, and `visibility: internal` docs before checksums and safety validation run. `docs.index.json` preserves included document metadata: `title`, `description`, `audience`, `purpose`, `visibility`, and `order`.

## Public Consumer Workflow

Consumers import maintained public artifacts into local runtime storage:

```bash
atlas setup
atlas repo add org/repo
atlas search "how to deploy" --repo github.com/org/repo
```

## Public Maintainer Artifact Workflow

Maintainers publish a public artifact from a checkout. Atlas writes files; maintainers own Git review and release policy.

```bash
atlas init
atlas build --profile public
atlas artifact inspect
atlas artifact verify --fresh
git add .moxel/atlas
```

## Local-Only Fallback Workflow

When no public artifact exists, consumers can build a local-only corpus without mutating the source checkout:

```bash
atlas index org/repo
```

## Adoption Workflow Commands

```bash
atlas repo add org/repo --maintainer-instructions
atlas repo add org/repo --issue-pr-instructions
atlas adoption-template org/repo --repo-id github.com/org/repo
```

The templates explain `atlas init`, `atlas build --profile public`, and `atlas artifact verify --fresh` for maintainers.
