# Source GHES Client Module

The client module owns GHES request infrastructure.

## Responsibilities

- Normalize API base URLs.
- Build auth headers.
- Describe credential source metadata safely.
- Perform requests and pagination.

## Invariants

Client errors should identify status, endpoint, and operation without exposing bearer token values.
