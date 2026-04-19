# MCP Server Module

The server module creates MCP runtime instances and transports.

## Responsibilities

- Create Atlas MCP servers from explicit dependencies.
- Define server metadata and capabilities.
- Create stdio, Streamable HTTP, and web-standard Streamable HTTP transports.
- Register tools, resources, and prompts through their module-level registration helpers.
- Keep transport creation separate from domain execution.

## Server Construction

The server module receives explicit Atlas MCP dependencies and uses them to create a protocol server. Tool/resource/prompt modules own their individual contracts; the server module wires those definitions into the MCP runtime and advertises shared metadata and capabilities.

Host runtimes provide transport-specific primitives. The CLI supplies stdio streams for command-hosted sessions. The HTTP server supplies web-standard request/response handling for Streamable HTTP routes.

## Invariants

Transport behavior should be protocol-focused. Domain operations belong to tools/resources and their dependencies.

Transport creation should not open stores, run retrieval, sync sources, or compile docs. Dependency errors, resource misses, validation failures, and transport failures should surface through structured MCP errors so agent clients can distinguish bad input from unavailable corpus state.

## Tests

`packages/mcp/src/mcp.test.ts` covers server/tool/resource behavior. Transport changes should include tests for explicit stream binding or HTTP lifecycle behavior where feasible, plus validation that tool registration remains available through the server factory.
