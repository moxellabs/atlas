# @atlas/server

Local HTTP runtime for ATLAS.

The server composes validated config, the SQLite store, retrieval services, indexer operations, OpenAPI docs, and the MCP bridge into one Elysia app. It is local-first and intended for developer-machine use.

## Runtime Role

- Serves health and version metadata.
- Exposes repository, search, context, skill, inspect, sync, and build routes.
- Serves OpenAPI JSON and the local OpenAPI HTML shell when enabled.
- Mounts the MCP Streamable HTTP bridge at `/mcp` when MCP is enabled.
- Delegates business logic to package services instead of embedding indexing or retrieval logic in routes.

## Entry Points

- `src/index.ts`: standalone server process.
- `src/start-server.ts`: reusable startup helper used by the CLI.
- `src/app.ts`: Elysia app composition from explicit dependencies.

## Environment

Server-specific env values are parsed by `src/env.ts`.

| Variable | Purpose | Default |
|---|---|---|
| `ATLAS_HOST` | HTTP bind host | `127.0.0.1` |
| `ATLAS_PORT` | HTTP bind port | `3000` |
| `ATLAS_ENABLE_OPENAPI` | Enable OpenAPI routes/UI | `true` |
| `ATLAS_ENABLE_MCP` | Enable `/mcp` bridge | `true` |
| `ATLAS_ENABLE_TELEMETRY` | Enable OpenTelemetry plugin | `false` |
| `ATLAS_LOG_REQUESTS` | Emit structured request logs | `true` |

The server also relies on the shared ATLAS config loader, so `ATLAS_CONFIG`, `ATLAS_CACHE_DIR`, `ATLAS_LOG_LEVEL`, `ATLAS_CA_CERT_PATH`, and GHES token env vars apply through `@atlas/config`.

## Routes

- `GET /health`
- `GET /version`
- `GET /openapi/json`
- `GET /openapi`
- `GET /api/repos`
- `GET /api/repos/:repoId`
- `POST /api/repos`
- `PUT /api/repos/:repoId`
- `DELETE /api/repos/:repoId`
- `POST /api/search/scopes`
- `POST /api/search/docs`
- `POST /api/context/plan`
- `GET /api/docs/:docId/outline`
- `GET /api/docs/:docId/sections/:sectionId`
- `GET /api/docs/:docId/section`
- `GET /api/skills`
- `GET /api/skills/:skillId`
- `GET /api/inspect/manifest`
- `GET /api/inspect/freshness`
- `GET /api/inspect/topology/:repoId`
- `GET /api/inspect/retrieval`
- `POST /api/sync`
- `POST /api/build`
- `GET|POST|DELETE /mcp`

## Development

Run the server from the repo root:

```bash
bun run serve
```

Run server package checks:

```bash
bun --cwd apps/server run typecheck
bun test apps/server
```

Repo-level validation:

```bash
bun run typecheck
bun run lint
bun test
```

## Current Scope

- Repo mutation routes are implemented for loopback-bound servers only.
- Direct document outline and section reads are exposed through HTTP and MCP.
- `/mcp` is mounted and covered by route-level Streamable HTTP tests.
- The supported browser inspection surface is OpenAPI; no separate inspector UI is mounted.
