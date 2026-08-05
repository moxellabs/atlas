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
- `repo add` mutates user-home config.
- `sync` and `build` delegate to `@atlas/indexer`.
- `list` and `inspect` read stored corpus state.
- `install-skill` exports stored skill artifacts into supported agent/editor formats.
- `agent` lists, detects, configures, verifies, and removes Atlas MCP integrations for supported headless agents and IDEs.
- `clean` removes local corpus database artifacts; `prune` removes unconfigured repo caches.
- `doctor` validates local prerequisites, source reachability, credentials, and store readiness.
- `serve` starts the HTTP runtime.
- `mcp` starts a stdio MCP session backed by local store/retrieval services.
- `eval` runs deterministic retrieval evaluation scenarios and MCP adoption call/no-call scenarios.

The CLI supports human output, JSON output, stable exit codes, and non-interactive operation for tests. Enterprise Commander CLIs can mount the full Atlas command tree with `@mrmendez/atlas/commander`; see [Enterprise CLI Mount](enterprise-cli-mount.md). `apps/cli/package.json` declares the local Bun binary entrypoint as `bin.atlas = ./src/index.ts`; Distribution smoke validation executes that entrypoint with `--help`.

Maintainer artifact flow:

```bash
cd repo
atlas init
atlas build
git add .moxel/atlas
```

Repo target inference is shared across repo-targeting commands. Explicit `--repo` / `--repo-id host/owner/name` still wins, but Atlas also checks repo-local metadata, configured local checkout paths, Git origin, unique bare repo names, and single configured repos. GitHub.com origins work with the built-in default host; GHES origins still require `atlas hosts add <host>`.

`atlas setup` is user-home consumer setup. `atlas init` is repo-local maintainer setup. Repo-local `atlas build` writes `.moxel/atlas/manifest.json`, `.moxel/atlas/corpus.db`, `.moxel/atlas/checksums.json`, and `.moxel/atlas/docs.index.json`. Maintainers control branch names, commit messages, hooks, PR templates, staging, commit, and push. Atlas gives commit hints only; Atlas does not stage, commit, branch, or push.

### MCP Adoption Evaluation

`atlas eval --kind mcp-adoption --dataset ./mcp-adoption.dataset.json --trace ./mcp-adoption.trace.json` checks whether agent traces use Atlas MCP only when appropriate. JSON mode is available with `--json`.

Expected behavior matrix:

| Prompt type                        | Expected behavior                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Broad indexed-source prompt        | Call `answer_<source>_docs` or `plan_context`; answer when the packet is sufficient.                                 |
| Exact passage prompt               | Call `search_passages`; open a known `docId` with `read_document` only when an outline or exact section is required. |
| Known stable result                | Call `expand_related` only for a missing related claim.                                                              |
| Skill or procedure prompt          | Call `use_skill` directly.                                                                                           |
| Absent, partial, or stale coverage | Prefer local indexed evidence when sufficient; retain external fallback when coverage is absent, partial, or stale.  |
| Generic prompt                     | No Atlas MCP calls.                                                                                                  |
| Security-sensitive prompt          | No Atlas MCP calls, no remote fetch, no credential echo.                                                             |

`adoptionScore` is `passedCases / totalCases`. Failed adoption cases make the CLI exit non-zero. Adoption fixtures are local JSON traces; they do not start network services, fetch remote repositories, or read environment tokens.

## HTTP Server

`apps/server` composes Elysia routes over explicit dependencies. It serves health/version metadata, repository mutation, search, context planning, document reads, skills, inspect views, sync/build operations, OpenAPI, and `/mcp`. Loopback mode also owns the configured nonblocking repository freshness lifecycle. Authenticated remote read-only mode serves an immutable corpus snapshot and does not start source reconciliation.

The server is treated as a private runtime app, not a published library package. Its package metadata exposes source entrypoints for local smoke validation: `.` maps to `src/app.ts`, and `./start-server` maps to `src/start-server.ts`. Distribution smoke checks validate `createApp` without binding a long-lived process.

Repository mutation routes are intended for loopback-bound servers. Read and operation routes stay local-first and use the configured SQLite corpus.

Local browser CORS allows `http://localhost`, `http://127.0.0.1`, and `http://[::1]` origins. It permits the `authorization` request header for local clients and keeps `credentials` disabled so browsers do not attach ambient credentials.

## MCP

`packages/mcp` exposes tools, resources, and prompts over stdio or Streamable HTTP. The server mounts Streamable HTTP at `/mcp` when enabled. MCP calls read from local store and retrieval services. `plan_context` may include state from the host runtime's background lifecycle, but the call itself never syncs, builds, or fetches remote source.

The default `agent` profile advertises `plan_context`, `search_passages`, `read_document`, `expand_related`, `use_skill`, and one configured `answer_<source>_docs` facade. `search_passages` discovers evidence from a query; `read_document` only opens a known `docId`. The profile does not expose addressable resources because clients can mistake resource traversal for evidence retrieval. The primary source facade carries `anthropic/alwaysLoad` and returns the strongest passage for a broad question. `plan_context` remains discoverable without forced preload and owns ambiguity, comparison, module boundaries, and multi-passage planning. Additional advanced-profile facades also remain discoverable without forced preload. Source aliases, topics, coverage, freshness, repository-relative citations, and explicit next-action guidance let clients route indexed-source questions and stop retrieval when the returned evidence is sufficient.

