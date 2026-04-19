# Testkit Source Module

The testkit source module contains deterministic test helpers.

## Responsibilities

- Fake repository creation.
- Sample eval dataset.
- MCP adoption eval dataset.
- Eval runner and scoring.
- Public testkit exports.

## Invariants

Fixtures should be deterministic and safe to run in temporary directories. Eval helpers should expose enough detail to debug retrieval regressions.

MCP adoption evals score whether traces read `atlas://manifest`, call `plan_context`, or make no Atlas MCP calls as expected. `adoptionScore` is `passedCases / totalCases`. Adoption fixtures are local-only and do not fetch remote repositories or read credentials.
