---
name: document-codebase
title: Document Codebase
description: Analyze a software repository and create or update durable codebase documentation. Use when an agent needs to document a codebase, audit existing docs, add package/app/module docs, organize architecture or operations docs, prepare a repository for self-indexing or retrieval, or make targeted documentation updates without rewriting useful existing documentation.
visibility: public
audience: [contributor, maintainer]
purpose: [workflow]
order: 100
---

# Document Codebase

Use this skill to create accurate documentation from source truth. Optimize for readers who need to modify, operate, consume, review, or retrieve knowledge from the codebase.

## Core Workflow

1. Inventory before writing.
   - Inspect current source and docs before edits. Source truth wins over stale docs.
   - Inspect manifests, workspace layout, public entrypoints, barrels, route/command registries, schemas, tests, and existing docs.
   - Prefer `rg --files`, package manifests, `src/index.*`, exported APIs, route definitions, tests, and config schemas over assumptions.
   - Run `scripts/inventory_codebase_docs.py` when a quick map of code/docs/tests will save time.

2. Model the audiences.
   - Maintainers need ownership boundaries, invariants, failure modes, and tests.
   - Consumers need install/use/API/command/route examples and compatibility notes.
   - Operators need config, environment, deployment/runtime, diagnostics, recovery, and security posture.
   - Onboarding readers need architecture, data flow, glossary, and where to start.
   - Retrieval agents need stable scope, concise headings, provenance-friendly structure, and low duplication.

3. Audit existing docs.
   - Keep accurate docs and patch only the stale or thin sections.
   - Canonicalize conflicting docs by choosing one source of truth and replacing duplicates with short pointers.
   - Avoid `.planning/**` and archived docs unless user explicitly asks; treat them as internal or historical by default.
   - Archive historical specs only when they are preserved and clearly excluded from active documentation.
   - Do not rewrite healthy docs just to match a template.

4. Choose the right doc layer.
   - Root docs: architecture, data flows, operations, security, setup, decision records, and cross-cutting concepts.
   - App docs: commands, routes, runtime entrypoints, environment, user workflows, and validation.
   - Package docs: ownership boundary, public API, dependencies, data model, errors, and tests.
   - Module docs: local responsibilities, inputs/outputs, invariants, edge cases, and nearby tests.
   - Inline code comments: only for non-obvious implementation constraints that would be missed in external docs.

5. Write from evidence.
   - Name actual packages, apps, modules, commands, routes, exported APIs, schemas, and tests.
   - State current behavior, not intended future behavior.
   - Update active docs and codebase docs from source truth; avoid broad rewrites of healthy docs.
   - Prefer concise sections, stable headings, concrete examples, and links to nearby source/docs.
   - Separate maintainer-facing internals from consumer-facing usage when both audiences exist.

6. Validate and report.
   - Run `scripts/check_markdown_links.py` after moving or adding docs.
   - Run project tests/checks when docs affect config, topology, generated surfaces, examples, or behavior.
   - For indexed-doc systems, run a non-mutating indexing/topology sanity check when feasible.
   - Report changed scopes, preserved docs, archived docs, validation commands, and remaining known gaps.

## Existing Docs Decision Rules

- Accurate but thin: add missing sections only.
- Locally stale: patch the stale claim and cite the source-backed behavior.
- Broadly stale: rewrite the smallest coherent section, not the whole doc tree.
- Duplicated and conflicting: create one canonical home, then add short pointers elsewhere.
- Historical but useful: move or label as archive/reference.
- Generated or external API docs exist: link to them and document usage, boundaries, and examples instead of copying full references.

## Resource Guide

- Read `references/documentation-patterns.md` for audience-aware layouts, templates, update strategies, and anti-patterns.
- Run `scripts/inventory_codebase_docs.py <repo>` to gather a read-only repository documentation inventory.
- Run `scripts/check_markdown_links.py <repo>` to find broken local Markdown links.
