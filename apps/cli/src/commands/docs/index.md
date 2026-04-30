# CLI Commands Module

The commands module owns concrete CLI workflows. Each command receives a `CliCommandContext`, parses command-specific options, delegates to package services, and returns a structured command result.

## Responsibilities

- Config workflows: `init` and `repo add`.
- Source and corpus workflows: `sync`, `build`, `clean`, and `prune`.
- Inspection workflows: `list`, `inspect`, and `doctor`.
- Runtime and quality workflows: `serve`, `mcp`, and `eval`.
- Agent/editor workflow: `install-skill`.

## Command Contract

Each command module should:

- parse only the flags and positional arguments it owns;
- use shared runtime dependencies instead of opening config, stores, or source adapters directly when a helper already exists;
- return a structured `CliCommandResult` with stable command names and data shapes;
- map domain errors to `CliError` only at the CLI boundary; and
- leave human/JSON formatting to the IO layer.

Commands that mutate config or corpus state should make the changed scope explicit in their result data. Commands that only inspect state should avoid side effects beyond normal reads.

## Invariants

Commands should keep terminal concerns separate from package behavior. They should validate user input before calling services and return stable exit codes through shared CLI error utilities.

Unknown commands, invalid selectors, and unsupported flag combinations should fail before package services are invoked. Verbose and JSON modes should preserve enough structured detail for agents and tests to diagnose failures.

## Tests

`apps/cli/src/cli.test.ts` is the primary integration surface. Command tests should cover human output, JSON output when supported, exit codes, invalid input, and the package-service delegation path for any command that mutates source, config, or corpus state.
