# Retrieval eval workflow

Run the Atlas MCP retrieval evaluation from the repository root:

```sh
cd /home/mrmendez/Projects/atlas && bun tooling/scripts/mcp-retrieval-eval.ts
```

The same workflow is available through the package script:

```sh
bun run eval:retrieval
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
