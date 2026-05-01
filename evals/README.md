# Retrieval eval workflow

Atlas retrieval evals live under `evals/` and exercise the local CLI against the Atlas corpus.

## Commands

Run from the repository root:

```sh
bun run eval
```

`eval` runs the full suite. Other scripts:

| Command | Notes |
| --- | --- |
| `bun run eval` | Full manifest → `evals/reports/` |
| `eval:quick` | Smoke subset → `/tmp` |
| `eval:ci` | Full suite + CI gates → `/tmp` (used in GitHub Actions) |
| `eval:baseline:update` | Refresh `evals/baseline/` after a reviewed full run |

Full-suite reports are written to:

- `evals/reports/mcp-retrieval-report.json`
- `evals/reports/mcp-retrieval-report.html`
- `evals/reports/mcp-retrieval-trend.jsonl` — one JSON line per local run for quick `jq`/graphing; gitignored with the rest of `evals/reports/`. Pass `--trend-log none` to disable, or `--trend-log <path>` to redirect.

The HTML report is a standalone Moxel-branded research page with embedded charts, color-coded health states, clickable `(i)` metric explainers, and a vanilla-JS case explorer. It needs no external CDN, React, or Vite. The JSON report is the machine-readable source for derived metrics such as expected-path precision/nDCG, rank buckets, latency buckets, weak cases, narrative findings, and per-metric deltas vs. the committed baseline.

These files are generated output and may change on every run because they include timestamps and runtime metadata. `evals/reports/` is ignored so local dashboard output is not committed accidentally.

## Dataset layout

- `evals/mcp-retrieval.dataset.json` - full public manifest.
- `evals/datasets/retrieval-smoke.json` - quick/smoke subset.
- `evals/datasets/*.json` - focused cases for profiles, MCP tools, CLI workflows, artifact runtime, security/privacy, diagnostics, and negative edge cases.
- `evals/baseline/mcp-retrieval-baseline.json` - committed baseline metrics that the HTML report compares against. Update with `bun run eval:baseline:update` after reviewing a run.
- `evals/reports/` - generated JSON/HTML reports and the local trend log. Gitignored.

Case IDs must be unique across the full manifest. Prefer stable path-substring and term expectations over generated IDs so cases survive corpus rebuilds.

## CI and publishing

The eval workflow runs on pull requests, manual dispatch, and pushes to `main`. It uploads the fresh `/tmp/atlas-eval-report` directory as a GitHub Actions artifact on successful report generation. On pushes to `main`, it also attempts to deploy that HTML report directory to GitHub Pages. If Pages is not enabled, use the Actions artifact as the published dashboard source.

Expected Pages URL when enabled:

```text
https://moxellabs.github.io/atlas/
```

See `docs/evals.md` for details on adding cases, interpreting metrics, CI thresholds, and baseline policy.
