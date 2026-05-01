# Retrieval eval workflow

Run the Atlas MCP retrieval evaluation from the repository root:

```sh
bun run eval
```

This prints a terminal summary with pass count, recall metrics, non-empty context rate, and per-case failures. The longer aliases are also available:

```sh
bun run eval:retrieval
bun run eval:mcp
```

Generated reports are written to:

- `evals/reports/mcp-retrieval-report.json`
- `evals/reports/mcp-retrieval-report.html`

Baseline observed metrics for Phase 0:

- passed: 0/8
- pathRecall: 0.125
- termRecall: 0.0833
- nonEmptyContextRate: 0.375

The generated reports may change when the eval is re-run. Commit report changes only when they are intentional.
