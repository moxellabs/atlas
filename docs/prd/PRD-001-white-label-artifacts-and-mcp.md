---
title: "White-Label Artifact Roots and MCP Identity"
prd: PRD-001
status: Draft
owner: "Moxel Labs"
issue: "N/A"
date: 2026-04-27
version: "1.0"
---

# PRD: White-Label Artifact Roots and MCP Identity

---

## 1. Problem & Context

Atlas currently exposes Moxel/Atlas identity in two places that embedded adopters cannot hide:

1. **Physical artifact paths** — maintainer artifacts are written to `.moxel/atlas/`, consumer runtime state defaults to `~/.moxel/atlas`, remote imports store repo artifacts at `artifact/.moxel/atlas`, and many CLI messages/docs instruct maintainers to commit `.moxel/atlas`.
2. **MCP identity** — MCP server metadata uses `atlas-mcp`, resources use names such as `atlas-document`, skill aliases use `$atlas-*`, prompts mention ATLAS, and server/CLI output exposes Atlas identity to LLM clients and agent tool-call UIs.

This blocks organizations that want to embed Atlas build/index/MCP behavior inside their own CLI or internal developer platform. Their users should see and commit artifacts under their internal tool/team name, and LLM clients should call the internal MCP name rather than `atlas-mcp`.

Current relevant code surface:

- `apps/cli/src/commands/init.command.ts` hardcodes repo-local `.moxel/atlas`, `atlas.repo.json`, setup prompts, and next-step output.
- `apps/cli/src/commands/build.command.ts` detects `.moxel/atlas/atlas.repo.json`, exports `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json`, and prints commit guidance for `.moxel/atlas`.
- `apps/cli/src/commands/artifact.command.ts`, `apps/cli/src/commands/add-repo.command.ts`, `apps/cli/src/commands/adoption-templates.ts`, and `apps/cli/src/commands/missing-artifact.ts` hardcode default artifact paths and maintainer instructions.
- `packages/config/src/defaults/default-config.ts`, `packages/config/src/env.schema.ts`, and config loaders define `~/.moxel/atlas`, `ATLAS_CACHE_DIR`, and corpus DB defaults.
- `packages/mcp/src/server/metadata.ts`, `packages/mcp/src/server/create-mcp-server.ts`, MCP resources under `packages/mcp/src/resources/`, skill tools under `packages/mcp/src/tools/*skill*.tool.ts`, and prompts under `packages/mcp/src/prompts/` expose Atlas MCP names.
- `apps/cli/src/commands/mcp.command.ts`, `apps/server/src/services/mcp-bridge.service.ts`, and `apps/server/src/routes/mcp.route.ts` construct MCP surfaces without branding options.
- Documentation in `README.md`, `docs/ingestion-build-flow.md`, `docs/configuration.md`, `docs/runtime-surfaces.md`, and `docs/security.md` references `.moxel/atlas`, Atlas MCP, and maintainer artifact workflows.

This work adds a first-class white-label runtime profile while preserving default Atlas behavior when no option is supplied.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Configurable physical artifact root** | Commands that create, read, verify, fetch, import, clean, or mention repo-local artifacts use configured root | 100% of `.moxel/atlas` physical path call sites moved behind resolver |
| **Configurable runtime storage root** | Setup/config/index/runtime commands can derive cache and corpus paths from white-label root | `--moxellabs-atlas-artifact-root` / env / config precedence works in tests |
| **Configurable MCP identity** | MCP initialize response and LLM-visible resource/skill aliases reflect custom brand | Server name/title/resources/skill aliases use configured brand in stdio and HTTP tests |
| **Backward compatibility** | Existing Atlas users see no behavior change without options | Existing CLI/MCP tests pass with default `.moxel/atlas` and `atlas-mcp` |
| **Safe path handling** | Invalid roots cannot escape project or normalize ambiguously | Path validation rejects absolute paths and `..` traversal on POSIX/Windows |
| **Migration hinting** | Users switching roots see actionable notice if default artifacts already exist | Warning appears when custom root is used and `.moxel/atlas` exists but custom root missing |

