# Config Loaders Module

The loaders module owns config and environment resolution.

## Responsibilities

- Discover and read config files.
- Parse YAML or JSON config content.
- Resolve default values and environment overrides.
- Normalize paths relative to config location and cwd.
- Resolve GHES auth from env vars or GitHub CLI.
- Mutate config files atomically for CLI/server repo operations.

## Invariants

Loaders must validate before returning config. Credential values must not be written into config files or exposed in structured errors.
