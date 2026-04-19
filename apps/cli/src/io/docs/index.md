# CLI IO Module

The IO module owns terminal-facing formatting helpers.

## Responsibilities

- Write human-readable info, warning, error, debug, and JSON output.
- Format simple tables for list and inspect surfaces.
- Ask prompts in interactive workflows.

## Invariants

IO helpers should not perform domain work. Commands prepare data and IO renders it according to quiet, verbose, or JSON output settings.
