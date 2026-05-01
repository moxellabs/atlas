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
- It has an optional model-judge metadata slot for a later answer-quality pass; setting model env vars records intent only and does not call a model today.

## Local commands

From this repo checkout with `.moxel/atlas/corpus.db` present:

```bash
bun run eval
```

`bun run eval` is intentionally the short memorable command and currently runs the full retrieval/MCP manifest. More explicit commands are available:

```bash
bun run eval:quick      # focused retrieval-smoke subset; writes reports under /tmp
bun run eval:full       # full manifest; writes evals/reports/*.json and *.html
bun run eval:report     # alias for the full report generation path
bun run eval:ci         # full report plus conservative threshold gates; writes reports under /tmp
bun run eval:mcp        # preserved alias for full suite
bun run eval:retrieval  # preserved alias for full suite
```

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
- `expected.tools`: intended MCP tools for the scenario. These are scenario annotations today; the deterministic retrieval harness does not execute MCP tool calls yet. They can be used by future agent-trace evals.

Path-substring expectations are used instead of generated document IDs so the suite survives corpus rebuilds.

## Adding or changing cases

1. Pick the narrowest focused file under `evals/datasets/`, or add a new focused dataset and include it from `evals/mcp-retrieval.dataset.json`.
2. Add a stable `id`, useful `category`, query text, and deterministic expectations.
3. Prefer path and term expectations tied to public docs or public skills that should remain discoverable.
4. Add profile/feature/scenario/priority metadata when the case represents a user workflow or product surface.
5. Run `bun run eval:quick` for smoke coverage when relevant, then `bun run eval:full` or `bun run eval:report` before opening a PR.
6. Generated files under `evals/reports/` are ignored; do not force-add them unless an intentionally reviewed snapshot policy is introduced.

## Interpreting metrics

- Pass rate: fraction of cases that passed every deterministic expectation. This is a gate, not the main public claim.
- Path recall: fraction of expected path substrings found in the top retrieved paths considered by the case.
- Path Recall@1 / @3 / @5: fraction of expected source paths that appear in the top 1, 3, or 5 retrieved paths. These are the main ranking-quality signals for whether the right evidence is near the top.
- Expected-path Precision@1 / @3 / @5: lower-bound proportion of top-k paths matching sparse expected labels. It is not true relevance precision because unlabeled but relevant docs can exist.
- Expected-path nDCG@3 / @5: rank-sensitive binary relevance over the sparse expected path labels. Use it to compare whether known-good evidence moves earlier in the result list.
- MRR: mean reciprocal rank of the first expected source path. Higher values mean expected evidence appears earlier.
- Term recall: fraction of expected terms found in selected/ranked context payloads plus local source contents for retrieved paths.
- No-result accuracy: fraction of no-result expectations that correctly abstained from returning ranked/selected evidence.
- Forbidden-path accuracy: fraction of cases where excluded paths were not retrieved.
- Non-empty context rate: fraction of cases where Atlas produced selected or ranked retrieval context. No-result cases can still pass when they explicitly expect no results.
- Median and P95 latency: wall-clock CLI query time per case.
- Average ranked hits: mean ranked hit count.

The report also groups metrics by category, profile, feature, scenario, capability, risk area, priority, and coverage type so regressions can be mapped back to user workflows. The coverage heatmap is quality-first: weak Recall@5/MRR groups sort before high-count groups. Case priority is preserved per case in the explorer.

A 100% pass rate can coexist with ranking headroom. Pass rate says deterministic gates were satisfied somewhere in the retrieved evidence; Recall@k, MRR, expected-path precision, and nDCG say how early known-good evidence appears. Treat perfect pass rate plus low Recall@1/Recall@5 as a successful safety/coverage run with ranking work still available.

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

`.github/workflows/evals.yml` runs on pull requests, manual dispatch, and pushes to `main`. The workflow:

1. Sets up Bun 1.3.11.
2. Installs with `bun install --frozen-lockfile`.
3. Runs `bun run eval:ci`.
4. Uploads `/tmp/atlas-eval-report` as the `atlas-eval-reports` GitHub Actions artifact when the report exists.
5. On pushes to `main`, uploads the same fresh report directory as a GitHub Pages artifact and deploys it with the standard Pages actions.

If GitHub Pages has not been enabled for the repository, the Actions artifact is still the source of truth for the latest dashboard. When Pages is enabled, the workflow copies `mcp-retrieval-report.html` to `index.html`, so the latest dashboard is expected at:

```text
https://moxellabs.github.io/atlas/
```

## Threshold and baseline policy

The current policy intentionally avoids committing new generated report snapshots or a generated `baseline.json` in this batch. The eval corpus is still expanding, so trend/baseline comparison can be added later once the manifest and runtime environment are more stable.

CI uses conservative fail gates focused on preventing obvious broken-corpus and no-result regressions:

```text
min pass rate: 0.95
min path recall: 0.90
min term recall: 0.90
min non-empty context rate: 0.90
```

These thresholds are not meant to freeze every ranking detail. They are guardrails that should catch missing corpora, empty retrieval responses, broad expectation failures, and major recall regressions while allowing the dataset to grow. If a new valid case lowers aggregate metrics, adjust the case expectations or thresholds in the same PR and explain why.

## Optional model judge placeholder

Retrieval metrics run without API keys. To annotate reports with the intended cheap judge model:

```bash
ATLAS_EVAL_MODEL_PROVIDER=openrouter \
ATLAS_EVAL_MODEL=x-ai/grok-code-fast-1 \
  bun run eval:report
```

This records the intended judge configuration in the report but does not call the model yet.

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
