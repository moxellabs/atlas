# Store Repos Module

The repos module persists repository topology records.

## Responsibilities

- Repo records.
- Package records.
- Module records.

## Invariants

Repo, package, and module records should preserve IDs and paths produced by topology discovery. Store repositories should not infer topology independently.
