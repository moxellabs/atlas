# Core Enums Module

The enums module defines shared string domains used across packages.

## Responsibilities

- Authority levels.
- Diagnostic confidence levels.
- Document kinds.
- Source and transport modes.
- Query kinds.
- Raw and normalized source change kinds.

## Invariants

Enums should only change when package contracts and persisted data expectations are updated together.
