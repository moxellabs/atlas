# Indexer Build Module

The build module compiles and persists corpus artifacts.

## Responsibilities

- Build one repo or all repos.
- Rebuild selected docs and skills.
- Persist repos, packages, modules, docs, sections, chunks, summaries, skills, and manifests.
- Preserve previous corpus state when rebuilds fail.

## Invariants

Build writes should be transactional at the operation boundary. Reports must include enough diagnostics to debug stale or failed builds.
