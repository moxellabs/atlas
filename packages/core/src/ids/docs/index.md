# Core IDs Module

The IDs module creates deterministic IDs for Atlas corpus entities.

## Responsibilities

- Create document, section, chunk, package, module, and skill IDs.
- Keep ID inputs explicit and stable.
- Avoid accidental dependence on absolute local paths.

## Invariants

IDs must be deterministic across machines for the same repo-relative inputs. Changing ID inputs is a schema and migration concern.
