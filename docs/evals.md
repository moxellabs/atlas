---
title: Atlas MCP and Retrieval Evals
description: Deterministic MCP/retrieval evaluation workflow with publishable stats and charts.
audience: [maintainer, contributor]
purpose: [workflow, reference]
visibility: public
order: 90
---

# Atlas MCP and Retrieval Evals

Atlas keeps a lightweight evaluation harness for MCP and retrieval performance under `evals/`.

The harness is intentionally local-first and cheap by default:

- It runs against the local Atlas CLI and imported corpus.
- It does not require model API keys for retrieval metrics.
- It emits JSON plus a standalone HTML report with summary cards, bar charts, category breakdowns, and case-level tables.
- It leaves an optional model-judge slot for later answer-quality grading with a cheap model such as `grok-code-fast-1` through OpenRouter/xAI or another low-cost provider.

## Research notes

Before building a custom harness, we checked reusable open-source options:

- MCPBench is the closest MCP-specific benchmark. It evaluates MCP servers for task completion, latency, and token consumption, but its shipped tasks focus on web search, database query, and GAIA-style agents rather than local documentation retrieval. Atlas borrows the task-completion framing, not the whole framework.
- Promptfoo is a strong general LLM eval runner with a polished viewer and provider comparison. It is a good future export target for model-vs-model comparisons, but would add more setup than needed for deterministic retrieval metrics.
- Ragas and DeepEval are mature RAG eval frameworks with LLM-based metrics. They are useful once Atlas has generated answers to grade, but they add Python dependencies and judge-model costs. Atlas starts with deterministic retrieval stats first.

## Quick start

Ensure Atlas has a local corpus to query:

```bash
atlas setup
atlas repo add moxellabs/atlas
```

From this repo checkout:

```bash
bun run eval:mcp
```

Outputs:

```text
evals/reports/mcp-retrieval-report.json
evals/reports/mcp-retrieval-report.html
```

Open the HTML file in a browser or publish it as a static artifact.

## Dataset format

The seed dataset lives at:

```text
evals/mcp-retrieval.dataset.json
```

Each case contains:

- `id`: stable case identifier.
- `category`: grouping used in report charts.
- `query`: natural-language or keyword query.
- `expected.pathIncludes`: path substrings that should appear in top retrieval results.
- `expected.terms`: terms expected somewhere in selected/ranked context.
- `expected.tools`: intended MCP tools for the scenario. These are documented now and can be used by future agent-trace evals.

Path-substring expectations are used instead of generated doc IDs so the suite survives corpus rebuilds.

## Optional model judge placeholder

Retrieval metrics run without API keys. To annotate reports with the intended cheap judge model:

```bash
ATLAS_EVAL_MODEL_PROVIDER=openrouter \
ATLAS_EVAL_MODEL=x-ai/grok-code-fast-1 \
  bun run eval:mcp
```

This does not call the model yet. It records the intended judge configuration in the report so the next iteration can add answer-quality scoring without changing the report contract.

## Custom paths

```bash
bun tooling/scripts/mcp-retrieval-eval.ts \
  --dataset evals/mcp-retrieval.dataset.json \
  --out evals/reports/mcp-retrieval-report.json \
  --html evals/reports/mcp-retrieval-report.html
```

If you need to evaluate an installed `atlas` binary rather than source checkout CLI:

```bash
bun tooling/scripts/mcp-retrieval-eval.ts --cli atlas
```

## Interpreting metrics

- Pass rate: case passed all deterministic expectations.
- Path recall: fraction of expected path substrings found in top paths.
- Term recall: fraction of expected terms found in selected/ranked context payloads.
- Non-empty context: whether Atlas produced any selected or ranked retrieval context.
- Average latency: wall-clock CLI query time per case.
- Average ranked hits: mean ranked hit count.

The `natural-language-broad` and `keyword-baseline-repo-add` cases are intentionally paired to expose strict lexical retrieval behavior: broad natural language should improve over time without regressing precise keyword queries.