**Guardrails (must not regress):**

- No automatic migration, copy, delete, or fallback between `.moxel/atlas` and custom roots.
- Atlas CLI default remains `.moxel/atlas` for repo-local artifacts and `~/.moxel/atlas` for runtime storage.
- `atlas.config.*` discovery and `--config` behavior remain compatible.
- MCP generic tool names such as `find_docs`, `read_outline`, and `read_section` remain stable by default so existing agents do not break.
- Artifacts still contain no secrets or absolute machine-local paths.

---

## 3. Users & Use Cases

### Primary: Internal platform team embedding Atlas

> As an internal platform team, I want to run Atlas build/index/MCP internals through my own CLI so that developers see my tool name and artifact path, not Moxel/Atlas branding.

**Preconditions:** Team controls wrapper CLI and can pass flags/env vars to Atlas commands or library entrypoints.

### Secondary: Repository maintainer publishing docs artifacts

> As a repository maintainer, I want generated artifacts under my organization's committed path so that repo diffs match internal conventions.

**Preconditions:** Maintainer runs `init`, `build`, `artifact verify`, and commits generated artifact files.

### Secondary: LLM/agent user consuming MCP

> As an LLM user, I want agent tool UIs to show my organization's MCP server name so that prompts and tool calls refer to the internal knowledge system.

**Preconditions:** MCP server starts through CLI or HTTP bridge with white-label MCP identity options.

### Future: Multi-brand Atlas host

> As a platform operator, I want one codebase to serve multiple branded knowledge tools so that each internal org can use its own artifact root and MCP identity.

---

## 4. Scope

### In scope

1. **Repo-local artifact root override** — Replace `.moxel/atlas` root with configurable relative root for `init`, `build`, `artifact verify/inspect`, `add-repo`, adoption templates, missing artifact instructions, docs, tests, and physical fetch/import paths.
2. **Runtime storage root override** — Support deriving `cacheDir`, `corpusDbPath`, repo cache, and config setup output from configured white-label storage, with existing explicit config values taking precedence.
3. **Option precedence** — Resolve values using CLI flag > environment variable > config file > default.
4. **Safe relative path validation** — Allow relative normalized paths, reject absolute paths and `..` traversal, and normalize separators for cross-platform behavior.
5. **MCP server identity override** — Allow custom MCP server `name`, `title`, and description so LLM clients call/display the white-labeled MCP rather than `atlas-mcp`.
6. **MCP Atlas-prefixed surface aliases** — Allow resource names and skill aliases that currently embed `atlas` to use configured MCP brand prefix.
7. **Migration hint, not migration** — If custom root is used, custom root missing, and default `.moxel/atlas` exists, warn that existing artifacts remain at default root and no migration was performed.
8. **Documentation and examples** — Update README/config/runtime docs with wrapper CLI examples and explicit branding behavior.
9. **Phase tasking** — Break implementation into /gsd-ready phases with acceptance gates.

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| Automatic artifact migration/copy | Could duplicate stale corpora or hide mistakes | Later PRD/issue |
| Reading fallback from `.moxel/atlas` when custom root missing | Violates clean separation between branded artifact universes | Later PRD/issue if needed |
| Renaming package names such as `@atlas/core` | Build-time package identity is not user-facing runtime white-labeling | N/A |
| Renaming generic MCP tools (`find_docs`, `read_outline`) | Tool name stability matters for agents and prompts; names are already brand-neutral | Later ADR if product wants prefixed tools |
| Registry publishing as branded package | Wrapper CLIs can consume Atlas source/packages directly | Later PRD/issue |
| Full text rewrite from ATLAS to custom brand in every prompt | Could reduce clarity/provenance; phase 1 only changes LLM-visible server identity and Atlas-prefixed aliases | Later PRD/issue |

### Design for future (build with awareness)

Introduce a shared `WhiteLabelProfile` or equivalent resolver with fields for physical paths and MCP identity. Keep it independent from CLI parsing so future SDK/server entrypoints can pass the same profile directly. Expose low-level helpers such as `resolveArtifactRoot()`, `resolveRuntimeRoot()`, and `resolveMcpIdentity()` rather than scattering flag/env/config reads across commands.

