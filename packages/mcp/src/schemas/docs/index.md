# MCP Schemas Module

The schemas module validates MCP tool input.

## Responsibilities

- Query, repo, scope, output, limit, and tool-specific input schemas.
- Types inferred from schemas for tool implementations.

## Invariants

Schemas should reject invalid tool input before dependencies are called and should keep MCP input contracts stable.
