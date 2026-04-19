# Server Services Module

The services module adapts package dependencies to HTTP route needs.

## Responsibilities

- Build and close server dependencies.
- Read store-backed repo, freshness, document, section, and skill details.
- Wrap retrieval operations for HTTP response shapes.
- Run sync and build operations through indexer services.
- Bridge MCP transport requests to `@atlas/mcp`.

## Invariants

Services may compose package behavior but should not duplicate package internals. They should expose route-oriented methods with explicit inputs and structured errors.
