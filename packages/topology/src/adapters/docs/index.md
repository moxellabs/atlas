# Topology Adapters Module

The adapters module provides built-in topology strategies.

## Responsibilities

- Mixed monorepo adapter.
- Module-local docs adapter.
- Package top-level adapter.
- Adapter selection.

## Invariants

Adapters should call shared discovery and classification helpers. They should not invent separate ID or scope behavior.
