---
title: Retrieval And Context Planning
description: Learn how Atlas searches, ranks, filters, and plans retrieval context from local public artifacts.
audience: [consumer, contributor, maintainer]
purpose: [guide, reference]
visibility: public
order: 40
---

# Retrieval And Context Planning

Atlas retrieval is scope-aware. It uses topology, summaries, search records, ranking signals, and token budgets to return useful evidence without flattening the documentation corpus.

## Retrieval Pipeline

1. Query classification identifies whether the user asks for overview, exact lookup, usage, troubleshooting, skill invocation, diff, location, or comparison.
2. Scope inference searches stored repos, packages, modules, docs, and skills for likely targets.
3. Candidate generation uses lexical, path, and scope search helpers from `@atlas/store`.
4. Ranking combines lexical relevance, authority, locality, query-kind fit, token efficiency, redundancy, and freshness evidence.
5. Context planning selects summaries first where useful, then expands to sections or chunks under a token budget.
6. Presenters return rationale, ambiguity, omitted candidates, provenance, and diagnostics.

## Retrieval Surfaces

- CLI: `atlas inspect retrieval`, `atlas list docs`, `atlas list sections`, and related inspection commands.
- HTTP: search, context, document outline, document section, skill, and inspect routes.
- MCP: `find_scopes`, `find_docs`, `read_outline`, `read_section`, `expand_related`, `explain_module`, `get_freshness`, `plan_context`, and `what_changed`.

## Token Budgets And Omissions

`plan_context` accepts `budgetTokens` and reports `usedTokens`. `usedTokens` is selected corpus evidence token cost and must stay within `budgetTokens`; compact warnings, next actions, and diagnostics are not counted as selected evidence.

Context packets include omission diagnostics so agents know why relevant candidates were not selected:

- `budget` - candidate exceeded entire budget or remaining token budget.
- `authority` - lower-authority candidate was outweighed by stronger evidence.
- `freshness` - stale repository freshness reduced candidate priority.
- `archive` - archive or historical content was deprioritized.
- `redundancy` - duplicate/near-duplicate evidence was suppressed.

Retrieval remains store-backed at query time. It does not fetch remote repositories, import source adapters, or read credentials while planning context.

## Quality Goals

Retrieval should prefer canonical architecture docs for broad questions, package docs for ownership questions, and module docs for implementation questions. It should preserve provenance so an agent can cite exactly which repo, package, module, document, and section informed an answer.

## Public Profile Filter Examples

Retrieval reads local corpus/public artifacts and does not fetch remote source at query time. Public profile searches can filter with metadata terms `profile`, `audience`, `purpose`, and `visibility`:

```bash
atlas search "artifact freshness" --profile public --json
atlas inspect retrieval --query "artifact freshness" --profile public --audience maintainer --purpose workflow --visibility public
```

MCP and HTTP context planning apply the same public artifact metadata filters before ranking candidates.
