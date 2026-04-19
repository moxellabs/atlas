# Indexer Reports Module

The reports module creates structured sync and build reports.

## Responsibilities

- Summarize per-repo and batch operation status.
- Include timings, diagnostics, recovery state, stale state, counts, and next actions.
- Provide stable report shapes for CLI, server, tests, and MCP freshness surfaces.

## Invariants

Reports should be serializable and should not include secrets or raw credential data.
