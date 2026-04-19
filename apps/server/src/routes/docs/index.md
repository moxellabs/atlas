# Server Routes Module

The routes module owns HTTP endpoints and request-to-service wiring.

## Responsibilities

- Health and version routes.
- Repository list/detail/create/replace/delete routes.
- Search, context, document, skill, inspect, sync, build, and MCP routes.
- Request body, query, and params parsing through route utilities.
- Response wrapping with request IDs.

## Invariants

Routes should stay thin. They validate transport input, call services, and return `ok` or structured errors. Domain behavior belongs to packages and server services.
