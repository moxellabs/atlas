# Retrieval Planner Module

The planner module builds token-budgeted context plans.

## Responsibilities

- Select summaries.
- Expand sections when more evidence is needed.
- Finalize planned context items.
- Track omitted material and diagnostics.

## Invariants

Planning must respect token budgets and preserve provenance. Summaries should be used where they answer broad questions more efficiently than raw sections.
