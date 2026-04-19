# Server OpenAPI Module

The OpenAPI module owns route documentation metadata and the local API reference theme.

## Responsibilities

- Define OpenAPI route docs and tags.
- Customize the local OpenAPI HTML shell.
- Keep route docs aligned with actual server routes and schemas.

## Invariants

OpenAPI docs are a browser inspection surface for local APIs. They should document request and response shapes without exposing private runtime data.
