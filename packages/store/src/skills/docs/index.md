# Store Skills Module

The skills module persists extracted skill records.

## Responsibilities

- Upsert and read skills.
- List skills by repo, package, module, or limit filters.
- Preserve source document relationships.

## Invariants

Skill records should stay connected to source docs and topology scope so MCP tools can explain provenance.
