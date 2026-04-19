# Source Git Diff Module

The diff module computes and filters changed paths.

## Responsibilities

- Parse Git name-status style changes.
- Preserve raw and normalized change kinds.
- Filter changes to doc-relevant paths.

## Invariants

Diff output should preserve rename/copy evidence where available while normalizing to the shared change contract used by the indexer.
