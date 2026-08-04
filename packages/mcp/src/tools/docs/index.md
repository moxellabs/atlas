# MCP Tools Module

The tools module implements callable MCP operations over the local corpus.

## Responsibilities

- Plan broad, ambiguous, comparative, and module-scoped context under one evidence budget.
- Find precise document, section, chunk, or skill hits.
- Read a document outline or one exact section.
- Expand related material from stable result IDs.
- Browse, rank, and resolve portable skills.
- Expose scope inference only in the advanced profile.

## Invariants

Tools validate inputs, call retrieval or store dependencies, return structured JSON-compatible results, preserve provenance, publish concrete output schemas, and state whether the caller should answer, refine once, or fall back externally.

`use_skill` is the portable agent-facing skill tool. With no skill or task it returns a compact scoped list. Exact IDs, titles, and `$atlas-*` aliases return complete source-backed instructions. Natural-language tasks resolve only when one deterministic lexical match is complete and clearly ahead; otherwise the tool returns compact candidates. Bundled scripts and references remain read-only artifacts, and Atlas never executes them.
