# @atlas/cli

Command-line interface for operating a local ATLAS corpus.

The CLI owns local workflows: creating config, registering repos, syncing source state, building the local corpus, inspecting stored artifacts, pruning caches, running readiness checks, and starting the server.

## Runtime Role

- Loads ATLAS config and environment through `@atlas/config`.
- Opens the local SQLite store through `@atlas/store`.
- Uses `@atlas/indexer` for sync/build orchestration.
- Uses `@atlas/mcp` for command-launched stdio MCP sessions.
- Uses `@atlas/retrieval` and store repositories for inspection commands.
- Supports human output and JSON output with stable exit codes.

## Implemented Commands

```text
atlas setup
atlas init (compatibility alias for setup)
atlas repo add
atlas sync
atlas build
atlas serve
atlas mcp
atlas inspect
atlas install-skill
atlas list
atlas clean
atlas prune
atlas doctor
atlas eval
```

## Common Usage

Set up user-home Atlas state:

```bash
bun run cli setup --non-interactive
```

Add a local Git repo:

```bash
bun run cli add-repo \
  --non-interactive \
  --repo-id github.com/moxellabs/atlas \
  --mode local-git \
  --remote file:///path/to/repo \
  --local-path ~/.moxel/atlas/checkouts/github.com/moxellabs/atlas \
  --ref main \
  --template mixed-monorepo
```

Add a GHES repo. ATLAS can reuse GitHub CLI credentials or token env vars:

```bash
gh auth login --hostname ghe.example.com

bun run cli add-repo \
  --non-interactive \
  --repo-id github.mycorp.com/platform/docs \
  --mode ghes-api \
  --base-url https://ghe.example.com/api/v3 \
  --owner platform \
  --name docs \
  --ref main \
  --template mixed-monorepo
```

Sync/build:

```bash
bun run cli sync --repo github.com/moxellabs/atlas
bun run cli sync --repo github.com/moxellabs/atlas --check
bun run cli build --repo github.com/moxellabs/atlas
bun run cli build --repo github.com/moxellabs/atlas --force
```

`sync` refreshes source revision state and reports whether the indexed corpus is affected. It does not rebuild MCP-served docs, skills, chunks, or summaries. Code-only changes can keep the corpus current; docs, skill artifacts, topology-sensitive paths, and package manifests mark the corpus stale. Use `sync --check` in CI to exit non-zero when a build is required.

Targeted build:

```bash
bun run cli build --repo github.com/moxellabs/atlas --doc-id <docId>
bun run cli build --repo github.com/moxellabs/atlas --package-id <packageId>
bun run cli build --repo github.com/moxellabs/atlas --module-id <moduleId>
```

Inspect/list:

```bash
bun run cli repo list
bun run cli list repos
bun run cli list packages --repo github.com/moxellabs/atlas
bun run cli list docs --repo github.com/moxellabs/atlas
bun run cli list sections --doc <docId>
bun run cli list freshness --repo github.com/moxellabs/atlas
bun run cli inspect manifest
bun run cli inspect freshness atlas
bun run cli inspect section <sectionId>
bun run cli inspect retrieval --query "session rotation" --repo github.com/moxellabs/atlas
```

Start a stdio MCP server for command-launched MCP clients:

```bash
bun run cli mcp
```

Eval:

```bash
bun run cli eval --dataset ./eval.dataset.json
atlas eval --kind mcp-adoption --dataset ./mcp-adoption.dataset.json --trace ./mcp-adoption.trace.json
atlas eval --kind mcp-adoption --dataset ./mcp-adoption.dataset.json --trace ./mcp-adoption.trace.json --json
```

MCP adoption evals use local JSON traces to score call/no-call behavior. Indexed repository prompts should read `atlas://manifest` then call `plan_context`; ambiguous repository prompts should read `atlas://manifest` and may ask clarification before `plan_context`; non-indexed repository prompts should read `atlas://manifest` and avoid `plan_context`; generic prompts should make no Atlas MCP calls; security-sensitive prompts should make no Atlas MCP calls, no remote fetch, and no credential echo. `adoptionScore` is `passedCases / totalCases`; failed cases exit non-zero.

Clean generated corpus artifacts without deleting managed repo caches:

```bash
bun run cli clean --dry-run
bun run cli clean
```

## Development

```bash
bun --cwd apps/cli run typecheck
bun test apps/cli
```

Repo-level validation:

```bash
bun run typecheck
bun run lint
bun test
```

## Hosts and repo resolver

Use `atlas hosts add github.mycorp.com --web-url https://github.mycorp.com --api-url https://github.mycorp.com/api/v3 --protocol ssh --priority 10 --default` to add GHES hosts. Use `atlas hosts list`, `atlas hosts set-default github.mycorp.com`, and `atlas hosts prioritize github.mycorp.com --priority 10` to manage priority/defaults.

`atlas repo add` accepts `platform/docs --host github.mycorp.com`, `git@github.mycorp.com:platform/docs.git`, `https://github.mycorp.com/platform/docs.git`, and `atlas repo add .`.
