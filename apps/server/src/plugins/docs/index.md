# Server Plugins Module

The plugins module owns Elysia plugin composition.

## Responsibilities

- OpenAPI registration.
- Request context derivation.
- Error handling.
- Timing and telemetry integration.
- Optional OpenAPI HTML page integration.

## Invariants

Plugins should be composable and side-effect-light. They should support local diagnostics without leaking credentials or corpus contents unexpectedly.
