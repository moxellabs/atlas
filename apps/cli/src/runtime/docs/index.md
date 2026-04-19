# CLI Runtime Module

The runtime module owns argument parsing, dependency construction, and shared CLI execution types.

## Responsibilities

- Parse argv into command tokens, options, and global flags.
- Build dependencies from config, environment, store, source adapters, indexer, retrieval, and testkit.
- Resolve and mutate config targets.
- Define command context, command result, output options, and dependency types.

## Invariants

Runtime code should be deterministic for a given argv, cwd, and env input. It should not print directly; output belongs to IO helpers and command result emission.
