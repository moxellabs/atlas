# Store DB Module

The DB module owns SQLite lifecycle behavior.

## Responsibilities

- Open Atlas store databases.
- Apply schema migrations.
- Apply SQLite pragmas.
- Report store diagnostics.

## Invariants

Database initialization should be idempotent. Migration errors should be structured and should not leave callers believing the store is ready.
