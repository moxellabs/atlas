---
title: MCP Package
description: MCP tools, resources, prompts, transports, skill artifact access, and identity-aware aliases.
audience: [consumer, contributor, maintainer]
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

Identity changes server metadata, resource display names, and skill aliases. Generic MCP tool names remain stable, and the `atlas://` URI scheme does not change.

## Protocol surface

The default `agent` profile exposes `plan_context`, `search_passages`, `read_document`, `expand_related`, `use_skill`, and one `answer_<source>_docs` facade. `plan_context` and the primary source facade are eagerly advertised through `anthropic/alwaysLoad`; additional advanced-profile facades remain discoverable without forced preload. All tools publish concrete output schemas.

`search_passages` discovers precise evidence from a natural-language query. `read_document` does not search; it opens a known `docId` as an outline or exact section. `plan_context` handles module explanations through exact scope constraints and returns one deduplicated evidence packet under one token budget. Retrieval results include explicit next-action guidance so clients can answer immediately, refine once, or use external fallback without restarting broad retrieval. `use_skill` handles browsing, exact resolution, and deterministic task matching.

The `advanced` profile adds `find_scopes` and exposes up to 12 configured source facades. The CLI selects it with `--tool-profile advanced`; the HTTP server uses `ATLAS_MCP_TOOL_PROFILE=advanced`. Resources expose persisted corpus artifacts by stable identifier. Prompts cover onboarding, module summaries, local-document answers, document comparison, and skill usage.

Transports are runtime adapters. Stdio and Streamable HTTP setup should stay protocol-focused and should receive explicit streams or HTTP primitives from the host runtime.

## Invariants

- Tool inputs should remain small, explicit, and JSON-compatible.
- MCP responses should include provenance and diagnostics where they help agents verify source truth.
- Normal retrieval, context-planning, skill, and resource calls read local store/retrieval dependencies only.
- Runtime lifecycle state may be included in `plan_context`, but an MCP tool call must not trigger sync, build, or remote source acquisition.
- Missing dependencies or resources should fail as structured MCP errors.
- Skill resolution should return read-only source artifacts; installation into agent-specific directories is a CLI concern.

## Boundaries

MCP adapts package services to protocol surfaces. It should not implement retrieval ranking, source sync, document compilation, or store persistence directly.

## Tests

Primary coverage is split by protocol domain under `packages/mcp/src/mcp.*.test.ts`, backed by `mcp.test-fixtures.ts`.

```bash
bun --cwd packages/mcp run typecheck
bun test packages/mcp
```

## Profile-aware context planning

MCP `search_passages` and `plan_context` accept profile, audience, purpose, and visibility filters. These filters are applied during retrieval planning so internal or archive docs are omitted from public-profile context.

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/mcp`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test packages/mcp
```
