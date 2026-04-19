# @atlas/compiler

Markdown compiler for ATLAS.

This package parses Markdown, extracts frontmatter, normalizes document text, builds canonical documents and sections, extracts code blocks, builds summaries/outlines, and extracts skill metadata.

## Runtime Role

- Converts classified source files into canonical ATLAS document artifacts.
- Preserves provenance inputs such as repo ID, source path, and source version.
- Produces stable section IDs and structured code block fragments.
- Emits compiler diagnostics and structured errors.
- Provides summary and outline builders consumed by the indexer.

## Public API

- `compileMarkdownDocument`
- `parseMarkdown`, `extractFrontmatter`, `normalizeMarkdown`
- `buildCanonicalDocument`, `buildSections`, `extractCodeBlocks`
- `buildOutline`, `buildDocSummary`, `buildModuleSummary`
- `extractSkill`
- `ATLAS_COMPILER_VERSION`
- Compiler diagnostic/error/types exports

## Development

```bash
bun --cwd packages/compiler run typecheck
bun test packages/compiler
```
