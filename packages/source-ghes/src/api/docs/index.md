# Source GHES API Module

The API module wraps GHES REST endpoints.

## Responsibilities

- Commits.
- Trees.
- Blobs.
- Contents.

## Invariants

Endpoint wrappers should stay small and typed. Authentication, base URL normalization, and pagination belong to client modules.