---

## 5. Functional Requirements

### FR-1: Resolve configurable repo-local artifact root

Commands that currently assume `.moxel/atlas` must resolve an effective artifact root from CLI flag, env, config, or default.

**Acceptance criteria:**

```gherkin
Given a Git checkout with no existing artifacts
When a user runs atlas init --moxellabs-atlas-artifact-root .acme/knowledge --repo-id github.com/acme/docs
Then metadata is written under .acme/knowledge/atlas.repo.json
And no .moxel/atlas directory is created
And CLI output says Artifact: .acme/knowledge
```

**Files:**

- `packages/config/src/defaults/default-config.ts` — Add default root constants and preserve `.moxel/atlas` default.
- `packages/config/src/atlas-config.schema.ts` — Add config fields for white-label/artifact roots.
- `packages/config/src/env.schema.ts` — Add env override parsing.
- `apps/cli/src/runtime/args.ts` — Recognize new global flag.
- `apps/cli/src/commands/init.command.ts` — Use resolver for artifact directory and metadata path.
- `apps/cli/src/commands/build.command.ts` — Use resolver for repo-local discovery/export.

### FR-2: Apply artifact root to all physical artifact workflows

All commands that verify, inspect, fetch, import, and instruct about committed artifacts must use the effective artifact root.

**Acceptance criteria:**

```gherkin
Given a repo artifact published at .acme/knowledge with manifest.json, corpus.db, checksums.json, and docs.index.json
When a consumer runs add-repo with --moxellabs-atlas-artifact-root .acme/knowledge
Then Atlas fetches or copies artifact/.acme/knowledge into runtime repo storage
And repo metadata records artifact/.acme/knowledge
And no artifact/.moxel/atlas path is used
```

**Files:**

- `apps/cli/src/commands/add-repo.command.ts` — Replace `MOXEL_ATLAS_REPO_ARTIFACT_PATH` call sites with effective root.
- `apps/cli/src/commands/artifact.command.ts` — Default `--path` to effective root and update root inference.
- `apps/cli/src/commands/adoption-templates.ts` — Render custom path and commands.
- `apps/cli/src/commands/adoption-template.command.ts` — Pass effective artifact path.
- `apps/cli/src/commands/missing-artifact.ts` — Render custom missing-artifact guidance.
- `packages/indexer/src/artifact.ts` — Accept artifact root/path labels where needed without changing artifact file schema.

### FR-3: Resolve configurable runtime storage root

Setup and runtime commands must support a white-label runtime root for cache, corpus DB, config file, repo storage, locks, logs, temp references, and clean/prune/doctor output when values are not explicitly configured.

**Acceptance criteria:**

```gherkin
Given ATLAS_WHITE_LABEL_ROOT=.acme/knowledge
When a user runs atlas setup --non-interactive in a test HOME
Then config is created under ~/.acme/knowledge/config.yaml
And cacheDir defaults to ~/.acme/knowledge
And corpusDbPath defaults to ~/.acme/knowledge/corpus.db
```

**Files:**

- `packages/config/src/loaders/load-config.ts` — Apply env/config precedence and derived defaults.
- `apps/cli/src/runtime/dependencies.ts` — Resolve default config target from profile.
- `apps/cli/src/commands/init.command.ts` — Setup prompt/output uses custom product/home label.
- `apps/cli/src/commands/clean.command.ts` — Clean generated artifacts from effective corpus path.
- `apps/cli/src/commands/prune.command.ts` — Prune effective repo cache root.
- `apps/cli/src/commands/doctor.command.ts` — Report effective cache/corpus paths.

### FR-4: Validate and normalize roots safely

Artifact and runtime roots must be relative-safe where used inside a checkout, and normalized consistently.

**Acceptance criteria:**

```gherkin
Given a user passes --moxellabs-atlas-artifact-root ../secret
When atlas init runs
Then command exits with CLI input error
And error says artifact root must be relative and cannot contain traversal
```

**Files:**

