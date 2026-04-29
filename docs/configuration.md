---
title: Configuration
description: Configure Atlas identity roots, runtime paths, repository sources, hosts, profiles, and metadata rules.
audience: [consumer, contributor, maintainer]
purpose: [reference]
visibility: public
order: 20
---

# Configuration

Atlas setup creates `~/.moxel/atlas/config.yaml` for functional local runtime paths, hosts, and repo sources. Atlas config is loaded by `@atlas/config` from that user-home file when created through CLI setup/repo add, from existing `atlas.config.yaml`, `atlas.config.yml`, or `atlas.config.json` project files, from an explicit `--config`, or from `ATLAS_CONFIG`. Enterprise Commander wrappers can mount Atlas with supported default fields in wrapper code; see [Enterprise CLI Mount](enterprise-cli-mount.md).

The config package is the source of truth for config schema validation, path normalization, defaults, repo source shape validation, and credential resolution. CLI and server code should call the config loaders instead of reading config files directly.

## Core Fields

- `version`: config schema version, currently `1`.
- `cacheDir`: local cache root; default `~/.moxel/atlas`.
- `corpusDbPath`: SQLite corpus path; default `~/.moxel/atlas/corpus.db`.
- `logLevel`: runtime log verbosity.
- `server`: transport, host, and port.
- `repos`: configured source repositories.

Paths are normalized relative to the config file when appropriate. This lets the same config be used by the CLI, the HTTP server, tests, and MCP-hosting workflows without each runtime inventing path rules.

## Repo Source Modes

`local-git` repos provide a Git remote, local path, ref, and optional `refMode`. `ghes-api` repos provide a GHES REST API base URL, owner, name, ref, and optional token env var.

`local-git` has two explicit checkout semantics:

- `refMode: remote` (default) treats `localPath` as a managed cache. Atlas runs `git fetch origin <ref>`, detaches `FETCH_HEAD`, and requires `<ref>` to exist on `origin`.
- `refMode: current-checkout` treats `localPath` as the source checkout. Atlas reads the current working tree `HEAD` with `git rev-parse HEAD` and does not fetch, checkout, or require the branch to exist on `origin`. Use this for local-only branches and detached HEAD builds.

`ghes-api` is for GitHub Enterprise Server repositories read through REST APIs. Credential discovery is resolved by `@atlas/config`; `@atlas/source-ghes` receives resolved auth metadata and performs API operations.

Repo IDs should be stable because they participate in provenance, deterministic IDs, manifest state, retrieval scopes, and MCP resource identifiers.

## Workspace Discovery

Workspace config controls package discovery:

- `packageGlobs` identifies package roots such as `apps/*` and `packages/*`.
- `packageManifestFiles` identifies package manifests such as `package.json`.

Discovery output becomes package scope evidence for topology, compiler provenance, retrieval locality, and module summaries. Keep workspace globs broad enough to include real package roots, but narrow enough to avoid generated output, caches, and vendor directories.

## Topology Rules

Topology rules classify documentation by path. For Atlas itself:

- `docs/**/*.md` becomes root repo documentation, excluding `docs/archive/**/*.md`.
- `{apps,packages}/*/docs/**/*.md` becomes app or package documentation.
- `{apps,packages}/*/src/**/docs/**/*.md` becomes module-local documentation.
- `**/skill.md` becomes skill documentation.

Rules assign document kind, authority, priority, and ownership. Higher priority wins when multiple rules match.

## Environment And Secrets

Runtime environment is validated before use. Server host/port, log level, config path, and GHES credential inputs should flow through `@atlas/config` loaders.

Secrets should be referenced by environment variable name rather than written into config files. Docs, reports, diagnostics, and errors should describe credential source metadata without printing token values.

## Mutation Rules

The CLI owns config mutation workflows such as `atlas setup` and repository registration through `atlas repo add`. Setup creates `~/.moxel/atlas`, `~/.moxel/atlas/repos`, and the config/corpus parents as needed. Standalone setup does not ask for wrapper namespace, MCP display identity, or visual branding fields; those belong in embedded Commander wrapper code. Server-side mutation must preserve the same local-first behavior and should use config mutation helpers rather than editing YAML or JSON ad hoc.

Config changes should remain compatible with the schema and with both source adapters. When adding a config field, update schema validation, defaults, docs, CLI/server usage, and tests together.

## Repo registry

Repository IDs use canonical `host/owner/name` form, for example `github.mycorp.com/platform/docs`. Atlas stores user repo state in `~/.moxel/atlas/repos/<host>/<owner>/<name>/repo.json` with host, owner, name, source, timestamps, and artifact path metadata. Use `atlas repo list`, `atlas repo doctor github.mycorp.com/platform/docs`, and `atlas repo remove github.mycorp.com/platform/docs --yes` for registry management.

## Hosts

Default config contains:

```yaml
hosts:
  - name: github.com
    webUrl: https://github.com
    apiUrl: https://api.github.com
    protocol: ssh
    priority: 100
    default: true
```

GHES example:

```sh
atlas hosts add github.mycorp.com --web-url https://github.mycorp.com --api-url https://github.mycorp.com/api/v3 --protocol ssh --priority 10 --default
```

