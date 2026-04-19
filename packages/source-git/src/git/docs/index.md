# Source Git Command Module

The git module wraps Git process execution and output parsing.

## Responsibilities

- Spawn Git commands.
- Parse Git output.
- Map command failures to structured Git errors.

## Invariants

Git errors should include actionable context without leaking credentials embedded in remotes or helper output.