- `packages/config/src/paths/artifact-root.ts` or similar — New reusable validation helpers.
- `packages/config/src/atlas-config.schema.test.ts` — Schema validation cases.
- `apps/cli/src/cli.test.ts` — CLI rejection cases.

### FR-5: Preserve no-option backward compatibility

Without white-label options, commands and MCP surfaces must behave as they do today.

**Acceptance criteria:**

```gherkin
Given no white-label flag, env var, or config field
When atlas init and atlas build run in a Git checkout
Then artifacts are written to .moxel/atlas
And MCP initialize returns server name atlas-mcp
And existing tests expecting atlas-document resources still pass
```

**Files:**

- `apps/cli/src/cli.test.ts` — Existing tests remain valid.
- `packages/mcp/src/mcp.test.ts` — Existing default MCP tests remain valid.
- `apps/server/src/server.test.ts` — Existing HTTP MCP bridge tests remain valid.

### FR-6: Warn about existing default artifacts when custom root is used

When custom root is requested and default `.moxel/atlas` exists but custom root does not, commands must warn that existing artifacts remain in default root and no migration/fallback occurred.

**Acceptance criteria:**

```gherkin
Given .moxel/atlas/manifest.json exists
And .acme/knowledge does not exist
When atlas artifact inspect --moxellabs-atlas-artifact-root .acme/knowledge runs
Then command reports no artifact at .acme/knowledge
And emits a warning that .moxel/atlas exists but was not used or migrated
```

**Files:**

- `apps/cli/src/commands/init.command.ts` — Warn before writing custom metadata if default exists.
- `apps/cli/src/commands/build.command.ts` — Warn during repo-local discovery.
- `apps/cli/src/commands/artifact.command.ts` — Warn during inspect/verify.
- `apps/cli/src/commands/shared.ts` or new warning utility — Shared rendering.

### FR-7: Configure MCP server identity for LLM-visible branding

MCP construction must accept a white-label MCP identity. LLM clients should see custom server name/title/description rather than `atlas-mcp`/ATLAS defaults.

**Decision for user question 7/8:** MCP white-labeling includes server metadata and Atlas-prefixed surfaces. It does **not** rename generic tool names in phase 1 because `find_docs`, `read_outline`, and similar names are brand-neutral and stable for agents. If a client displays tool calls as `<server>.<tool>`, custom server name solves the requested “call custom brand as MCP” behavior without breaking existing prompts.

**Acceptance criteria:**

```gherkin
Given a user starts atlas mcp --moxellabs-atlas-mcp-name acme-knowledge
When an MCP client initializes
Then serverInfo.name is acme-knowledge
And serverInfo.title is Acme Knowledge MCP when title is not explicitly supplied
And tools/list still includes find_docs
```

**Files:**

- `packages/mcp/src/types.ts` — Add MCP identity/options types.
- `packages/mcp/src/server/metadata.ts` — Add default metadata factory.
- `packages/mcp/src/server/create-mcp-server.ts` — Accept profile and report effective metadata.
- `apps/cli/src/commands/mcp.command.ts` — Parse/pass MCP identity flags.
- `apps/server/src/services/mcp-bridge.service.ts` — Pass config/env identity into each session server.
- `apps/server/src/services/dependencies.ts` — Wire profile into bridge construction.

### FR-8: White-label Atlas-prefixed MCP resources and skill aliases

MCP resources and skill alias generation that currently include `atlas` must use configured brand prefix while preserving default `atlas-*` names when no option is supplied.

**Acceptance criteria:**

```gherkin
Given MCP brand prefix acme
When tools/list and resources/list are requested
Then resources include acme-document and acme-summary
And list_skills returns aliases such as $acme-session-skill
And default Atlas mode still returns atlas-document and $atlas-session-skill
```

**Files:**

