# Indexer Incremental Module

The incremental module decides what needs to rebuild.

## Responsibilities

- Plan noop, full, incremental, and targeted builds.
- Collect affected docs from topology snapshots and changed paths.
- Detect deleted stored docs.
- Respect build selectors for doc, package, or module targets.

## Invariants

Planning should be deterministic for the same manifest, topology, source updates, and selector inputs.