Shorthand repo inputs search hosts by priority then name. In non-interactive ambiguous cases, Atlas reports `Use --host <host> or a full SSH/HTTPS URL`.

## Remote artifact fetch and adoption templates

Configured host web/API URLs are used to read `.moxel/atlas` artifact files during explicit `atlas repo add` / `atlas add-repo`. Private repos should use least-privilege read tokens. Templates do not require additional write scopes.

Adoption templates do not call issue/PR APIs and do not use configured API URLs for remote writes. Atlas adoption templates are copyable text only. Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Enterprise host setup and troubleshooting

```bash
gh auth login --hostname github.mycorp.com
atlas hosts add github.mycorp.com --web-url https://github.mycorp.com --api-url https://github.mycorp.com/api/v3 --protocol ssh --priority 10 --default
atlas hosts set-default github.mycorp.com
atlas hosts prioritize github.mycorp.com --priority 10
atlas add-repo platform/docs --host github.mycorp.com
atlas add-repo git@github.mycorp.com:platform/docs.git
atlas add-repo https://github.mycorp.com/platform/docs.git
```

Configured host priority decides shorthand lookup order. Use `--host <host>` or a full SSH/HTTPS URL when shorthand is ambiguous. GHES hosts require a web URL and API URL such as `https://github.mycorp.com/api/v3`. Use least-privilege read tokens or `gh auth login --hostname github.mycorp.com`; Atlas needs read access to `.moxel/atlas` artifact files, not write scopes. SSH and HTTPS inputs normalize to the same canonical repo ID shape `host/owner/name`.

Troubleshooting:

- Auth failure: rerun `gh auth login --hostname github.mycorp.com` or set configured token env var.
- Missing artifact: run local-only index, skip, show maintainer instructions, or generate issue/PR instructions.
- Stale artifact: `Artifact is stale; importing anyway.` means import continues; ask maintainer to run `atlas artifact verify --fresh` in CI.
- Ambiguous shorthand: Use `--host <host>` or a full SSH/HTTPS URL.
- Weak docs warning: improve docs or use `document-codebase` before indexing/building.
- Repo removal: `atlas repo remove github.mycorp.com/platform/docs --yes` removes local repo state and corpus rows.

## Artifact and runtime root behavior

Default artifact/runtime roots use `.moxel/atlas` in maintainer checkouts and `~/.moxel/atlas` at runtime. Alternate roots are advanced configuration for embedded or enterprise wrappers and existing runtime integrations; normal standalone onboarding should not require them. MCP display identity and resource prefixes are wrapper/server concerns, not `atlas setup` prompts. Precedence is CLI > environment > config > default; explicit cache/corpus config overrides derived runtime paths.

Maintainer committed artifact path is identity root directly: `<repo>/.moxel/atlas/` or `<repo>/.acme/knowledge/`. Consumer imported mirrors preserve identity root directly: `~/.moxel/atlas/repos/<host>/<owner>/<name>/.moxel/atlas/` or `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`. Files live directly inside identity root: `manifest.json`, `corpus.db`, `docs.index.json`, `checksums.json`, and `atlas.repo.json` when applicable. Legacy nested artifact mirror layouts are not used for fetched/copied mirrors. Custom identity roots do not read, copy, migrate, delete, or fallback to `.moxel/atlas` or `~/.moxel/atlas`.

## Document metadata and profiles

Markdown frontmatter can classify docs for docs-site output, indexing, search, retrieval, and MCP context:

```yaml
title: Consumer Guide
description: Add Atlas-ready repositories and query them locally.
audience: [consumer]
purpose: [guide]
visibility: public
order: 20
```

Supported `visibility` values are `public` and `internal`. Supported `audience` values are `consumer`, `contributor`, `maintainer`, and `internal`. Supported `purpose` values are `guide`, `reference`, `api`, `architecture`, `operations`, `workflow`, `planning`, `implementation`, `archive`, and `troubleshooting`.

Precedence is `frontmatter > config rule > built-in default`. Use `docs.metadata.rules` for files without frontmatter:

```yaml
docs:
  metadata:
    rules:
      - id: planning-internal
        match:
          include: [".planning/**"]
        metadata:
          visibility: internal
          audience: [internal]
          purpose: [planning, implementation]
        priority: 100
    profiles:
      public:
        visibility: [public]
        audience: [consumer]
```

Built-in defaults classify `README.md`, `docs/**`, and `skills/**` as public consumer docs; `docs/archive/**` and `.planning/**` as internal; unmatched Markdown as contributor implementation docs. Built-in `docs.metadata.profiles` are `public`, `contributor`, `maintainer`, and `internal`.

## Static Site And Metadata Quickstart

Default artifact/runtime roots use `.moxel/atlas` in a maintainer checkout and `~/.moxel/atlas` in a consumer runtime:

```bash
atlas setup
atlas init
atlas build --profile public
```

Consumer onboarding uses maintained artifacts first:

```bash
atlas next
atlas repo add org/repo
```

Public docs and artifacts use document metadata fields `profile`, `audience`, `purpose`, and `visibility` to decide what belongs in a public artifact. Use Enterprise CLI Mount docs for wrapper-provided alternate roots or display identity defaults.