- `packages/mcp/src/server/create-mcp-server.ts` — Generate resource name list from profile.
- `packages/mcp/src/resources/*.resource.ts` — Convert static names to factory or registration-time prefixing.
- `packages/mcp/src/resources/resource-utils.ts` — Support effective resource names without changing URI semantics unless required.
- `packages/mcp/src/tools/list-skills.tool.ts` — Generate brand-prefixed aliases.
- `packages/mcp/src/tools/use-skill.tool.ts` — Resolve brand-prefixed aliases and maintain default aliases where compatibility requires.
- `packages/mcp/src/prompts/*.prompt.ts` — Replace ATLAS/tool guidance where it names `atlas-*` aliases; keep generic tool names stable.

### FR-9: Expose explicit white-label flags and env/config keys

The CLI must make white-labeling explicit so users understand they are replacing Moxel Labs/Atlas artifact and MCP identity.

**Acceptance criteria:**

```gherkin
Given a wrapper CLI invokes atlas build --moxellabs-atlas-artifact-root .acme/knowledge
When build completes
Then output includes Artifact: .acme/knowledge
And JSON output includes artifactRoot: .acme/knowledge
```

**Files:**

- `apps/cli/src/runtime/args.ts` — Add explicit global flags.
- `apps/cli/src/index.ts` — Help text documents flags.
- `packages/config/src/env.schema.ts` — Add env keys.
- `atlas.config.example.json` — Add config example.

Proposed public names:

- CLI flag: `--moxellabs-atlas-artifact-root <relative-path>`
- CLI flag alias: `--artifact-root <relative-path>` for shorter expert use
- Env: `ATLAS_ARTIFACT_ROOT=<relative-path>`
- Config: `whiteLabel.artifactRoot`
- MCP CLI flag: `--moxellabs-atlas-mcp-name <name>`
- MCP CLI flag alias: `--mcp-name <name>`
- Env: `ATLAS_MCP_NAME=<name>`
- Config: `whiteLabel.mcp.name`, `whiteLabel.mcp.title`, `whiteLabel.mcp.resourcePrefix`

### FR-10: Update documentation and tests

Docs and tests must explain default Atlas behavior, white-label wrapper behavior, migration non-goals, and MCP naming.

**Acceptance criteria:**

```gherkin
Given a developer reads docs/configuration.md
When they search for white-label
Then they find flag/env/config examples, precedence, invalid path examples, and migration warning behavior
```

**Files:**

- `README.md` — Add white-label quickstart and embedded CLI example.
- `docs/configuration.md` — Add config/env precedence details.
- `docs/ingestion-build-flow.md` — Update maintainer artifact workflow.
- `docs/runtime-surfaces.md` — Update MCP identity behavior.
- `docs/security.md` — Reconfirm no secrets/path leaks.
- `apps/cli/src/cli.test.ts`, `packages/mcp/src/mcp.test.ts`, `apps/server/src/server.test.ts`, `packages/config/src/loaders/load-config.test.ts` — Test coverage.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Compatibility** | No behavior change with no white-label flags/env/config. |
| **Security** | Roots must not allow path traversal outside checkout for repo-local artifacts; artifacts must not serialize absolute machine-local paths. |
| **Portability** | Normalize separators and reject invalid roots consistently on Linux/macOS/Windows path semantics. |
| **Operability** | CLI output and JSON output must include effective artifact root/MCP identity where relevant. |
| **Testability** | New resolver logic must have unit tests plus end-to-end CLI/MCP tests. |
| **Maintainability** | No new scattered `.moxel/atlas`, `atlas-mcp`, or `atlas-*` hardcodes outside defaults/tests/docs. |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Missed hardcoded `.moxel/atlas` path causes mixed artifact roots | High | Medium | Add grep-based test or lint check for hardcoded path outside default constants/docs snapshots. |
| MCP resource renaming breaks existing clients | Medium | Medium | Keep defaults unchanged; only rename with explicit config; preserve URI semantics where possible. |
| Tool renaming breaks LLM prompts and client automations | High | Medium | Do not rename generic tools in phase 1; revisit only with ADR. |
| Env/config names become confusing | Medium | Medium | Provide explicit long flags plus short aliases; document precedence. |
| Runtime root and repo-local root semantics blur | Medium | Medium | Separate fields: `artifactRoot` for committed repo artifacts, `runtimeRoot`/`cacheDir` for home/cache state. |
| Migration warning annoys fresh projects with intentionally custom root | Low | Medium | Warn only when default root exists and custom root missing. |

