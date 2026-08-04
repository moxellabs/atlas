# MCP Tools Module

The tools module implements callable MCP operations over the local corpus.

## Responsibilities

- Find scopes and docs.
- Read outlines and sections.
- Expand related material.
- Explain modules.
- Browse, rank, and resolve portable skills.
- Plan context.

## Invariants

Tools should validate inputs, call retrieval/store dependencies, return structured JSON-compatible results, and preserve provenance.

`use_skill` is the portable agent-facing skill tool. With no skill or task it returns a compact scoped list. Exact IDs, titles, and `$atlas-*` aliases return complete source-backed instructions. Natural-language tasks resolve only when one deterministic lexical match is complete and clearly ahead; otherwise the tool returns compact candidates. Bundled scripts and references remain read-only artifacts, and Atlas never executes them.
