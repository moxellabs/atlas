# Topology Rules Module

The rules module evaluates topology rule patterns and scope inference helpers.

## Responsibilities

- Match include and exclude globs.
- Infer package scopes.
- Infer module scopes.
- Infer skill scopes.
- Validate rule structure at runtime.

## Invariants

Rule evaluation should be deterministic: matching rules sort by descending priority and then stable rule ID order.
