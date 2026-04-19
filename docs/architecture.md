# Atlas Architecture

Atlas is a Bun and TypeScript workspace with two apps and a package layer. Apps own user-facing runtime surfaces. Packages own deterministic domain behavior.

## System Boundaries

- `apps/cli` is the local operator shell for config mutation, sync, build, inspection, skill export, cleanup/pruning, doctor checks, MCP stdio, and server startup.
- `apps/server` is the loopback HTTP runtime with OpenAPI, API routes, build/sync operations, retrieval routes, and the MCP bridge.
- `packages/core` defines shared IDs, enums, source contracts, topology contracts, document contracts, retrieval types, summaries, provenance, freshness, and deterministic utilities.
- `packages/config` loads config files, environment overrides, paths, server settings, repo definitions, topology rules, and GHES credentials.
- `packages/source-git` and `packages/source-ghes` implement source acquisition behind the shared source adapter contract.
- `packages/topology` discovers packages/modules and classifies docs or skills into scopes.
- `packages/compiler` turns Markdown into canonical documents, sections, outlines, summaries, and skill metadata.
- `packages/tokenizer` performs exact token accounting and section-first chunking.
- `packages/store` persists the local corpus in SQLite and provides search primitives.
- `packages/retrieval` classifies queries, infers scopes, ranks candidates, and builds token-budgeted context plans.
- `packages/indexer` orchestrates sync/build pipelines across source, topology, compiler, tokenizer, and store.
- `packages/mcp` exposes tools, resources, prompts, and transports for the compiled local corpus.
- `packages/testkit` provides deterministic fixtures and evaluation utilities.

## Dependency Direction

The package layer should flow from contracts toward runtimes:

`core -> config/source/topology/compiler/tokenizer/store/retrieval/indexer/mcp -> apps`

Apps should delegate work to package services instead of embedding source acquisition, compilation, persistence, or retrieval logic.

## Runtime Surfaces

Atlas has three user-facing runtime surfaces over the same local corpus:

- The CLI runs operator workflows such as `init`, `add-repo`, `sync`, `build`, `list`, `inspect`, `serve`, `mcp`, `install-skill`, `clean`, `prune`, `doctor`, and `eval`.
- The HTTP server composes Elysia routes, OpenAPI, build/sync services, retrieval services, and an MCP bridge for local clients.
- The MCP package exposes tools, resources, prompts, and transports that agents can call without knowing store or retrieval internals.

These surfaces should stay thin. They validate inputs, construct dependencies, call package services, and format responses. They should not fork package behavior.

## Corpus Model

Atlas stores documentation as scoped artifacts:

- repos identify configured source roots.
- packages represent workspace package roots.
- modules represent source areas inferred from module-local docs.
- documents are canonical Markdown artifacts.
- sections preserve document hierarchy.
- chunks support retrieval under token limits.
- summaries support efficient overview retrieval.
- skills describe callable or procedural knowledge.
- manifests track revision and build freshness.

## Data Flow

Source ingestion and retrieval are intentionally separated:

1. Config is loaded by `@atlas/config`.
2. `@atlas/indexer` selects a source adapter and syncs source revision state.
3. `@atlas/topology` discovers packages/modules and classifies docs or skills by path.
4. `@atlas/compiler` parses Markdown into canonical documents, sections, outlines, summaries, and skill records.
5. `@atlas/tokenizer` creates token-counted chunks with stable provenance.
6. `@atlas/store` persists corpus records and search indexes transactionally.
7. `@atlas/retrieval` reads the persisted corpus, classifies queries, ranks candidates, and builds context plans.
8. CLI, server, and MCP surfaces present those results to humans or agents.

Retrieval never reads directly from remote source repositories. Builds never depend on agent-specific protocol behavior.

## Extension Points

- Add CLI workflows under `apps/cli/src/commands` and keep implementation delegated to package services.
- Add HTTP routes under `apps/server/src/routes` with validation in schemas and domain work in services/packages.
- Add MCP tools under `packages/mcp/src/tools`, with schemas in `packages/mcp/src/schemas`.
- Add source acquisition modes by implementing the shared source adapter contract from `@atlas/core`.
- Add topology behavior through adapters or rules in `@atlas/topology`, not in compiler or indexer code.

## Documentation Update

- Update active docs after behavior, architecture, or operator workflow changes.
- Keep historical plans and checklists under `docs/archive/`; they are not active source of truth and are excluded from normal self-indexing.