### Assumptions

- Wrapper CLIs can pass flags or env vars on every invocation.
- Existing config file support can carry new `whiteLabel` fields without breaking old configs.
- User wants clean separation: no fallback reads and no migration in this phase.
- MCP client UIs typically display server name plus tool name, so custom server identity satisfies “call custom brand as MCP” without renaming `find_docs`.
- Default artifact schema names such as `moxel-atlas-artifact/v1` may remain for compatibility unless implementation finds a safe schema alias path.

---

## 8. Design Decisions

### D1: Replace full artifact root, not just one path segment

**Options considered:**

1. Replace full `.moxel/atlas` — Maximum white-label control; no Moxel path leakage.
2. Replace only `atlas` — Leaves `.moxel` brand in user repos.
3. Replace only `.moxel` — Leaves `atlas` brand in user repos.

**Decision:** Replace full root with a configurable relative path.

**Rationale:** User explicitly wants physical artifacts under internal tool/team/CLI name.

### D2: Use explicit white-label flags with short aliases

**Options considered:**

1. `--artifact-root` only — Clear to implementers but not explicit about white-labeling Moxel/Atlas.
2. `--moxellabs-atlas-artifact-root` only — Explicit but verbose.
3. Both long explicit flag and short alias — Clear for wrapper docs and convenient for direct users.

**Decision:** Support both `--moxellabs-atlas-artifact-root` and `--artifact-root`, with identical precedence at CLI level.

**Rationale:** User requested more explicit naming than `artifact-root` alone while still liking `artifact-root`.

### D3: No migration or fallback in this phase

**Options considered:**

1. Start fresh under custom root — Predictable, no stale data copy.
2. Fallback read from `.moxel/atlas` — Smooth but hides misconfiguration.
3. Auto-copy old root — Convenient but can duplicate stale artifacts.

**Decision:** No migration and no fallback; warn when default artifacts exist.

**Rationale:** User selected no migration and no fallback, with hinting for existing default artifacts.

### D4: MCP server identity changes first; generic tool names stay stable

**Options considered:**

1. Rename MCP server metadata only — Solves most LLM UI branding with low breakage.
2. Rename every MCP tool — Full branding but high compatibility risk.
3. Rename Atlas-prefixed resources/skill aliases plus server metadata — Good white-label coverage with manageable compatibility.

**Decision:** Implement option 3; keep brand-neutral generic tool names stable.

**Rationale:** Current generic tools do not expose Atlas brand. Atlas-prefixed resources and aliases do. Server name is the MCP identity clients show.

### D5: Central resolver owns precedence

**Options considered:**

1. Each command reads flags/env/config directly — Fast but error-prone.
2. Shared resolver in config/runtime package — Consistent and testable.

**Decision:** Shared resolver.

