---
title: Server App
description: HTTP server, route composition, OpenAPI, local runtime services, and MCP bridge.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 110
---

# Server App

`apps/server` is the local HTTP runtime for Atlas. It composes Elysia routes, plugins, services, OpenAPI, and the MCP bridge around explicit package-layer dependencies.

## Responsibilities

- Load server environment and validated Atlas config.
- Open the SQLite store and construct read/indexer/retrieval services.
- Serve health, version, repository, search, context, docs, skills, inspect, sync, build, OpenAPI, and MCP routes.
- Enforce local-first mutation boundaries for repository config changes.
- Keep route handlers thin and delegate domain behavior to packages.

## Runtime Entry Points

- `src/index.ts`: standalone process entrypoint.
- `src/start-server.ts`: reusable startup helper used by the CLI.
- `src/app.ts`: Elysia app composition from explicit dependencies.

## Route Model

Routes are grouped by concern: health/version, repositories, search/context, docs, skills, inspect, sync, build, OpenAPI, and MCP. Route handlers should validate transport input, call services or package functions, and return presenter-shaped responses.

Schemas and presenters are part of the server boundary. Package services should not depend on Elysia request objects, HTTP status codes, or OpenAPI-specific shapes.

## Operations

The server is intended for loopback/local use. It opens the configured SQLite corpus, constructs source/indexer/retrieval dependencies, and exposes diagnostics that help operators understand config, source, build, and retrieval state.

Mutation routes should preserve the same package semantics as the CLI. Build and sync routes should surface reports, timings, recovery state, and diagnostics rather than hiding package errors behind generic HTTP responses.

## Boundaries

Server code should not implement compiler, topology, store, retrieval ranking, or MCP protocol internals. It owns HTTP composition, validation, presentation, OpenAPI, and local runtime wiring.

## Scalar OpenAPI Reference

`/docs` serves the Scalar-backed OpenAPI reference. Root `/` redirects to `/docs`. `/openapi` remains available for compatibility with the same Scalar/OpenAPI experience. `/openapi.json` is the preferred raw machine-readable OpenAPI document, and `/openapi/json` remains available for compatibility. Route-group guidance, local-first notes, quickstart steps, and safe examples live inside the generated OpenAPI metadata displayed by Scalar.

Focused validation:

```bash
bun test apps/server/src/server.test.ts --test-name-pattern "docs|OpenAPI|redirect"
```

## Tests

Primary route and runtime coverage lives in `apps/server/src/server.test.ts`.

```bash
bun --cwd apps/server run typecheck
bun test apps/server
```

## Invariants

Behavior should remain deterministic for the same inputs, preserve local-first boundaries, and report structured diagnostics where applicable.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test apps/server/src/server.test.ts
```
