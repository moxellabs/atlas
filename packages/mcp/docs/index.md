---
title: MCP Package
description: MCP tools, resources, prompts, transports, skill artifact access, and identity-aware aliases.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 240
---

# MCP Package

`@atlas/mcp` exposes Atlas corpus capabilities through Model Context Protocol tools, resources, prompts, and transports.

## Responsibilities

- Register retrieval-backed MCP tools.
- Register repo, package, module, document, skill, skill artifact, summary, and manifest resources.
- Register reusable grounding prompts.
- Create stdio and Streamable HTTP transports, including explicit stream binding for CLI-hosted stdio sessions.
- Map store and retrieval results into MCP-compatible payloads.
- Surface structured MCP validation, dependency, resource, and transport errors.
- Resolve portable `$atlas-*` skill aliases through `use_skill` without requiring agent-specific skill installation.

## MCP Identity

Default identity remains `atlas-mcp`, Atlas resource names, and `$atlas-*` skill aliases. Explicit identity knobs are `--atlas-mcp-name`, `ATLAS_MCP_NAME`, optional `ATLAS_MCP_TITLE`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`.

Identity changes server metadata, resource display names, and skill aliases. Generic MCP tool names remain stable (`find_docs`, `read_outline`, `read_section`, `plan_context`, `list_skills`, `use_skill`). The `atlas://` URI scheme remains stable.

## Protocol Surface

Tools expose query, scope, document, freshness, skill, context-planning, and diff operations with explicit schemas: `find_scopes`, `find_docs`, `read_outline`, `read_section`, `expand_related`, `explain_module`, `list_skills`, `get_skill`, `use_skill`, `get_freshness`, `plan_context`, and `what_changed`. Resources expose persisted corpus artifacts by stable identifiers: manifest, repo, package, module, document, skill, skill artifact, and summary. Prompts compose common grounding workflows such as onboarding, module explanation, local-doc answers, doc comparison, and skill usage explanation.

Transports are runtime adapters. Stdio and Streamable HTTP setup should stay protocol-focused and should receive explicit streams or HTTP primitives from the host runtime.

## Invariants

- Tool inputs should remain small, explicit, and JSON-compatible.
- MCP responses should include provenance and diagnostics where they help agents verify source truth.
- Normal retrieval, context-planning, skill, and resource calls read local store/retrieval dependencies only.
- Source diffs are available only through an explicit runtime-provided diff provider; MCP tools must not trigger sync/build or remote source acquisition.
- Missing dependencies or resources should fail as structured MCP errors.
- Skill resolution should return read-only source artifacts; installation into agent-specific directories is a CLI concern.

## Boundaries

MCP adapts package services to protocol surfaces. It should not implement retrieval ranking, source sync, document compilation, or store persistence directly.

## Tests

Primary coverage lives in `packages/mcp/src/mcp.test.ts`.

```bash
bun --cwd packages/mcp run typecheck
bun test packages/mcp
```

## Profile-aware context planning

MCP `find_docs` and `plan_context` accept profile, audience, purpose, and visibility filters. These filters are applied during retrieval planning so internal or archive docs are omitted from public-profile context.

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/mcp`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test packages/mcp/src/mcp.test.ts
```