Use `atlas mcp --tool-profile advanced` for local stdio inspection or set `ATLAS_MCP_TOOL_PROFILE=advanced` on the HTTP server. This adds `find_scopes`, permits up to 12 configured source facades, and exposes addressable MCP resources for explicit inspection after a retrieval tool returns a stable identifier. The default profile keeps one source facade and no resources. `neutral` is the default discovery policy; `prefer-local` asks clients to consult matching indexed sources first while preserving fallback for absent, partial, or stale coverage.

### Agent and IDE integration

`atlas agent list` reports the support matrix. `atlas agent detect` checks installed client executables, minimum versions, and Atlas-managed receipts. Install one target explicitly or every detected, version-compatible target:

```bash
atlas agent install codex --mode discoverable
atlas agent install cursor --scope workspace --mode prefer-local
atlas agent install --detected --mode discoverable
atlas agent doctor --all
```

Supported targets are Codex CLI, Claude Code, Gemini CLI, Google Antigravity, GitHub Copilot CLI, OpenCode, Aider, Visual Studio Code, Cursor, Windsurf, Cline, Roo Code, Continue, Zed, JetBrains AI Assistant, Junie, Kiro, and Amazon Q Developer. Atlas uses a client's native MCP command when that command is documented and stable; otherwise it performs a narrow JSON/TOML/managed-file merge or returns a copyable manual configuration. Aider currently has no documented MCP surface, so its entry reports the limitation and recommends read-only Atlas artifacts instead of inventing a configuration. User and workspace support is reported per target, and unsupported scopes fail before mutation.

Modes are explicit. `standard` registers Atlas without discovery-specific client changes. `discoverable` adds only supported reliability settings; for Codex, Atlas marks the server required and automatically approves read-only tools while retaining prompts for future write-capable tools. `prefer-local` also requests Atlas's covered-query-first MCP initialization guidance while retaining fallback for absent, partial, or stale local evidence. It does not force irrelevant Atlas calls.

Every automatic mutation has a per-client, per-scope receipt under `~/.moxel/atlas/integrations`. Writes are atomic and serialized. Re-running `atlas agent install` with a different mode or server command reconciles the Atlas-owned entry in place after verifying it has not drifted. `atlas agent doctor <client>` compares live state with the receipt. `atlas agent remove <client>` removes only the Atlas-owned entry and managed discovery settings; it does not rewrite unrelated client configuration.

### Authenticated remote hosting

Run a dedicated Atlas process behind an HTTPS reverse proxy. Keep the Atlas listener on its default loopback host; public listener binds are rejected:

```bash
ATLAS_REMOTE_AUTH_TOKEN_FILE=/run/secrets/atlas-token \
ATLAS_REMOTE_TLS_TERMINATED=true \
ATLAS_REMOTE_REPO_ALLOWLIST=github.com/acme/platform-docs \
ATLAS_MCP_DISCOVERY_POLICY=prefer-local \
atlas serve
```

