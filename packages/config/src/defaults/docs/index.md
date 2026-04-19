# Config Defaults Module

The defaults module defines baseline Atlas configuration values.

## Responsibilities

- Default cache root.
- Default corpus DB path under the cache root.
- Default server host and port for HTTP mode.
- Default stdio server config for local MCP-style operation.

## Invariants

Defaults should be conservative and local-first. Callers can opt into HTTP host/port behavior explicitly.
