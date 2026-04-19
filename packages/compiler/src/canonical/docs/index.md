# Compiler Canonical Module

The canonical module builds Atlas document and section artifacts.

## Responsibilities

- Resolve document titles.
- Build canonical documents from classified docs and parsed Markdown.
- Build stable canonical sections.
- Extract code block fragments with language and location metadata.

## Invariants

Canonical IDs must remain stable for the same repo, path, and heading structure. Section ordering should preserve document order.
