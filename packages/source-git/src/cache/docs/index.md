# Source Git Cache Module

The cache module manages local Git checkout state.

## Responsibilities

- Ensure local repo caches exist.
- Clone missing repos.
- Fetch updates.
- Configure partial clone and sparse checkout behavior.
- Report cache status and diagnostics.

## Invariants

Cache operations should be explicit and deterministic for configured repo inputs. They should not delete unrelated local paths.
