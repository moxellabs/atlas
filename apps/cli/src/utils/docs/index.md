# CLI Utils Module

The CLI utils module contains small shared helpers used by commands and runtime code.

## Responsibilities

- CLI error types and exit-code mapping.
- Path helpers.
- Browser URL opening helper for `serve`.
- Built-in topology templates used by `init` and `repo add`.

## Topology Templates

Templates define repo docs, package docs, module docs, and skills. Root repo docs exclude `docs/archive/**/*.md` so archived implementation specs are not part of normal self-indexing results.
