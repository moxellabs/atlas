---
name: add-cli-command
description: Add or modify an Atlas CLI command. Use when an agent needs to change apps/cli command behavior, argument parsing, human or JSON output, exit codes, command help, config mutation workflows, sync/build/list/inspect/doctor/eval flows, or CLI tests.
---

# Add CLI Command

Use this skill for changes under `apps/cli`. The CLI is an operator shell over package services, not a place for source, build, retrieval, or storage internals.

## Workflow

1. Find the command boundary.
   - Entrypoint and dispatch: `apps/cli/src/index.ts`.
   - Command modules: `apps/cli/src/commands/*.command.ts`.
   - Args parsing: `apps/cli/src/runtime/args.ts`.
   - Dependency wiring: `apps/cli/src/runtime/dependencies.ts`.
   - Output helpers: `apps/cli/src/io/*`.
   - Errors and exit codes: `apps/cli/src/utils/errors.ts`.

2. Keep the CLI thin.
   - Parse flags and validate user intent in the command module.
   - Call package services for real behavior.
   - Return `CliCommandResult` values instead of printing from domain logic.
   - Support JSON output for automation when the command returns structured data.

3. Preserve command semantics.
   - Unknown or invalid input should map to stable CLI errors and exit codes.
   - Human output should be concise; JSON output should be machine-readable and stable.
   - Config mutations should go through config helpers and preserve existing config shape.

4. Test the workflow.
   - Add or update coverage in `apps/cli/src/cli.test.ts`.
   - Cover success, invalid input, JSON mode, and any config/store side effects.
   - Run `bun test apps/cli`, then repo gates when behavior is public.

## Boundaries

- Do not query SQLite directly from commands if a store service/repository already exists.
- Do not implement indexer, retrieval, source, topology, compiler, tokenizer, or MCP behavior inline.
- Do not print secrets or credential values in doctor/config flows.
