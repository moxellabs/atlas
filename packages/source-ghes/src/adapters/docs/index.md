# Source GHES Adapters Module

The adapters module implements GHES source access through the shared source adapter contract.

## Responsibilities

- Validate GHES repo config.
- Resolve revisions.
- List files from recursive trees.
- Read source files.
- Compute changed paths from compare data.

## Invariants

The adapter must refuse truncated tree listings as complete results. Outputs should preserve repo-relative paths and sanitized diagnostics.
