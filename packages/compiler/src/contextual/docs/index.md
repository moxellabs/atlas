# Compiler Contextual Module

The contextual module builds local context strings used by retrieval and chunk presentation.

## Responsibilities

- Build contextual chunk headers from document, package, module, section, and heading metadata.

## Invariants

Context headers should be concise, deterministic, and derived from structured metadata rather than ad hoc string parsing at retrieval time.
