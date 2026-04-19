# MCP Tools Module

The tools module implements callable MCP operations over the local corpus.

## Responsibilities

- Find scopes and docs.
- Read outlines and sections.
- Expand related material.
- Explain modules.
- List, fetch, and invoke portable skills.
- Report freshness.
- Plan context.
- Report changed documents.

## Invariants

Tools should validate inputs, call retrieval/store dependencies, return structured JSON-compatible results, and preserve provenance.

`use_skill` is the portable agent-facing skill invocation tool. It resolves `$atlas-*` aliases, returns source-backed instructions, and serves bundled scripts or references as read-only artifacts without executing them.
