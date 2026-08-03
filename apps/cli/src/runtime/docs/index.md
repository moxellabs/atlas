# CLI Runtime Module

The runtime module owns typed command inputs, dependency construction, and shared CLI execution types.

## Responsibilities

- Expose Commander-parsed positional arguments, command options, and global flags through `CliCommandContext`.
- Build dependencies from config, environment, store, source adapters, indexer, retrieval, and testkit.
- Resolve and mutate config targets.
- Define command context, command result, output options, and dependency types.

## Invariants

Runtime code should be deterministic for a given argv, cwd, and env input. It should not print directly; output belongs to IO helpers and command result emission.
