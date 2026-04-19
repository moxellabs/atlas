# @atlas/retrieval

Retrieval planning for the local ATLAS corpus.

This package classifies user queries, infers likely scopes, gathers candidates from the store, ranks results, handles ambiguity, and builds token-budgeted context plans.

## Runtime Role

- Classifies query intent such as overview, exact lookup, usage, troubleshooting, skill invocation, diff, location, and compare.
- Infers repo/package/module/skill scopes from stored metadata.
- Ranks candidates by lexical score, authority, locality, query-kind fit, token efficiency, and redundancy.
- Selects summaries first when appropriate, then expands into sections/chunks/skills under budget.
- Returns explicit ambiguity and omission information.
- Builds an answer-ready `contextPacket` with selected evidence, human-readable scope labels, provenance, warnings, omitted-item reasons, and recommended next actions so MCP agents need fewer follow-up calls.

## Public API

- `classifyQuery`
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