The token file must be a regular owner-only file and contain at least 32 characters. The server fails startup unless the allowlist is non-empty and every configured or indexed repository belongs to it. Remote middleware requires HTTPS proxy metadata and bearer authentication, limits requests and responses, applies a per-token rate limit, and exposes only read-only HTTP and MCP routes. See [Security](https://github.com/moxellabs/atlas/blob/main/docs/security.md#hosted-read-only-boundary).

For centrally hosted Atlas, clients can still launch the local stdio bridge while all MCP calls are proxied to authenticated Streamable HTTP:

```bash
atlas agent install cursor --scope workspace \
  --remote-url https://atlas.example.com/mcp \
  --auth-token-env ATLAS_REMOTE_TOKEN
```

Use exactly one of `--auth-token-env` or `--auth-token-file`. The generated client configuration stores only the environment-variable name or token-file path, never the bearer value. Remote URLs must use HTTPS. The bridge mirrors the remote server's tools, resources, prompts, capabilities, and change notifications; it fails closed if `prefer-local` was requested but the remote server does not advertise that policy.

First-party skills imported from public artifacts are available through `use_skill`. Call it without a skill or task to browse, with an ID/title/alias for exact resolution, or with a natural-language task for deterministic matching. After importing Atlas itself, first-party skills such as `document-codebase` and `skill-creator` appear with Atlas-prefixed invocation aliases. Resolved results include instructions, references, scripts, templates, checklists, and agent profiles as read-only artifacts.

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

`atlas repo list` reads folder registry metadata from `~/.moxel/atlas/repos/<host>/<owner>/<name>/repo.json`. `atlas repo doctor` validates local metadata/config/store consistency without network calls and can infer the current repo from cwd, repo metadata, config, Git origin, or a unique bare name such as `atlas repo doctor docs`. Passing the full canonical ID remains the disambiguation path: `atlas repo doctor github.mycorp.com/platform/docs`. `repo doctor` labels config, registry, store, and artifact metadata layers and explicitly does not run `build`. `atlas repo remove github.mycorp.com/platform/docs --yes` removes registry folder state and imported corpus rows for that canonical repo ID.

## Host management and repo resolver

CLI surface includes `atlas hosts list`, `atlas hosts add`, `atlas hosts set-default`, and `atlas hosts prioritize`. `atlas repo add` accepts shorthand, SSH URLs, HTTPS URLs, and local paths such as `.` and normalizes them to `host/owner/name`.

## Repo add artifact acquisition

`atlas repo add` uses artifact-only acquisition for remote GitHub/GHES repos. It stores `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json` at `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` and does not clone source repositories when artifacts exist.

Local Atlas knowledge bundles take precedence over remote bundles for local path and cwd inputs. Valid stale bundles warn with `Artifact is stale; importing anyway.` and remain ready for import. Missing bundles show `This repo doesn't publish an Atlas knowledge bundle yet.` and no automatic clone occurs.

## Multi-repo global corpus runtime

Runtime surfaces read `~/.moxel/atlas/corpus.db`, populated by artifact imports from each repo. Every runtime result includes the canonical repo ID (host/owner/name).

Examples:

```sh
atlas search shared-platform-token
atlas search shared-platform-token --repo github.mycorp.com/platform/docs
```

Unscoped search and retrieval can return results from multiple imported repos. Repo-scoped search/retrieval filters use canonical IDs such as `github.mycorp.com/platform/docs`. MCP `search_passages` and `plan_context` preserve repo provenance on each returned item.

After import, queries do not need artifact files and do not fetch remote source at query time. `atlas repo remove github.mycorp.com/platform/docs` removes imported results for that repo from CLI, retrieval, MCP, and server runtime surfaces while preserving other repos.

## Repo add artifact acquisition fallback

If remote artifact acquisition finds no `.moxel/atlas`, `atlas repo add` offers clone and index locally only, skip repo, maintainer instructions, or issue/PR instructions. JSON output includes stable next action values and never writes repo config or repo metadata for skip/instruction choices.

Atlas does not branch, commit, push, create issues, or create PRs.

Missing-artifact adoption output is CLI-only text generation, not runtime retrieval mutation. It shares the adoption permission boundaries documented in [`docs/security.md`](./security.md#adoption-permission-boundaries): Atlas adoption templates are copyable text only, remote artifact fetches are read-only, and templates do not require write scopes.

`atlas artifact verify`, `atlas artifact verify --fresh`, and `atlas artifact inspect` support artifact validation and CI freshness checks.

`atlas index` stores its managed checkout at `~/.moxel/atlas/repos/<host>/<owner>/<name>/checkout`, imports into global corpus, and avoids writing repo-local artifacts. Weak docs print `Consider running the document-codebase skill before indexing.` as a warning handoff, not automatic execution.

## Identity root behavior

Default identity uses `.moxel/atlas` in maintainer checkouts and `~/.moxel/atlas` at runtime. Custom identity example: `--atlas-identity-root .acme/knowledge`, `ATLAS_IDENTITY_ROOT=.acme/knowledge`, or config `identity.root: ".acme/knowledge"`. `.acme` is umbrella/team/vendor equivalent to `moxel`; `knowledge` is brand/product/MCP equivalent to `atlas`. MCP identity uses `--atlas-mcp-name acme-knowledge`, `ATLAS_MCP_NAME=acme-knowledge`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`. Precedence is CLI > environment > config > default; explicit cache/corpus config overrides derived runtime paths.

Maintainer committed artifact path is identity root directly: `<repo>/.moxel/atlas/` or `<repo>/.acme/knowledge/`. Consumer imported mirrors preserve identity root directly: `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` or `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`. Files live directly inside identity root: `manifest.json`, `corpus.db`, `docs.index.json`, `checksums.json`, and `atlas.repo.json` when applicable. Legacy nested artifact mirror layouts are not used for fetched/copied mirrors. Custom identity roots do not read, copy, migrate, delete, or fallback to `.moxel/atlas` or `~/.moxel/atlas`.

## Metadata-aware search and retrieval

`atlas search` accepts `--profile`, `--audience`, `--purpose`, and `--visibility` filters. Imported artifacts default to `--profile public`; pass `--profile contributor`, `--profile maintainer`, or `--profile internal` when the imported artifact was built for that access level. Use `--all-profiles` or `--profile any` to search without a profile filter. Retrieval and MCP context planning pass profile/audience/purpose/visibility filters into store search so excluded docs do not become ranked or selected context.

## First-Party Skills And Public Docs

MCP exposes `use_skill` to browse imported public skill docs, resolve exact skills, match natural-language tasks, and read instructions and artifacts. Atlas publishes `document-codebase` for source-truth documentation work and `skill-creator` for approval-gated skill creation. CLI, HTTP, OpenAPI, and MCP surfaces all read local corpus state from public artifacts rather than remote source at query time.
