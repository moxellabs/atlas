# @atlas/store

SQLite persistence layer for ATLAS.

This package owns the local corpus database client, migrations, pragmas, repositories, FTS maintenance, and search helpers.

## Runtime Role

- Opens and migrates a local SQLite database.
- Persists repos, packages, modules, manifests, canonical docs, sections, chunks, summaries, and skills.
- Maintains FTS rows for searchable artifacts.
- Provides lexical, path, and scope search helpers.
- Exposes store diagnostics for health, doctor, and inspect surfaces.

## Public API

- Store lifecycle: `openStore`, `AtlasStoreClient`, migrations, pragmas, diagnostics.
- Repositories: repo, package, module, manifest, doc, section, chunk, summary, skill.
- Search: `lexicalSearch`, `pathSearch`, `scopeSearch`.
- Store record/input types and structured store errors.

## Development

```bash
bun --cwd packages/store run typecheck
bun test packages/store
```