**Rationale:** This feature crosses CLI, server, MCP, config, docs, and tests.

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `packages/config/src/defaults/default-config.ts` | Modify | FR-1, FR-3, FR-5 | Centralize default artifact/runtime roots and preserve Atlas defaults. |
| `packages/config/src/atlas-config.schema.ts` | Modify | FR-1, FR-3, FR-4, FR-9 | Add `whiteLabel` config schema. |
| `packages/config/src/env.schema.ts` | Modify | FR-1, FR-3, FR-7, FR-9 | Parse artifact/MCP env overrides. |
| `packages/config/src/loaders/load-config.ts` | Modify | FR-3, FR-9 | Apply env/config/default precedence. |
| `packages/config/src/paths/artifact-root.ts` | New | FR-1, FR-4 | Validate/normalize artifact roots. |
| `apps/cli/src/runtime/args.ts` | Modify | FR-1, FR-7, FR-9 | Add global white-label flag parsing. |
| `apps/cli/src/runtime/dependencies.ts` | Modify | FR-3, FR-9 | Resolve config target and runtime paths from profile. |
| `apps/cli/src/index.ts` | Modify | FR-9, FR-10 | Help text for explicit white-label flags. |
| `apps/cli/src/commands/init.command.ts` | Modify | FR-1, FR-3, FR-6 | Write metadata under custom root and setup runtime root. |
| `apps/cli/src/commands/build.command.ts` | Modify | FR-1, FR-2, FR-6 | Detect/export repo-local artifacts under custom root. |
| `apps/cli/src/commands/artifact.command.ts` | Modify | FR-2, FR-6 | Verify/inspect custom artifact roots. |
| `apps/cli/src/commands/add-repo.command.ts` | Modify | FR-2 | Fetch/copy/import custom repo artifact paths. |
| `apps/cli/src/commands/adoption-templates.ts` | Modify | FR-2, FR-10 | Render branded maintainer request text. |
| `apps/cli/src/commands/adoption-template.command.ts` | Modify | FR-2 | Pass effective artifact root. |
| `apps/cli/src/commands/missing-artifact.ts` | Modify | FR-2, FR-10 | Render branded missing artifact guidance. |
| `apps/cli/src/commands/clean.command.ts` | Modify | FR-3 | Clean effective runtime corpus artifacts. |
| `apps/cli/src/commands/prune.command.ts` | Modify | FR-3 | Prune effective runtime repo caches. |
| `apps/cli/src/commands/doctor.command.ts` | Modify | FR-3 | Report effective white-label roots. |
| `packages/indexer/src/artifact.ts` | Modify | FR-2, FR-10 | Support configurable artifact root labels and safety scans. |
| `packages/mcp/src/types.ts` | Modify | FR-7, FR-8 | Add MCP branding option types. |
| `packages/mcp/src/server/metadata.ts` | Modify | FR-7 | Build effective server metadata. |
| `packages/mcp/src/server/create-mcp-server.ts` | Modify | FR-7, FR-8 | Register MCP with effective metadata/resources/prompts. |
| `packages/mcp/src/resources/*.resource.ts` | Modify | FR-8 | Convert static Atlas-prefixed names to brand-aware names. |
| `packages/mcp/src/resources/resource-utils.ts` | Modify | FR-8 | Support resource registration name overrides. |
| `packages/mcp/src/tools/list-skills.tool.ts` | Modify | FR-8 | Emit brand-prefixed skill aliases. |
| `packages/mcp/src/tools/use-skill.tool.ts` | Modify | FR-8 | Resolve brand-prefixed skill aliases. |
| `packages/mcp/src/prompts/*.prompt.ts` | Modify | FR-7, FR-8 | Use effective MCP names where prompts mention Atlas surfaces. |
| `apps/cli/src/commands/mcp.command.ts` | Modify | FR-7, FR-9 | Pass CLI MCP name/title/prefix options. |
| `apps/server/src/services/mcp-bridge.service.ts` | Modify | FR-7 | Construct per-session MCP server with effective identity. |
| `apps/server/src/services/dependencies.ts` | Modify | FR-7 | Wire config/env profile into MCP bridge. |
| `apps/server/src/routes/mcp.route.ts` | Modify | FR-7 | Preserve HTTP MCP behavior with branded server identity. |
| `apps/cli/src/cli.test.ts` | Modify | FR-1, FR-2, FR-4, FR-5, FR-6, FR-9 | CLI end-to-end coverage. |
| `packages/config/src/loaders/load-config.test.ts` | Modify | FR-3, FR-4, FR-9 | Config/env precedence coverage. |
| `packages/mcp/src/mcp.test.ts` | Modify | FR-7, FR-8 | MCP server/resource/skill alias coverage. |
| `apps/server/src/server.test.ts` | Modify | FR-7 | HTTP MCP branded initialize coverage. |
| `README.md` | Modify | FR-10 | White-label quickstart. |
| `docs/configuration.md` | Modify | FR-10 | Config/env precedence. |
| `docs/ingestion-build-flow.md` | Modify | FR-10 | Maintainer artifact root workflow. |
| `docs/runtime-surfaces.md` | Modify | FR-10 | MCP identity behavior. |
| `docs/security.md` | Modify | FR-10 | Safety constraints. |
| `atlas.config.example.json` | Modify | FR-9, FR-10 | Example white-label config. |

