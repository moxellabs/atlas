---
title: Runtime Surfaces
description: Map Atlas CLI, HTTP server, OpenAPI, MCP, and first-party skill surfaces.
audience: [consumer, contributor, maintainer]
purpose: [guide, reference]
visibility: public
order: 50
---

# Runtime Surfaces

Atlas exposes the same local corpus through a CLI, an embeddable Commander command tree, an HTTP server, OpenAPI docs, and MCP.

## CLI

`apps/cli` owns developer-machine workflows:

- `setup` creates `~/.moxel/atlas/config.yaml` and user-home runtime directories.
- `init` initializes repo-local `.moxel/atlas` artifact metadata for maintainers.
- `add-repo` mutates user-home config.
- `sync` and `build` delegate to `@atlas/indexer`.
- `list` and `inspect` read stored corpus state.
- `install-skill` exports stored skill artifacts into supported agent/editor formats.
- `clean` removes local corpus database artifacts; `prune` removes unconfigured repo caches.
- `doctor` validates local prerequisites, source reachability, credentials, and store readiness.
- `serve` starts the HTTP runtime.
- `mcp` starts a stdio MCP session backed by local store/retrieval services.
- `eval` runs deterministic retrieval evaluation scenarios and MCP adoption call/no-call scenarios.

The CLI supports human output, JSON output, stable exit codes, and non-interactive operation for tests. Enterprise Commander CLIs can mount the full Atlas command tree with `@moxellabs/atlas/commander`; see [Enterprise CLI Mount](enterprise-cli-mount.md). `apps/cli/package.json` declares the local Bun binary entrypoint as `bin.atlas = ./src/index.ts`; Phase 10 distribution smoke validation executes that entrypoint with `--help`.

Maintainer artifact flow:

```bash
cd repo
atlas init
atlas build
git add .moxel/atlas
```

`atlas setup` is user-home consumer setup. `atlas init` is repo-local maintainer setup. Repo-local `atlas build` writes `.moxel/atlas/manifest.json`, `.moxel/atlas/corpus.db`, `.moxel/atlas/checksums.json`, and `.moxel/atlas/docs.index.json`. Maintainers control branch names, commit messages, hooks, PR templates, staging, commit, and push. Atlas gives commit hints only; Atlas does not stage, commit, branch, or push.

### MCP Adoption Evaluation

`atlas eval --kind mcp-adoption --dataset ./mcp-adoption.dataset.json --trace ./mcp-adoption.trace.json` checks whether agent traces use Atlas MCP only when appropriate. JSON mode is available with `--json`.

Expected behavior matrix:

| Prompt type                   | Expected behavior                                                           |
| ----------------------------- | --------------------------------------------------------------------------- |
| Indexed repository prompt     | Read `atlas://manifest`, then call `plan_context`.                          |
| Ambiguous repository prompt   | Read `atlas://manifest`; agent may ask clarification before `plan_context`. |
| Non-indexed repository prompt | Read `atlas://manifest`; do not call `plan_context`.                        |
| Generic prompt                | No Atlas MCP calls.                                                         |
| Security-sensitive prompt     | No Atlas MCP calls, no remote fetch, no credential echo.                    |

`adoptionScore` is `passedCases / totalCases`. Failed adoption cases make the CLI exit non-zero. Adoption fixtures are local JSON traces; they do not start network services, fetch remote repositories, or read environment tokens.

## HTTP Server

`apps/server` composes Elysia routes over explicit dependencies. It serves health/version metadata, repository mutation, search, context planning, document reads, skills, inspect views, sync/build operations, OpenAPI, and `/mcp`.

The server is treated as a private runtime app, not a published library package. Its package metadata exposes source entrypoints for local smoke validation: `.` maps to `src/app.ts`, and `./start-server` maps to `src/start-server.ts`. Distribution smoke checks validate `createApp` without binding a long-lived process.

Repository mutation routes are intended for loopback-bound servers. Read and operation routes stay local-first and use the configured SQLite corpus.

Local browser CORS allows `http://localhost`, `http://127.0.0.1`, and `http://[::1]` origins. It permits the `authorization` request header for local clients and keeps `credentials` disabled so browsers do not attach ambient credentials.

## MCP

`packages/mcp` exposes tools, resources, and prompts over stdio or Streamable HTTP transports. The server mounts Streamable HTTP at `/mcp` when enabled. MCP operations read from local store and retrieval services. MCP context planning reads from the compiled local corpus; source diffs are available only when a runtime explicitly provides a source diff provider. MCP does not perform sync/build or remote source acquisition on normal retrieval tool calls.

First-party skills imported from public artifacts are available through `list_skills` and `use_skill`. After importing Atlas itself, first-party skills such as `document-codebase` and `skill-creator` appear with Atlas-prefixed invocation aliases. `use_skill` serves their instructions, references, scripts, templates, checklists, and agent profiles as read-only artifacts.

## OpenAPI

The server can expose OpenAPI JSON and a local HTML API reference. This is the supported browser inspection surface for HTTP APIs. OpenAPI groups implemented runtime, repository, retrieval, document, skill, inspection, operation, and MCP routes; sync/build operation routes delegate to indexer services and return package reports.

`/docs` serves the Scalar-backed OpenAPI reference. Root `/` redirects to `/docs`. `/openapi` remains available for compatibility with the same Scalar/OpenAPI experience. `/openapi.json` is the preferred raw machine-readable OpenAPI document. `/openapi/json` remains available for compatibility with earlier local server consumers. Intro, quickstart, tag guidance, operation descriptions, and safe examples live inside the generated OpenAPI content shown by Scalar.

