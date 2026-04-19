---
name: add-mcp-tool
description: Add or modify an Atlas MCP tool. Use when an agent needs to change packages/mcp tool schemas, executors, registration, structured results, tool exports, MCP tests, or the protocol surface over Atlas retrieval, store, freshness, docs, skills, and source diff capabilities.
---

# Add MCP Tool

Use this skill for changes in `packages/mcp/src/tools`. MCP tools expose local Atlas corpus behavior through protocol-safe inputs and JSON-compatible outputs.

## Workflow

1. Define the tool contract.
   - Add input validation in `packages/mcp/src/schemas/tool-schemas.ts`.
   - Keep inputs small and explicit: query, repo ID, scope filters, IDs, limits, or output options.
   - Reuse existing schemas where possible.

2. Implement executor and registration.
   - Follow existing tool modules such as `find-docs.tool.ts` or `plan-context.tool.ts`.
   - Split pure executor behavior from registration.
   - Return through shared result helpers from `mcp-result.ts`.
   - Map dependency or validation failures to structured MCP errors.

3. Wire exports and server registration.
   - Export the schema/types/tool registration from `packages/mcp/src/index.ts`.
   - Register the tool in `packages/mcp/src/server/create-mcp-server.ts`.
   - Update metadata only when capabilities materially change.

4. Preserve package boundaries.
   - Retrieval ranking belongs in `@atlas/retrieval`.
   - Store reads belong in `@atlas/store` repositories or MCP store mappers.
   - Source diff behavior must go through the configured diff provider.

5. Test the tool.
   - Add schema and executor coverage in `packages/mcp/src/mcp.test.ts`.
   - Cover valid input, invalid input, missing dependency/not-found behavior, and stable result shape.
   - Run `bun test packages/mcp`, then repo gates.

## Output Rules

- Tool outputs must be JSON-compatible and provenance-friendly.
- Do not return secrets, auth headers, or raw private diagnostics.
- Include rationale/diagnostics when that helps downstream agents decide whether to trust the result.