---

## 10. Dependencies & Constraints

- Bun remains default runtime/test runner; use `bun test`.
- MCP package uses `@modelcontextprotocol/sdk`; server metadata must remain SDK-compatible.
- Existing artifact files remain `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json` unless a later ADR changes schema.
- Config precedence must remain compatible with existing `ATLAS_CONFIG`, `ATLAS_CACHE_DIR`, and explicit `cacheDir`/`corpusDbPath` behavior.
- Path validation must handle both POSIX `/` and Windows `\` separators even when tests run on Linux.

---

## 11. Rollout Plan

1. **Phase 1 — Resolver and CLI artifact root**
   - Add config/env/CLI resolution and validation helpers.
   - Wire `init`, `build`, `artifact`, and adoption/missing-artifact command paths.
   - Add migration warning.
   - Gate: CLI tests prove default and custom repo-local artifacts.
2. **Phase 2 — Runtime storage and consumer import**
   - Wire `setup`, config loader defaults, `add-repo`, runtime repo cache, clean/prune/doctor.
   - Gate: consumer import fetches/copies `artifact/<custom-root>` and runtime DB lives in custom root when derived.
3. **Phase 3 — MCP white-label identity**
   - Add MCP server metadata options, brand-aware resource names, and skill aliases.
   - Wire CLI stdio and server HTTP bridge.
   - Gate: MCP initialize/tools/resources tests pass for default and custom identity.
4. **Phase 4 — Docs, hardcode audit, and release readiness**
   - Update docs/examples.
   - Add grep/lint guard for hardcoded `.moxel/atlas`, `atlas-mcp`, and `atlas-*` surfaces outside approved defaults/docs/tests.
   - Gate: `bun test`, docs review, and manual wrapper smoke test.

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Should schema identifiers such as `moxel-atlas-artifact/v1` remain stable or gain aliases? | Moxel Labs | Phase 1 planning | Open |
| Q2 | Should custom MCP resource names coexist with default `atlas-*` aliases in branded mode? | Moxel Labs | Phase 3 planning | Open |
| Q3 | Should `ATLAS_CACHE_DIR` remain highest-priority runtime storage override when `ATLAS_ARTIFACT_ROOT` is also set? | Moxel Labs | Phase 2 planning | **Resolved:** Existing explicit cache env/config should win over derived white-label runtime root. |
| Q4 | Should wrapper CLIs consume a library API instead of shelling out to Atlas CLI? | Moxel Labs | Later | Open |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| `docs/ingestion-build-flow.md` | Existing artifact publishing workflow updated by this PRD. |
| `docs/runtime-surfaces.md` | Existing MCP/server surface documentation updated by this PRD. |
| `docs/configuration.md` | Existing config/env precedence documentation updated by this PRD. |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-27 | Initial draft | Pi |

---

## 15. Verification (Appendix)

Post-implementation checklist:

1. Run `bun test` at repo root.
2. In temp Git repo, run `atlas init --moxellabs-atlas-artifact-root .acme/knowledge --repo-id github.com/acme/docs` and verify only `.acme/knowledge/atlas.repo.json` is created.
3. Run `atlas build --moxellabs-atlas-artifact-root .acme/knowledge` and verify `manifest.json`, `corpus.db`, `docs.index.json`, and `checksums.json` exist under custom root.
4. Run `atlas artifact verify --moxellabs-atlas-artifact-root .acme/knowledge --fresh` and verify success.
5. Create `.moxel/atlas` without `.acme/knowledge`, run custom-root inspect, and verify migration hint appears without fallback.
6. Run `atlas setup --non-interactive` with white-label env and verify config/cache/corpus paths.
7. Start `atlas mcp --moxellabs-atlas-mcp-name acme-knowledge` and verify MCP initialize `serverInfo.name` is `acme-knowledge`.
8. Verify custom MCP resource names/skill aliases appear while generic tools remain stable.
9. Verify docs show wrapper CLI examples and no outdated committed-artifact instructions remain.
