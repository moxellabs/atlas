# Store Manifests Module

The manifests module persists source and build freshness state.

## Responsibilities

- Store indexed revisions.
- Store build metadata.
- Support freshness and changed-document inspection.

## Invariants

Manifest updates should reflect successful sync/build state. Failed builds must not overwrite the last good corpus state as if it were fresh.