## Release Readiness

Atlas v1.0 release validation is local-only:

```bash
bun run smoke:distribution
bun run release:check
```

`smoke:distribution` validates workspace manifest `exports` and `types`, imports each source entrypoint, runs CLI help through the declared bin path, and checks the server app entrypoint. `release:check` runs the full dry-run path: typecheck, lint, tests, and distribution smoke. No command publishes packages, contacts a registry, or needs registry credentials.

## Repo management commands

`atlas repo list` reads folder registry metadata from `~/.moxel/atlas/repos/<host>/<owner>/<name>/repo.json`. `atlas repo doctor github.mycorp.com/platform/docs` validates local metadata/config/store consistency without network calls. `atlas repo remove github.mycorp.com/platform/docs --yes` removes registry folder state and imported corpus rows for that canonical repo ID.

## Host management and repo resolver

CLI surface includes `atlas hosts list`, `atlas hosts add`, `atlas hosts set-default`, and `atlas hosts prioritize`. `atlas add-repo` accepts shorthand, SSH URLs, HTTPS URLs, and local paths such as `.` and normalizes them to `host/owner/name`.

## Add-repo artifact acquisition

`atlas add-repo` uses artifact-only acquisition for remote GitHub/GHES repos. It stores `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json` at `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` and does not clone source repositories when artifacts exist.

Local Atlas knowledge bundles take precedence over remote bundles for local path and cwd inputs. Valid stale bundles warn with `Artifact is stale; importing anyway.` and remain ready for import. Missing bundles show `This repo doesn't publish an Atlas knowledge bundle yet.` and no automatic clone occurs.

## Multi-repo global corpus runtime

Runtime surfaces read `~/.moxel/atlas/corpus.db`, populated by artifact imports from each repo. Every runtime result includes the canonical repo ID (host/owner/name).

Examples:

```sh
atlas search shared-platform-token
atlas search shared-platform-token --repo github.mycorp.com/platform/docs
```

Unscoped search and retrieval can return results from multiple imported repos. Repo-scoped search/retrieval filters use canonical IDs such as `github.mycorp.com/platform/docs`. MCP `find_docs` and `plan_context` preserve repo provenance on each returned item.

After import, queries do not need artifact files and do not fetch remote source at query time. `atlas repo remove github.mycorp.com/platform/docs` removes imported results for that repo from CLI, retrieval, MCP, and server runtime surfaces while preserving other repos.

## Add-repo artifact acquisition fallback

If remote artifact acquisition finds no `.moxel/atlas`, `atlas add-repo` offers clone and index locally only, skip repo, maintainer instructions, or issue/PR instructions. JSON output includes stable next action values and never writes repo config or repo metadata for skip/instruction choices.

Atlas does not branch, commit, push, create issues, or create PRs.

Missing-artifact adoption output is CLI-only text generation, not runtime retrieval mutation. It shares the adoption permission boundaries documented in [`docs/security.md`](./security.md#adoption-permission-boundaries): Atlas adoption templates are copyable text only, remote artifact fetches are read-only, and templates do not require write scopes.

Phase 19 adds `atlas artifact verify`, `atlas artifact verify --fresh`, and `atlas artifact inspect` for artifact validation and CI freshness checks.

`atlas index` stores its managed checkout at `~/.moxel/atlas/repos/<host>/<owner>/<name>/checkout`, imports into global corpus, and avoids writing repo-local artifacts. Weak docs print `Consider running the document-codebase skill before indexing.` as a warning handoff, not automatic execution.

## Identity root behavior

Default identity uses `.moxel/atlas` in maintainer checkouts and `~/.moxel/atlas` at runtime. Custom identity example: `--atlas-identity-root .acme/knowledge`, `ATLAS_IDENTITY_ROOT=.acme/knowledge`, or config `identity.root: ".acme/knowledge"`. `.acme` is umbrella/team/vendor equivalent to `moxel`; `knowledge` is brand/product/MCP equivalent to `atlas`. MCP identity uses `--atlas-mcp-name acme-knowledge`, `ATLAS_MCP_NAME=acme-knowledge`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`. Precedence is CLI > environment > config > default; explicit cache/corpus config overrides derived runtime paths.

Maintainer committed artifact path is identity root directly: `<repo>/.moxel/atlas/` or `<repo>/.acme/knowledge/`. Consumer imported mirrors preserve identity root directly: `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` or `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`. Files live directly inside identity root: `manifest.json`, `corpus.db`, `docs.index.json`, `checksums.json`, and `atlas.repo.json` when applicable. Legacy nested artifact mirror layouts are not used for fetched/copied mirrors. Custom identity roots do not read, copy, migrate, delete, or fallback to `.moxel/atlas` or `~/.moxel/atlas`.

## Metadata-aware search and retrieval

`atlas search` accepts `--profile`, `--audience`, `--purpose`, and `--visibility` filters. Imported public artifacts default to `--profile public`; requesting an unavailable profile reports `Profile contributor not available for repo; imported artifact contains public docs only.`. Retrieval and MCP context planning pass profile/audience/purpose/visibility filters into store search so excluded docs do not become ranked or selected context.

## First-Party Skills And Public Docs

MCP exposes `list_skills` to enumerate imported public skill docs and `use_skill` to read skill instructions and artifacts. Atlas publishes `document-codebase` for source-truth documentation work and `skill-creator` for approval-gated skill creation. CLI, HTTP, OpenAPI, and MCP surfaces all read local corpus state from public artifacts rather than remote source at query time.
