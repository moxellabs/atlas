# Server Schemas Module

The schemas module owns HTTP input validation schemas.

## Responsibilities

- Common params and query helpers.
- Search and context request body schemas.
- Repo mutation schemas.
- Docs, sync, and build schemas.

## Invariants

Schemas should reject malformed user input at route boundaries and preserve package-level contracts. Route handlers should use parsed schema values, not raw request payloads.
