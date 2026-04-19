# Retrieval Ranking Module

The ranking module orders retrieval candidates.

## Responsibilities

- Apply authority weight.
- Apply locality weight.
- Apply redundancy penalty.
- Combine ranking factors into scored candidates.

## Invariants

Ranking should be explainable. Returned hits need rationale that lets users and agents understand why evidence was selected.
