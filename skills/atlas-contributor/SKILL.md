---
name: atlas-contributor
title: Atlas Contributor
description: Contribute safely to the Atlas codebase. Use when an agent needs to add or change Atlas features, choose the right app/package/module boundary, preserve local-first behavior, update docs, or run the correct validation gates across CLI, server, indexer, MCP, retrieval, topology, compiler, tokenizer, store, source adapters, config, or core contracts.
visibility: public
audience: [contributor, maintainer]
purpose: [workflow]
order: 120
---

# Atlas Contributor

Use this skill for any non-trivial Atlas codebase change. Start from source truth, keep package boundaries intact, and validate the behavior at the narrowest useful layer before running repo-wide gates.

## Workflow

1. Locate ownership.
   - Apps own user-facing surfaces: `apps/cli` for commands and terminal output, `apps/server` for HTTP/OpenAPI/MCP mounting.
   - Packages own domain behavior: `core` contracts, `config` loading, `source-*` acquisition, `topology` classification, `compiler` Markdown artifacts, `tokenizer` chunks, `store` persistence/search, `retrieval` ranking/context, `indexer` sync/build orchestration, `mcp` protocol surfaces, `testkit` fixtures/eval.
   - Do not put package-layer logic into apps.

2. Read the nearest docs and tests.
   - Root architecture: `docs/architecture.md`.
   - Package/app docs: `apps/*/docs/index.md` and `packages/*/docs/index.md`.
   - Module docs: `*/src/<module>/docs/index.md`.
   - Tests usually live at package/app roots or beside the relevant module.

3. Preserve contract direction.
   - `@atlas/core` should not depend on higher packages.
   - Source adapters implement `RepoSourceAdapter`; they do not classify or persist docs.
   - Indexer coordinates source, topology, compiler, tokenizer, and store.
   - Retrieval reads persisted local artifacts; it should not fetch remote source.
   - MCP adapts store/retrieval behavior to protocol tools/resources/prompts.

4. Make scoped changes.
   - Add shared types in `core` only when more than one package needs the contract.
   - Add schemas at runtime boundaries: CLI args, HTTP requests, MCP tool inputs, config files.
   - Keep errors structured and diagnostics sanitized; never leak tokens.
   - Update docs when behavior, public surfaces, config, or workflow expectations change.

5. Validate.
   - Run the narrow test first, such as `bun test packages/topology` or `bun test apps/server`.
   - Run repo gates before finalizing: `bun run typecheck`, `bun run lint`, `bun test`.
   - For docs/skills changes, run `python skills/document-codebase/scripts/check_markdown_links.py .`.

## Common Skill Handoffs

- CLI command work: use `$add-cli-command`.
- HTTP route work: use `$add-http-route`.
- MCP tool work: use `$add-mcp-tool`.
- Build pipeline work: use `$change-build-pipeline`.
- Document or skill classification work: use `$change-doc-classification`.
