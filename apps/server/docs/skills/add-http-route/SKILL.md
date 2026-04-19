---
name: add-http-route
description: Add or modify an Atlas server HTTP route. Use when an agent needs to change apps/server Elysia routes, schemas, services, presenters, OpenAPI docs, local mutation boundaries, error envelopes, sync/build/search/context/docs/skills/inspect endpoints, or server route tests.
---

# Add HTTP Route

Use this skill for changes under `apps/server`. Server routes adapt local package services to HTTP; they should not become domain engines.

## Workflow

1. Locate the route group.
   - Route modules: `apps/server/src/routes/*.route.ts`.
   - Input schemas: `apps/server/src/schemas/*`.
   - Services: `apps/server/src/services/*`.
   - Presenters: `apps/server/src/presenters/*`.
   - OpenAPI metadata: `apps/server/src/openapi/route-docs.ts`.
   - App composition: `apps/server/src/app.ts`.

2. Add the boundary pieces together.
   - Define params/query/body schemas first.
   - Add or reuse a service method for package-layer behavior.
   - Return through `ok()` or shared error handling.
   - Add OpenAPI route docs for every public endpoint.
   - Mount the route group in app composition if it is new.

3. Preserve local-first behavior.
   - Repository config mutation must remain loopback-only.
   - Retrieval and read routes operate on the local SQLite corpus.
   - Sync/build routes delegate to `@atlas/indexer`.
   - Errors must not leak tokens, auth headers, private paths beyond useful diagnostics, or source contents unexpectedly.

4. Test the route.
   - Add coverage in `apps/server/src/server.test.ts`.
   - Cover validation failure, success envelope, not-found/error mapping, OpenAPI docs where relevant, and local mutation boundaries if applicable.
   - Run `bun test apps/server`, then repo gates for public route changes.

## Boundaries

- Do not duplicate config, retrieval, indexer, MCP, store, or source logic in route handlers.
- Keep presenters deterministic and serialization-safe.
