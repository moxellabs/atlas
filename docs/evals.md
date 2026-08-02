---
title: Atlas MCP and Retrieval Evals
description: Deterministic MCP/retrieval evaluation workflow with publishable stats and charts.
audience: [maintainer, contributor]
purpose: [workflow, reference]
visibility: public
order: 90
---

# Atlas MCP and Retrieval Evals

Atlas keeps a lightweight evaluation harness for MCP and retrieval performance under `evals/`. It is local-first, deterministic, and cheap by default:

- It runs against the local Atlas CLI and prefers the repo-local `.moxel/atlas/corpus.db` artifact when present.
- It does not require model API keys for retrieval metrics.
- It emits JSON plus a standalone HTML evaluation report organized around capability claims, coverage, rank-aware retrieval metrics, representative cases, methodology, and limitations.
- It has a separate local-only Luna agent-effect benchmark for answer quality and Atlas MCP usefulness. It is intentionally not part of CI.

## Local commands

From this repo checkout with `.moxel/atlas/corpus.db` present:

```bash
bun run eval
```

What to run locally:

| Command                                            | When                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bun run eval` or `bun run eval:full`              | Default: full MCP/retrieval manifest; writes `evals/reports/*.json` and `*.html` (same underlying script).            |
| `bun run eval:quick`                               | Fast smoke subset; reports under `/tmp`.                                                                              |
| `bun run eval:ci`                                  | Same dataset as full, plus CI thresholds; writes under `/tmp` (GitHub Actions uses this).                             |
| `bun run eval:baseline:update`                     | After reviewing a full run: promote metrics into `evals/baseline/`.                                                   |
| `bun run eval:luna`                                | Run the local Luna paired benchmark and write ignored output under `/tmp`. Requires an authenticated local Codex CLI. |
| `bun run eval:luna:smoke`                          | Run three gated Diffract trials with normal competing tools against an isolated corpus snapshot.                      |
| `bun run eval:luna:competitive`                    | Alias for `eval:luna:smoke`.                                                                                          |
| `bun run eval:luna:release -- --release-id vX.Y.Z` | Run the full local benchmark and write a sanitized, versioned release snapshot under `evals/history/luna/`.           |
| `bun run eval:release:dashboard`                   | Compose a release dashboard from the current deterministic report and the newest compatible Luna snapshot.            |

Default full-suite outputs:

```text
evals/reports/mcp-retrieval-report.json
evals/reports/mcp-retrieval-report.html
```

The generated reports include timestamps, runtime paths, revision details, and per-run metrics. They may change whenever the eval is re-run. The `evals/reports/` directory is ignored so generated local dashboards are not committed accidentally.

## Dataset layout

The full-suite manifest lives at:

```text
evals/mcp-retrieval.dataset.json
```

It includes focused datasets from:

```text
evals/datasets/
```

The smoke subset used by `eval:quick` is `evals/datasets/retrieval-smoke.json`.

Each case contains:

- `id`: stable case identifier, unique across the loaded manifest and included datasets.
- `category`: report grouping used in charts and tables.
- `query`: natural-language or keyword query passed to `atlas inspect retrieval`.
- Optional metadata: `profile`, `feature`, `scenario`, and `priority`; these flow into JSON reports for filtering and public analysis.
- Public-report metadata: `capability`, `claim`, `whyItMatters`, `expectedBehavior`, `coverageType`, and `riskArea`; these explain what the case is asserting and why the result matters to a reader.
- `expected.pathIncludes`: path substrings that should appear in top retrieval results.
- `expected.pathExcludes`: path substrings that must not appear in top retrieval results, useful for negative/edge cases.
- `expected.terms`: terms expected somewhere in selected/ranked context payloads or retrieved local source text.
- `expected.minRankedHits` / `expected.maxRankedHits`: ranked-hit count bounds.
- `expected.confidence`, `expected.diagnosticsInclude`, and `expected.noResults`: deterministic checks for diagnostics, confidence, and no-result behavior.
- `expected.tools`: intended MCP tools for the scenario. They remain annotations for the deterministic retrieval harness; actual MCP calls are measured separately by the Luna agent-effect suite.

Path-substring expectations are used instead of generated document IDs so the suite survives corpus rebuilds.

## Local Luna agent-effect benchmark

`evals/datasets/luna-agent-effect.json` is the full human-authored paired benchmark; `evals/datasets/luna-agent-discovery-smoke.json` is the focused Diffract discovery case. Both use versioned scoring criteria tied to evidence paths. The runner is source-neutral: the indexed source is defined by the dataset, while Codex runs from a separate consumer workspace that does not expose the source checkout. A full or discovery run executes three paired trials per task:

- **Baseline** — Codex without Atlas MCP.
- **Treatment** — the identical Codex configuration plus Atlas MCP over a read-only corpus snapshot containing only the dataset repository.

Both arms use `gpt-5.6-luna` with high effort. The task prompt never names Atlas, MCP, local documentation, retrieval, or a tool. The treatment MCP namespace derives its source suffix from the dataset repository ID so Codex can see which indexed source the namespace covers without prompt instructions. MCP startup failures are tracked separately from a completed treatment run with no Atlas use; lack of adoption is an outcome, not an infrastructure success. Adoption, Atlas-first ordering, local-only completion, and fallback attribution use successful evidence calls; failed attempts remain visible in traces but cannot be the answer's source. Protocol errors, answer completion, grounding, citations, unsupported claims, and abstention are also measured from actual runs. A separate anonymous Luna judge grades both answers against the human-authored criteria and judge-only corpus evidence.

The runner uses ephemeral Codex configuration and never calls `codex mcp add`, modifies user configuration, or runs in CI. Its default consumer workspace is empty. Both arms ignore user/project rules and configuration, receive isolated `HOME`/XDG directories with GitHub tokens cleared, disable account-linked apps, plugins, and browser surfaces, and cannot read outside the per-run workspace. The smoke command exposes the same unauthenticated web, shell, and filesystem capabilities to both arms while preserving those boundaries; `--competitive-tools` enables this mode for custom invocations. The treatment receives a read-only snapshot of the selected indexed repository, and its source-specific Atlas namespace is advertised eagerly rather than hidden behind deferred tool search. Neither arm receives the source checkout or authenticated GitHub access. Successful and failed evidence-capable activity from Atlas, web, shell, filesystem, and GitHub is recorded for both arms. Raw Codex JSONL remains local; committed release snapshots contain bounded final answers, citations, judge outcomes, provenance digests, and trace summaries only.

## Adding or changing cases

1. Pick the narrowest focused file under `evals/datasets/`, or add a new focused dataset and include it from `evals/mcp-retrieval.dataset.json`.
2. Add a stable `id`, useful `category`, query text, and deterministic expectations.
3. Prefer path and term expectations tied to public docs or public skills that should remain discoverable.
4. Add profile/feature/scenario/priority metadata when the case represents a user workflow or product surface.
5. Run `bun run eval:quick` for smoke coverage when relevant, then `bun run eval` before opening a PR.
6. Generated files under `evals/reports/` are ignored; do not force-add them unless an intentionally reviewed snapshot policy is introduced.

## Interpreting metrics

Every metric has a clickable `(i)` button in the HTML report that expands a plain-English definition, interpretation, and target bands. The same definitions are kept here for search/context.

- **Pass rate** — fraction of cases that passed every deterministic expectation. Safety/coverage gate, not the ranking claim.
- **Path recall** — fraction of expected path substrings present anywhere in the top retrieved paths. Coarse, rank-insensitive.
- **Recall@1 / @3 / @5** — fraction of expected source paths that appear in the top 1/3/5 retrieved paths. Main rank-quality signals.
- **Expected-path Precision@1 / @3 / @5** — lower-bound proportion of top-k paths that match sparse expected labels. Not true precision; unlabeled relevant docs can exist.
- **Expected-path nDCG@3 / @5** — rank-sensitive binary relevance over the sparse expected-path labels.
- **MRR** — mean reciprocal rank of the first expected source path. Higher = expected evidence appears earlier.
- **Rank distance** — per-case `bestExpectedPathRank − 1`, averaged across cases with a labeled expected path. Lower is better; 0 means first labeled hit landed at rank 1 every time.
- **Top-path diversity** — distinct parent directory count across the top-5 retrieved paths per case. Low values flag cases where the window is dominated by one directory.
- **Term recall** — fraction of expected terms found in selected/ranked context and in local source contents of retrieved paths.
- **Abstain (no-result) accuracy** — fraction of no-result expectations that correctly abstained from returning any hits.
- **Forbidden-path accuracy** — fraction of cases where excluded paths were not retrieved. Safety regression indicator.
- **Non-empty context rate** — fraction of cases where Atlas produced selected or ranked retrieval context. Expected-no-result cases still count as non-empty-correct when they abstain.
- **Median / p95 latency** — wall-clock CLI query time per case. Includes CLI spawn cost.
- **Average ranked hits** — mean ranked-hit count per case.

The report groups metrics by category, profile, feature, scenario, capability, risk area, priority, and coverage type so regressions can be mapped back to user workflows. The coverage heatmap is quality-first: weak Recall@5 / MRR / pass groups sort before high-count groups and inherit a color state. Case priority is preserved per case in the explorer.

A 100% pass rate can coexist with ranking headroom. Pass rate says deterministic gates were satisfied somewhere in the retrieved evidence; Recall@k, MRR, rank distance, expected-path precision, and nDCG say how early known-good evidence appears. Treat perfect pass rate with low Recall@1 / Recall@5 as a successful safety/coverage run with ranking work still available — and expect the report to mark it as `NEEDS WORK`, not `PASSING`, until ranking closes the gap.

### Color legend

The HTML report is color-coded so glances at charts and cards carry signal:

- `good` — green/mint. The metric is at or above its healthy band.
- `warn` — amber. The metric is in the warn band; regressions here become red.
- `bad` — red. The metric is below the warn floor and is calling for attention.

The top-right status pill summarizes the run as `PASSING`, `NEEDS WORK`, or `BROKEN` by rolling up the worst per-metric health. `GATED FAIL` still applies when any CI gate fails. KPI cards, bar tracks, radar axes, bucket bars, coverage tiles, and ranking-worklist tags all carry a `data-health` attribute that drives the palette so the source of a red verdict is discoverable by scanning.

Target bands live in source in `HEALTH_THRESHOLDS` inside [`tooling/scripts/eval-reporting.ts`](../tooling/scripts/eval-reporting.ts). Changing a band requires changing that file and its test coverage.

## Public report structure

The HTML report is intentionally claims-first rather than pass-rate-first. It includes:

- An executive summary of what Atlas retrieval/MCP behavior is being evaluated.
- A definition of the eval unit: one user-like query against `atlas inspect retrieval` with deterministic expectations.
- Capability claims and evidence, tying each feature group to cases, Recall@5, MRR, term recall, and why the workflow matters.
- Coverage tables for capabilities, priorities, risk areas, and coverage types.
- Representative passing cases and hardest passing cases, so a 100% pass run still shows concrete evidence and weak spots.
- Failures/regressions with missing paths, missing terms, excluded-path violations, diagnostics, and top retrieved paths.
- Methodology, metric definitions, limitations, and reproducibility metadata.

The goal is to make the public page read like a lightweight research/benchmark report: what claim is being tested, what evidence supports it, what metric was used, what is not covered yet, and how to reproduce the run.

## Publishing and CI behavior

`.github/workflows/evals.yml` runs on pull requests, manual dispatch, pushes to `main`, and version tags. The workflow:

1. Sets up Bun 1.3.11.
2. Installs with `bun install --frozen-lockfile`.
3. Runs `bun run eval:ci`.
4. Uploads `/tmp/atlas-eval-report` as the `atlas-eval-reports` GitHub Actions artifact when the report exists.
5. On version tags, composes the deterministic report with the newest compatible committed Luna snapshot and deploys it with the standard Pages actions.

Pull requests and `main` never invoke subscription-backed model inference and do not deploy Pages. A tag with no matching Luna snapshot still publishes the current deterministic report; every Luna panel is explicitly marked **stale** with its evaluated revision/date, or **not collected** when no compatible snapshot exists. The page never substitutes demo values.

If GitHub Pages has not been enabled for the repository, the Actions artifact is still the source of truth for the latest deterministic report. When Pages is enabled, the release dashboard is expected at:

```text
https://moxellabs.github.io/atlas/
```

## Threshold and baseline policy

CI uses both correctness gates and ranking/latency gates so regressions that survive the pass-rate check still fail the build:

```text
--min-pass-rate 0.98
--min-path-recall 0.90
--min-term-recall 0.90
--min-non-empty-context-rate 0.90
--min-recall-at-5 0.50
--min-mrr 0.25
--min-no-result-accuracy 0.95
--min-forbidden-path-accuracy 1.0
--max-p95-latency-ms 1500
```

All of those are exposed as CLI flags on `tooling/scripts/mcp-retrieval-eval.ts` and can be tightened per-run. `--max-average-latency-ms`, `--min-recall-at-1`, `--min-recall-at-3`, and `--max-metric-regression` are also available when you want a stricter run. The reasoning:

- `--min-pass-rate 0.98` — a single broken case fails CI immediately.
- `--min-recall-at-5 0.50` + `--min-mrr 0.25` — ranking regressions fail CI, not just corpus regressions.
- `--min-forbidden-path-accuracy 1.0` — safety leaks are never tolerated.
- `--max-p95-latency-ms 1500` — catches tail-heavy slowdowns; median is typically much lower.
- `--max-metric-regression 0.10` (opt-in) — fails CI when any tracked metric falls more than 10 percentage points below the committed baseline.

### Baseline and trend

A committed baseline at [`evals/baseline/mcp-retrieval-baseline.json`](../evals/baseline/mcp-retrieval-baseline.json) carries the metric values we expect this dataset + corpus to hit. The HTML report surfaces per-metric deltas vs. the baseline on each KPI card. To promote the current run into the baseline after reviewing it:

```bash
bun run eval:baseline:update
```

A per-run trend log is appended locally to `evals/reports/mcp-retrieval-trend.jsonl` (gitignored with the rest of `evals/reports/`) for local `jq`/graphing. Pass `--trend-log none` to disable it; `eval:ci` disables it by default since CI already uploads a full report artifact.

If a new valid case lowers aggregate metrics, adjust the case expectations or thresholds in the same PR and explain why.

## Luna history and freshness

Release snapshots live in `evals/history/luna/` and are append-only by release ID. A snapshot is **fresh** when it was evaluated against the release source, allowing only the history-only commit that records the evidence. Otherwise the dashboard may display it as **stale**, never as current evidence. Trend comparisons use only snapshots with the same task-suite digest, model, and reasoning effort; a single compatible snapshot is shown as one observation, not a fabricated trend.

## Custom paths

```bash
bun tooling/scripts/mcp-retrieval-eval.ts \
  --dataset evals/mcp-retrieval.dataset.json \
  --out evals/reports/mcp-retrieval-report.json \
  --html evals/reports/mcp-retrieval-report.html
```

Evaluate an installed `atlas` binary rather than the source checkout CLI:

```bash
bun tooling/scripts/mcp-retrieval-eval.ts --cli atlas
```

Evaluate a user-home imported corpus instead of the repo-local artifact:

```bash
bun tooling/scripts/mcp-retrieval-eval.ts --global
```

Evaluate a specific runtime config:

```bash
bun tooling/scripts/mcp-retrieval-eval.ts --config ~/.moxel/atlas/config.yaml
```

The harness inspects the repo before scoring and fails fast when the corpus has fewer than 10 docs. Use `--min-docs 0` only for intentionally tiny fixtures.

## Research notes

Before building a custom harness, we checked reusable open-source options:

- MCPBench is the closest MCP-specific benchmark. It evaluates MCP servers for task completion, latency, and token consumption, but its shipped tasks focus on web search, database query, and GAIA-style agents rather than local documentation retrieval. Atlas borrows the task-completion framing, not the whole framework.
- Promptfoo is a strong general LLM eval runner with a polished viewer and provider comparison. It is a good future export target for model-vs-model comparisons, but would add more setup than needed for deterministic retrieval metrics.
- Ragas and DeepEval are mature RAG eval frameworks with LLM-based metrics. They are useful once Atlas has generated answers to grade, but they add Python dependencies and judge-model costs. Atlas starts with deterministic retrieval stats first.
