# Indexer Services Module

The services module wires indexer dependencies.

## Responsibilities

- Construct source adapters.
- Construct store repositories.
- Build topology snapshots.
- Expose the indexer service used by CLI and server apps.

## Invariants

Dependency wiring should be explicit. Source diagnostics should flow into operation reports without coupling adapters to CLI or server output.
