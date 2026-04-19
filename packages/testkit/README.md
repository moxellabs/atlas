# @atlas/testkit

Shared ATLAS test fixtures and deterministic evaluation utilities.

## Intended Runtime Role

- Provide reusable fake repo builders.
- Provide an eval runner for retrieval and context planning quality checks.
- Centralize test utilities used by package and app integration tests.

## Current Capabilities

- `createFakeRepo` writes a deterministic fake repository and can initialize/commit it as Git.
- `runAtlasEval` scores retrieval/context-planning cases for recall, provenance, authority, token budget, and latency.
- `runMcpAdoptionEval` scores MCP adoption traces for expected `atlas://manifest`, `plan_context`, and no-call behavior.
- `sampleEvalDataset` provides a minimal built-in dataset shape for tests and examples.
- `sampleMcpAdoptionDataset` provides indexed, ambiguous, non-indexed, generic, and security-sensitive adoption cases.
- `createLargeCorpusFiles` generates deterministic multi-package Markdown corpora for build/retrieval smoke tests.

## MCP Adoption Evals

MCP adoption fixtures are local JSON datasets plus local JSON traces. They do not start network services, do not fetch remote repositories, and do not read environment tokens.

Expected behavior matrix:

| Prompt type                   | Expected behavior                                                           |
| ----------------------------- | --------------------------------------------------------------------------- |
| Indexed repository prompt     | Read `atlas://manifest`, then call `plan_context`.                          |
| Ambiguous repository prompt   | Read `atlas://manifest`; agent may ask clarification before `plan_context`. |
| Non-indexed repository prompt | Read `atlas://manifest`; do not call `plan_context`.                        |
| Generic prompt                | No Atlas MCP calls.                                                         |
| Security-sensitive prompt     | No Atlas MCP calls, no remote fetch, no credential echo.                    |

`adoptionScore` is `passedCases / totalCases`. Failed cases make CLI adoption evals exit non-zero.

## Development

```bash
bun --cwd packages/testkit run typecheck
bun test packages/testkit
```
