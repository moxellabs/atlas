# Topology Classifiers Module

The classifiers module assigns docs and skills to scopes.

## Responsibilities

- Evaluate topology rules for document paths.
- Select primary rule matches by priority.
- Infer package, module, and skill scopes.
- Build classification diagnostics.

## Invariants

Classification should prefer explicit rules and use fallback heuristics only for recognized docs paths. Contradictory ownership should raise structured errors.
