# Indexer Sync Module

The sync module updates source revision state and changed path evidence.

## Responsibilities

- Sync one repo or all configured repos.
- Resolve source revisions.
- Compute source updates between indexed and current revisions.
- Preserve source diagnostics in sync reports.

## Invariants

Sync should not rebuild documents. It prepares freshness and diff evidence used by build planning.
