# Config Loaders Module

The loaders module owns config and environment resolution.

## Responsibilities

- Discover and read config files.
- Parse YAML or JSON config content.
- Apply file defaults and environment overrides in separate stages.
- Validate without mutating the parsed value.
- Compose built-in document profiles and normalize paths after validation.
- Build source-adapter repository contracts from the resolved config.
- Resolve GHES auth from env vars or GitHub CLI.
- Mutate config files atomically after running the shared validation and normalization stages.

## Invariants

Loaders validate before returning config. The schema does not install runtime defaults or profiles during validation. Credential values never enter config files or structured errors.
