# @atlas/mcp

MCP surface for the local ATLAS corpus.

This package registers ATLAS tools, resources, prompts, metadata, and transports around store and retrieval dependencies.

## Runtime Role

- Exposes retrieval-backed MCP tools, including one-call context planning optimized for agent use.
- Exposes manifest/repo/package/module/document/skill/skill-artifact resources.
- Resolves portable `$atlas-*` skill aliases for MCP-capable agents.
- Registers reusable grounding prompts.
- Creates stdio and Streamable HTTP transports, including explicit stream binding for CLI-hosted stdio sessions.
- Is mounted by `apps/server` at `/mcp`.

## MCP identity

Default MCP identity remains `atlas-mcp`, Atlas resource names, and `$atlas-*` skill aliases. The documented identity override knobs are:

- CLI: `--atlas-mcp-name`
- Environment: `ATLAS_MCP_NAME`
- Optional title environment variable: `ATLAS_MCP_TITLE`
- Config: `identity.mcp.name`, `identity.mcp.title`, and `identity.mcp.resourcePrefix`

Identity changes server metadata, resource display names, and skill aliases. Generic MCP tool names remain stable. The `atlas://` URI scheme remains stable.

## Implemented tools

The default `agent` profile advertises five generic tools plus one source-named answer facade:

- `plan_context` builds one token-budgeted, deduplicated evidence packet. It accepts exact repository, package, and module constraints and reports freshness, coverage, citations, omissions, and the next action.
- `search_passages` searches indexed content by natural-language query and returns ranked, answer-bearing previews.
- `read_document` opens a known `docId` as a compact outline or one exact section selected by `sectionId` or heading path; it does not search.
- `expand_related` follows a stable retrieved ID to nearby documents, sections, summaries, and skills. An optional `query` ranks related documents for the one missing claim.
- `use_skill` browses stored skills and resolves exact or unambiguous task matches into complete instructions, provenance, and read-only artifacts.
- `answer_<source>_docs` returns the single strongest passage for a broad question about one named indexed source.

The primary source facade carries `anthropic/alwaysLoad`; `plan_context` and additional advanced-profile facades remain discoverable without forced preload. Every tool publishes a concrete output schema and explicit next-action guidance. Source facades return one decisive passage directly; use `plan_context` when an answer genuinely needs a multi-passage evidence packet.

The `advanced` profile adds `find_scopes`, may advertise up to 12 configured source facades, and exposes the addressable resources below for explicit inspection after a retrieval tool returns a stable identifier. Select it with `atlas mcp --tool-profile advanced` or `ATLAS_MCP_TOOL_PROFILE=advanced` for the HTTP server. The default profile advertises one configured source facade and no resources, preventing clients from treating resource traversal as a substitute search graph.

## Implemented Resources

- `atlas://manifest` with local store-derived indexed repository coverage for explicit advanced-profile inspection; Atlas performs no remote fetch for this payload
- `atlas://repo/{repoId}` with package, module, document, skill, summary, manifest, and freshness context
- `atlas://package/{packageId}` with package-scoped modules, documents, skills, summaries, and repo context
- `atlas://module/{moduleId}` with module-scoped documents, skills, summaries, package, and repo context
- `atlas://document/{docId}`
- `atlas://skill/{skillId}` with source document metadata, summaries, outline, artifacts, and provenance
- `atlas://skill-artifact/{skillId}/{artifactPath}` for read-only skill scripts, references, and agent profiles
- `atlas://summary/{summaryId}`

## Implemented Prompts

- `answer_from_local_docs`
- `onboard_to_module`
- `onboard_to_repo`
- `summarize_module`
- `compare_docs`
- `explain_skill_usage`

## Development

```bash
bun --cwd packages/mcp run typecheck
bun test packages/mcp
```

## Documentation

Indexed package docs live in `packages/mcp/docs/`. Module-local docs live under `packages/mcp/src/*/docs/`.

## Local imported corpus

MCP uses local imported corpus data from `~/.moxel/atlas/corpus.db`. Tools and resources do not fetch remote source at query time.
