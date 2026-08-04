# MCP Resources Module

The resources module exposes addressable Atlas corpus resources.

## Responsibilities

- Manifest resource.
- Repo, package, module, document, skill, and summary resources.
- Resource ID helpers and registration helpers.

## Manifest Discovery Contract

`atlas://manifest` is an advanced-profile inspection resource for local indexed repository coverage. Normal agent retrieval starts with `answer_<source>_docs`, `plan_context`, or the task-specific generic tool rather than traversing resources.

Manifest coverage is derived only from local store records. It reports compact repo IDs, indexed revisions, compiler versions, freshness, and package/module/document counts without fetching remote content or exposing credentials.

## Invariants

Resources should be stable, scoped, and derived from local store records. Missing resources should return structured MCP not-found errors.
