# @atlas/retrieval

Retrieval planning for the local ATLAS corpus.

This package classifies user queries, infers likely scopes, gathers candidates from the store, ranks results, handles ambiguity, and builds token-budgeted context plans.

## Runtime Role

- Classifies query intent such as overview, exact lookup, usage, troubleshooting, skill invocation, diff, location, and compare.
- Infers repo/package/module/skill scopes from stored metadata.
- Uses a required `RetrievalStore` read port created once per runtime, so planner calls do not allocate repository wrappers.
- Ranks candidates by lexical score, authority, locality, query-kind fit, token efficiency, and redundancy.
- Selects summaries first when appropriate, then expands into sections/chunks/skills under budget. Natural-language exact lookups prefer section text and can keep two distinct headings from one document; path and location queries remain path-first.
- Returns explicit ambiguity and omission information.
- Builds an answer-ready `contextPacket` with selected evidence, human-readable scope labels, provenance, warnings, omitted-item reasons, and recommended next actions. A high-confidence, unambiguous plan tells callers to answer from the returned evidence and retrieve more only when a required claim is unsupported.

## Public API

- `classifyQuery`
- `createRetrievalStore`
- `inferScopes`
- `rankCandidates`
- `planContext`
- Planner helpers and retrieval presenter utilities
- Retrieval types and structured errors

## Development

```bash
bun --cwd packages/retrieval run typecheck
bun test packages/retrieval
```

## Documentation

Indexed package docs live in `packages/retrieval/docs/`. Module-local docs live under `packages/retrieval/src/*/docs/`.

## Global corpus runtime

Retrieval reads the global corpus-backed store at `~/.moxel/atlas/corpus.db` after artifact import or local-only indexing. It uses local imported corpus data and does not fetch remote source at query time.
