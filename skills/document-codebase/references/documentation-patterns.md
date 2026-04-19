# Documentation Patterns

Use these patterns after inventorying the repository. Preserve local conventions when they are coherent.

## Audience Matrix

| Audience | Primary questions | Best docs |
|---|---|---|
| Maintainers | Where do I change behavior safely? What invariants matter? | Package/module docs, architecture notes, tests, troubleshooting |
| Consumers | How do I use this API, CLI, package, service, or library? | README, usage guides, API examples, compatibility notes |
| Operators | How do I configure, run, inspect, recover, and secure it? | Operations, config, deployment/runtime, security, diagnostics |
| Reviewers | What changed, why, and what risks exist? | Architecture decisions, migration notes, release notes |
| Retrieval agents | Which scope owns this fact and where is source evidence? | Scoped docs with stable headings, low duplication, clear provenance |

## Recommended File Layout

Use the repository's existing documentation conventions first. If there is no clear convention, prefer:

- `docs/index.md` for the active documentation landing page.
- `docs/architecture.md`, `docs/configuration.md`, `docs/security.md`, and operation guides for cross-cutting behavior.
- `apps/<app>/docs/index.md` for app-level runtime ownership.
- `packages/<package>/docs/index.md` for package-level ownership.
- `<source-root>/<module>/docs/index.md` for module-local implementation guidance.
- `docs/archive/` for historical specs that should be preserved but not treated as current behavior.

For repositories with retrieval or doc indexing rules, place docs where the indexer can classify the intended scope. Avoid putting everything under root when package/module locality is available.

## Package Or App Doc Template

Use only sections that add value:

```markdown
# <Package Or App Name>

One-sentence purpose.

## Responsibilities

- Concrete behavior owned here.

## Public Surface

- Commands, routes, exports, schemas, events, files, or runtime entrypoints.

## Data Flow

How inputs move through this component and what it emits.

## Boundaries

What this component should not own.

## Failure Modes

Expected errors, diagnostics, retries, recovery, or fallback behavior.

## Tests

Where coverage lives and which commands validate it.
```

## Module Doc Template

Module docs should be shorter and closer to implementation details:

```markdown
# <Module Name> Module

One-sentence role.

## Responsibilities

- Local behavior.

## Inputs And Outputs

- Inputs consumed here.
- Outputs or side effects produced here.

## Invariants

- Ordering, determinism, persistence, security, idempotency, or failure guarantees.

## Tests

Nearby tests or scenarios that protect this module.
```

## Consumer-Facing Doc Template

Use when the codebase exposes a library, package, CLI, service, protocol, or app:

```markdown
# <Product/API/Package>

What it is and when to use it.

## Quick Start

Minimal working example.

## Common Workflows

Real usage paths with expected output or state.

## Configuration

Inputs, options, defaults, and environment variables.

## Compatibility

Version, platform, protocol, or migration notes.

## Troubleshooting

Known errors and fixes.
```

## Architecture Doc Template

Root architecture docs should explain relationships, not duplicate every package doc:

```markdown
# <Architecture Topic>

What this topic covers.

## Components

The major parts involved and their ownership.

## Flow

How data or control moves through the system.

## Important Invariants

What must remain true.

## Operational Notes

How to inspect, validate, troubleshoot, or recover it.
```

## Documentation Audit Rubric

Use this rubric before editing existing docs:

| Finding | Action |
|---|---|
| Accurate and complete | Leave unchanged or add links only |
| Accurate but thin | Add targeted missing sections |
| One stale section | Patch that section from source evidence |
| Many stale claims | Rewrite the smallest coherent doc or split by audience |
| Duplicate conflicting docs | Pick canonical home, update it, add pointers elsewhere |
| Historical plan/spec | Move or label as archive/reference |
| Generated reference exists | Link to generated reference and document usage/context |
| No docs for critical code | Create scoped package/app/module docs |

## Source Evidence Checklist

Before making a claim, look for:

- Public exports or package barrels.
- CLI command dispatch, route registration, RPC handlers, or protocol registries.
- Config schemas and defaults.
- Database schemas, migrations, models, or repository APIs.
- Tests and fixtures that prove behavior.
- Error types and diagnostic paths.
- Build, deployment, or runtime scripts.

## Anti-Patterns

- Replacing accurate local docs with generic boilerplate.
- Documenting planned behavior as current behavior.
- Mixing maintainer internals into consumer quick starts.
- Creating root docs that erase package/module ownership.
- Copying large generated API references into hand-written docs.
- Leaving historical implementation specs mixed with active architecture docs.
- Adding documentation that cannot be tied back to source evidence.
