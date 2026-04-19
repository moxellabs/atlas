# Server Hooks Module

The hooks module contains Elysia lifecycle hooks.

## Responsibilities

- Request logging behavior.
- Future hook-level runtime concerns that do not belong in route handlers.

## Invariants

Hooks should not perform corpus mutations. They should avoid logging tokens, authorization headers, private key material, or sensitive source contents.
