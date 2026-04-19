# Topology Discovery Module

The discovery module finds packages and modules from file paths.

## Responsibilities

- Find package manifest paths from workspace globs.
- Read package names from manifests when possible.
- Infer module roots from module-local docs and topology rule hints.
- Emit discovery diagnostics for fallbacks or ambiguity.

## Invariants

Discovery should be deterministic and should reject conflicting IDs or inconsistent path ownership.
