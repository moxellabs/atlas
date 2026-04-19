# Source Git Adapters Module

The adapters module implements the local Git source adapter.

## Responsibilities

- Resolve revisions.
- List source files.
- Read source file content.
- Return changed paths through the shared source adapter contract.

## Invariants

Adapter outputs should use repo-relative POSIX paths and should not expose local absolute cache paths in corpus records.
