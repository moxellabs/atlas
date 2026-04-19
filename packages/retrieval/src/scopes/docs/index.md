# Retrieval Scopes Module

The scopes module infers likely corpus targets for a query.

## Responsibilities

- Search repos, packages, modules, documents, and skills.
- Score possible scopes.
- Return rationale and diagnostics for inferred scopes.

## Invariants

Scope inference should prefer explicit matches and preserve ambiguity instead of forcing a single target too early.
