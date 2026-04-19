---
title: Topology Package
description: Workspace, package, module, doc, and skill classification from source paths and rules.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 310
---

# Topology Package

`@atlas/topology` turns source file paths into package, module, document, and skill scopes.

## Responsibilities

- Discover packages from workspace globs and manifests.
- Discover modules from module-local docs and topology rule hints.
- Evaluate include/exclude topology rules.
- Classify documentation paths into doc kinds, authority, ownership, and scopes.
- Classify skill documents into skill nodes.
- Provide built-in adapters for mixed monorepos, package top-level docs, and module-local docs.

## Data Flow

Topology receives source file paths, workspace config, package manifests, and topology rules. It produces package nodes, module nodes, classified documents, and skill nodes that the compiler and indexer use as scope and provenance input.

## Invariants

- Classification should be path-based and deterministic for the same source tree and rules.
- Rule priority decides overlapping matches; callers should not depend on incidental glob ordering.
- Package and module discovery should report diagnostics for ambiguous ownership instead of silently choosing an unstable owner.
- Skill classification should stay aligned with document classification so skills remain scoped to the right repo/package/module.

## Boundaries

Topology works from file paths, package manifests, rules, and source tree metadata. It should not parse Markdown content or persist corpus records.

## Tests

Coverage includes discovery, adapter selection, mixed-monorepo behavior, and rule evaluation.

```bash
bun --cwd packages/topology run typecheck
bun test packages/topology
```

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `packages/topology`.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`
