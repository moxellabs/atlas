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

Default MCP identity remains `atlas-mcp`, Atlas resource names, and `$atlas-*` skill aliases. Explicit identity knobs are `--atlas-mcp-name`, `ATLAS_MCP_NAME`, optional `ATLAS_MCP_TITLE`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`.

Identity changes server metadata, resource display names, and skill aliases. Generic MCP tool names remain stable (`find_docs`, `read_outline`, `read_section`, `plan_context`, `list_skills`, `use_skill`). The `atlas://` URI scheme remains stable.

## Implemented Tools

- `find_scopes`
- `find_docs`
- `read_outline`
- `read_section`
- `expand_related`
- `explain_module`
- `list_skills`
- `get_skill`
- `use_skill`
- `get_freshness`
- `plan_context` - returns selected evidence, human-readable scope labels, warnings, omissions, and next actions for answer-ready local context
- `what_changed`

## Implemented Resources

- `atlas://manifest` with local store-derived indexed repository coverage; agents should call plan_context before answering indexed-repository questions and Atlas performs no remote fetch for this discovery payload
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
