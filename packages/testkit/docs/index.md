---
title: Testkit Package
description: Deterministic fixtures, fake repositories, and evaluation helpers for Atlas tests.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 290
---

# Testkit Package

`@atlas/testkit` provides deterministic fixtures and evaluation helpers for Atlas tests.

## Responsibilities

- Create fake repositories with deterministic files.
- Optionally initialize fake repos as Git repositories.
- Provide sample evaluation datasets.
- Run retrieval/context-planning eval cases and compute basic quality metrics.

## Usage

Tests use testkit to create source repositories, seed docs and skills, run end-to-end indexing flows, and evaluate retrieval plans without depending on external services. Evaluation helpers should make expected scopes, planned items, and quality metrics explicit so regressions are easy to inspect.

## Invariants

- Fixtures should be deterministic and cheap to create.
- Test repositories should avoid leaking machine-specific paths into assertions when possible.
- Production packages should not rely on testkit behavior at runtime.

## Boundaries

Testkit supports tests and examples. Production packages should avoid depending on test-only behavior at runtime.

## Tests

Primary coverage lives in `packages/testkit/src/testkit.test.ts`.

```bash
bun --cwd packages/testkit run typecheck
bun test packages/testkit
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/testkit`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
