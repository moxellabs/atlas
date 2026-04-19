# Compiler Parse Module

The parse module converts Markdown text into normalized compiler inputs.

## Responsibilities

- Parse Markdown into an AST.
- Extract frontmatter with validation diagnostics.
- Normalize Markdown blocks and node text.

## Invariants

Parsing should be deterministic for a given source string. Frontmatter errors should surface as structured compiler errors or diagnostics instead of silent data loss.
