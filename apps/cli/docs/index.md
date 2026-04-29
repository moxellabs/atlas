---
title: CLI App
description: CLI command parsing, local config mutation, artifact workflows, runtime launchers, and inspection commands.
audience: [contributor, maintainer]
purpose: [implementation, reference]
visibility: public
order: 100
---

# CLI App

`apps/cli` is the local operator interface for Atlas. It owns command parsing, terminal output, config mutation workflows, and delegation to package services.

## Responsibilities

- Parse commands and global flags.
- Create and mutate Atlas config through `@atlas/config`.
- Build CLI dependencies from config, store, indexer, retrieval, source adapters, and testkit.
- Run sync/build by delegating to `@atlas/indexer`; sync reports corpus impact, while build updates MCP-served corpus content.
- Start command-launched stdio MCP sessions by delegating to `@atlas/mcp`.
- Read corpus state for list and inspect commands.
- Emit human and JSON output with stable exit codes.

## Execution Model

`runCli` parses argv, creates a `CliCommandContext`, and dispatches to one command module. Commands return structured `CliCommandResult` values; shared IO code renders human output or JSON. Errors are normalized through CLI error utilities so commands can share exit-code behavior.

Dependency construction belongs in the runtime layer. Command modules should request the dependencies they need from context or runtime helpers, validate command-specific inputs, and delegate durable work to package services.

## Commands

The CLI currently supports `setup`, `next`, `init`, `repo add`, `add-repo`, `adoption-template`, `sync`, `build`, `serve`, `mcp`, `inspect`, `install-skill`, `list`, `clean`, `prune`, `doctor`, and `eval`.

`setup` creates user-home `~/.moxel/atlas` config and runtime directories. `next` inspects current setup/repo/corpus state and recommends one command. `repo add` imports an existing repo artifact for consumers; `add-repo` remains the compatibility alias. `init` initializes repo-local `.moxel/atlas` artifact files for maintainers. `build` publishes/updates the artifact. `index` is the local-only fallback for repos that do not publish artifacts. `init`, `build`, `repo doctor`, `repo show`, and store-backed inspect commands share repo target inference: explicit flags win, then repo metadata/cwd/config/Git origin/bare-name sources can avoid repeated full IDs.

Command groups:

- Start: `setup`, `next`.
- Use repos: `repo add`, `add-repo`, `repo list`, `repo show`, `sync`.
- Build artifacts: `init`, `build`, `artifact verify`, `artifact inspect`.
- Search/query: `search`, `list`, `serve`, `mcp`.
- Diagnose: `doctor`, `repo doctor`, `inspect`, `clean`, `prune`.
- Agent/editor workflow: `install-skill`.
- Evaluation: `eval`.

## Adoption templates

Generate copyable maintainer request text only:

```bash
atlas add-repo org/repo --maintainer-instructions
atlas add-repo org/repo --issue-pr-instructions
atlas adoption-template org/repo --repo-id github.com/org/repo
atlas adoption-template org/repo --repo-id github.com/org/repo --json
atlas adoption-template org/repo --repo-id github.com/org/repo --issue-only
atlas adoption-template org/repo --repo-id github.com/org/repo --pr-only
atlas adoption-template org/repo --repo-id github.com/org/repo --maintainer-only
```

Missing-artifact JSON includes `missingArtifact`, `selectedAction`, `nextActions`, and `adoptionTemplates`. `adoptionTemplates` contains `maintainerInstructions`, `issueTemplate`, `prTemplate`, and `commands` (`atlas init`, `atlas build`, and `git add .moxel/atlas`).

Maintainers control branch names, commit messages, hooks, PR templates, and permissions. Atlas does not branch, commit, push, create issues, or create PRs.

## Artifact commands

`atlas artifact verify` validates `.moxel/atlas` manifest schema, checksums, corpus importability, and secret/path safety. Use `atlas artifact verify --fresh` in CI to compare `indexedRevision` with current Git HEAD, or `atlas artifact verify --fresh --ref $(git rev-parse HEAD)` for explicit refs. Stale artifacts fail with `Artifact is stale; run atlas build and commit .moxel/atlas.`.

`atlas artifact inspect` prints repo ID, ref, indexed revision, created timestamp, Atlas version, format version, files, and docs counts. Use `atlas artifact inspect --json` for automation.

## Boundaries

The CLI should not implement source acquisition, topology classification, compilation, persistence, retrieval ranking, or MCP protocol behavior inline. Those behaviors belong to packages.

## Failure Modes

- Unknown commands and invalid flags should fail before package services are called.
- Config and dependency construction errors should preserve structured details for `--verbose` and `--json`.
- `CLI_BUILD_FAILED` wraps failed indexer build reports. JSON output includes `error.details.diagnostics[]`; `--verbose` preserves nested `cause` stack traces, stage, code, and failing path/entity diagnostics. Non-verbose human output stays concise and tells operators to rerun with `--verbose --json`.
- Missing repo targets report checked sources (`flags`, positional input, repo metadata, cwd, Git origin, config). Ambiguous bare repo names report candidate canonical IDs and never hang in JSON/non-interactive mode.
- For production build triage, run `bunx @moxellabs/atlas build --json --verbose --repo <repo-id> --config <config>` and compare with `inspect topology --live`; topology success means discovery worked, not that compile/persist stages succeeded.
- Commands that mutate config or corpus state should report what changed and leave package-level rollback or recovery semantics to the owning package.

## Tests

Primary coverage lives in `apps/cli/src/cli.test.ts`. Package-level checks can run with:

```bash
bun --cwd apps/cli run typecheck
bun test apps/cli
```

Command UX coverage: `setup`, `next`, `repo add`, `add-repo`, `hosts`, `index`, `repo remove`, `search`, `inspect retrieval`, `mcp`, and `artifact` expose consumer, maintainer, and enterprise workflows. `search` and `mcp` use the local imported corpus; `index` is local-only fallback.

## Search metadata filters

`atlas search "query" --profile public --audience consumer --purpose guide --visibility public` restricts local search to matching document metadata. Public-only artifacts reject unavailable profiles with `Profile contributor not available for repo; imported artifact contains public docs only.`.

## Public Surface

See this package/app source entrypoint and exported docs for supported contributor-facing APIs. Keep examples tied to this path: `apps/cli`.

## Invariants

Behavior should remain deterministic for the same inputs, preserve local-first boundaries, and report structured diagnostics where applicable.

## Related Docs

- Root runtime overview: `docs/runtime-surfaces.md`
- Architecture overview: `docs/architecture.md`

## Validation Pointer

```bash
bun test apps/cli/src/cli.test.ts
```
