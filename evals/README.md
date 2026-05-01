# Retrieval eval workflow

Atlas retrieval evals live under `evals/` and exercise the local CLI against the Atlas corpus.

## Commands

Run from the repository root:

```sh
bun run eval
```

`eval` is the short full-suite command. The command set is:

```sh
bun run eval:quick      # retrieval-smoke subset; reports go to /tmp
bun run eval:full       # full manifest; writes evals/reports
bun run eval:report     # alias for full report generation
bun run eval:ci         # full report with conservative threshold gates
bun run eval:mcp        # preserved alias for full suite
bun run eval:retrieval  # preserved alias for full suite
```

Full-suite reports are written to:

- `evals/reports/mcp-retrieval-report.json`
- `evals/reports/mcp-retrieval-report.html`

These files are generated output and may change on every run because they include timestamps and runtime metadata. Restore them before committing unless a report snapshot update is intentional.

## Dataset layout

- `evals/mcp-retrieval.dataset.json` - full public manifest.
- `evals/datasets/retrieval-smoke.json` - quick/smoke subset.
- `evals/datasets/*.json` - focused cases for profiles, MCP tools, CLI workflows, artifact runtime, security/privacy, diagnostics, and negative edge cases.
- `evals/reports/` - generated JSON and HTML reports.

Case IDs must be unique across the full manifest. Prefer stable path-substring and term expectations over generated IDs so cases survive corpus rebuilds.

## CI and publishing

The eval workflow runs on pull requests, manual dispatch, and pushes to `main`. It uploads `evals/reports` as a GitHub Actions artifact on every run. On pushes to `main`, it also attempts to deploy the HTML report directory to GitHub Pages. If Pages is not enabled, use the Actions artifact as the published dashboard source.

Expected Pages URL when enabled:

```text
https://moxellabs.github.io/atlas/
```

See `docs/evals.md` for details on adding cases, interpreting metrics, CI thresholds, and baseline policy.
