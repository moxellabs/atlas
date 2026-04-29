# Roadmap: Atlas v1.1 Repo Consumption UX

## Overview

Atlas v1.0 hardening is complete. The next milestone shifts Atlas from contributor/operator configuration toward big-org repo and library consumption: committed `.moxel/atlas` artifacts, user-home `~/.moxel/atlas` state, host-aware repo resolution, artifact-only add-repo, and safe local-only fallback indexing.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases: Urgent insertions if needed later

- [x] **Phase 1: Baseline Validation** - Establish reliable local validation and inventory current failures. Completed 2026-04-26.
- [x] **Phase 2: Security Boundaries** - Harden credential redaction and local-first guarantees. Completed 2026-04-26.
- [x] **Phase 3: Build Reliability** - Strengthen sync/build, incremental planning, and store consistency. Completed 2026-04-26.
- [x] **Phase 4: Runtime Surfaces** - Verify CLI, HTTP, OpenAPI, and MCP surfaces stay thin and consistent. Completed 2026-04-26.
- [x] **Phase 5: Documentation Alignment** - Refresh active docs and package/app docs from implementation state. Completed 2026-04-26.
- [x] **Phase 6: Retrieval and Context Quality** - Improve retrieval usefulness and MCP context performance with answer-ready, scoped context packets. Completed 2026-04-26.
- [x] **Phase 7: Agent Tool Calling Adoption** - Increase likelihood that agents call Atlas MCP for indexed repository questions. Completed 2026-04-26.
- [x] **Phase 8: MCP Adoption Evaluation Harness** - Measure whether agents call Atlas MCP for indexed repository questions and avoid unnecessary calls for unrelated or non-indexed questions. Completed 2026-04-26.
- [x] **Phase 9: Large Corpus Performance and Token Budget Reliability** - Keep sync, build, retrieval, and MCP context planning bounded and explainable as indexed corpora grow. Completed 2026-04-26.
- [x] **Phase 10: Release Readiness and Distribution** - Validate package metadata, CLI/server distribution surfaces, and safe local release dry-run workflow. Completed 2026-04-26.
- [x] **Phase 11: Moxel Atlas Path and Home Layout** - Replace contributor-oriented defaults with `.moxel/atlas` and `~/.moxel/atlas` clean-break paths.
- [x] **Phase 12: Host-Aware Repo Identity and Folder Registry** - Use `host/owner/name` repo IDs and per-repo folder metadata. Completed 2026-04-27.
- [x] **Phase 13: Enterprise Host Setup and Repo Resolver** - Resolve shorthand, SSH, HTTPS, and local-path repo inputs across configured Git hosts. Completed 2026-04-27.
- [x] **Phase 14: Repo Artifact Build Format** - Let maintainers create committed ready-to-import `.moxel/atlas` artifacts. Completed 2026-04-27.
- [x] **Phase 15: Artifact-Only Remote Fetch and Stale Import UX** - Fetch remote artifacts without full clone and warn-but-import stale artifacts. (completed 2026-04-27)
- [x] **Phase 16: Global Corpus Import and Multi-Repo Runtime** - Import artifacts into `~/.moxel/atlas/corpus.db` for runtime search/retrieval/MCP. Completed 2026-04-27.
- [x] **Phase 17: Missing Artifact Fallback and Local-Only Index** - Offer clone+index, skip, maintainer instructions, and issue/PR generation when artifacts are missing. (completed 2026-04-27)
- [x] **Phase 18: Adoption Instructions and Issue/PR Templates** - Help consumers ask repo owners to add artifacts without automating org-specific Git workflows. (completed 2026-04-27)
- [x] **Phase 19: Artifact Verification and CI Freshness** - Add artifact verify/inspect and CI freshness checks for repo owners.
- [x] **Phase 20: Consumer UX Polish and Documentation** - Finalize docs, help, troubleshooting, and end-to-end UX regression tests. Completed 2026-04-27.
- [x] **Phase 21: White-label artifact resolver** - Add shared identity-aware artifact resolver. Completed 2026-04-27.
- [x] **Phase 22: White-label runtime storage** - Add identity-root runtime storage and repo internals. Completed 2026-04-27.
- [x] **Phase 23: White-label MCP identity** - Add explicit MCP identity configuration and bridge wiring. Completed 2026-04-27.
- [x] **Phase 24: White-label docs and audit** - Correct identity-root artifact mirror semantics and docs. Completed 2026-04-28.
- [x] **Phase 25: Document Metadata Profiles and Public Artifact Filtering** - Add metadata-aware public artifact filtering. Completed 2026-04-28.
- [x] **Phase 26: Atlas Self-indexing and First-party Skills** - Dogfood Atlas public artifact and first-party skills. Completed 2026-04-28.
- [x] **Phase 27: Interactive Skill Creator Workflow** - Add guided skill creator workflow. Completed 2026-04-28.
- [x] **Phase 28: Public Consumption Docs Site Readiness** - Polish public docs for generated-site consumption. Completed 2026-04-28.
- [x] **Phase 29: Server Docs Portal and OpenAPI Polish** - Add server docs portal and OpenAPI polish. Completed 2026-04-28.
- [x] **Phase 30: Scalar-first OpenAPI Docs Refinement** - Correct Phase 29 UAT gap by making `/docs` Scalar/OpenAPI-first and improving OpenAPI content.
- [x] **Phase 31: Open-source Release Prep** - Define public/private repository boundary, license, attribution, and community docs. Completed 2026-04-28.
- [x] **Phase 32: CI Validation** - Add public pull-request and push CI validation. Completed 2026-04-28.
- [x] **Phase 33: Release Pipeline** - Add safe tag-driven npm and GitHub release automation. Completed 2026-04-28.
- [x] **Phase 34: Commander and Clack CLI Migration** - Hard-cut CLI parsing/help/interactive foundations to Commander and Clack. Completed 2026-04-28.
- [x] **Phase 35: Embedded Enterprise CLI Mount** - Let enterprise CLIs mount Atlas under an existing Commander namespace. Completed 2026-04-28.
- [x] **Phase 36: Production Build Diagnostics and Nested Error Surfacing** - Preserve and print nested build causes, failing stage, and entity path for real repo failures. (completed 2026-04-29)
- [x] **Phase 37: Real-Repo Build Pipeline Repro and Root-Cause Fixes** - Reproduce topology-success/build-failure boundary and fix actual build-stage bugs revealed by diagnostics. (completed 2026-04-29)
- [x] **Phase 38: Local-Git Checkout Semantics and Local Branch Support** - Support explicit current-checkout local-git mode and clarify remote-ref behavior. (completed 2026-04-29)
- [x] **Phase 39: Init, Repo State, and Command-State Clarity** - Infer repo targets from cwd, Git origin, repo metadata, and bare repo names; avoid manual default GitHub host setup; explain config/registry/store/cache layers in diagnostics. (completed 2026-04-29)
- [x] **Phase 40: Command UX Simplification and Production Onboarding** - Simplify `setup`/`init`/`build`/`index` mental model with guided next-step UX, clearer aliases, and no standalone setup branding prompts. (completed 2026-04-29)
- [x] **Phase 41: Production Onboarding UAT and Release Gate** - Add scripted production-like UAT to prevent regressions before release. (completed 2026-04-29)
- [x] **Phase 42: Post-release Bug Hunt Remediation** - Fix prioritized bugs found after v0.1.3 across CLI runtime/env handling, mounted MCP identity/exports, repo removal, source checkout diagnostics, and store consistency. (completed 2026-04-29)

## Phase Details

### Phase 1: Baseline Validation

**Goal**: Establish current health for typecheck, lint, tests, and important workflows.
**Depends on**: Nothing (first phase)
**Requirements**: REQ-01, REQ-02, REQ-03
**Success Criteria** (what must be TRUE):

1. `bun run typecheck` result is known and documented.
2. `bun run lint` result is known and documented.
3. `bun test` result is known and documented.
4. Any failures have clear reproduction commands and owning package paths.
   **Plans**: 2 plans

Plans:

- [x] 01-01: Run validation suite and record failures.
- [x] 01-02: Triage failures by app/package boundary.

### Phase 2: Security Boundaries

**Goal**: Protect local-first and credential handling invariants across CLI, server, MCP, and docs.
**Depends on**: Phase 1
**Requirements**: REQ-04, REQ-05, REQ-06
**Success Criteria** (what must be TRUE):

1. Token sources from `README.md` and `docs/security.md` are not written to configs, logs, diagnostics, OpenAPI examples, MCP output, or snapshots.
2. Retrieval code does not fetch remote source content at query time.
3. Server local-origin/CORS behavior is covered by tests or explicit docs.
4. Security documentation matches implementation.
   **Plans**: 2 plans

Plans:

- [x] 02-01: Audit credential redaction and local-first boundaries.
- [x] 02-02: Add or update tests/docs for security invariants.

### Phase 3: Build Reliability

**Goal**: Improve confidence in source sync, incremental build planning, and SQLite persistence consistency.
**Depends on**: Phase 1
**Requirements**: REQ-07, REQ-08, REQ-09
**Success Criteria** (what must be TRUE):

1. Incremental build cases cover noop, rebuild all, rebuild affected docs, delete removed docs, and targeted selectors.
2. Store writes remain transactional across build boundaries.
3. FTS/search records stay consistent with documents, sections, chunks, summaries, skills, and manifests.
4. Source adapters continue returning repository-relative POSIX paths.
   **Plans**: 3 plans

Plans:

- [x] 03-01: Review and expand incremental build coverage.
- [x] 03-02: Verify store transaction and migration safety.
- [x] 03-03: Audit source adapter path and diff edge cases.

### Phase 4: Runtime Surfaces

**Goal**: Keep CLI, HTTP server, OpenAPI, and MCP behavior consistent with package-layer contracts.
**Depends on**: Phase 2, Phase 3
**Requirements**: REQ-10, REQ-11, REQ-12
**Success Criteria** (what must be TRUE):

1. CLI command list, help text, docs, and tests align with `apps/cli/src/index.ts`.
2. Server routes in `apps/server/src/routes/` align with OpenAPI docs and route composition.
3. MCP tools read from store/retrieval services without bypassing architecture boundaries.
4. Optional server plugins are documented or tested for enabled/disabled modes.
   **Plans**: TBD

Plans:

- [x] 04-01: Audit CLI command surface and docs.
- [x] 04-02: Audit server routes, OpenAPI, and MCP composition.

### Phase 5: Documentation Alignment

**Goal**: Update active docs and package/app docs so agents and contributors can trust them.
**Depends on**: Phase 4
**Requirements**: REQ-13, REQ-14
**Success Criteria** (what must be TRUE):

1. `docs/architecture.md`, `docs/ingestion-build-flow.md`, `docs/runtime-surfaces.md`, and `docs/security.md` match implementation.
2. `apps/*/docs/index.md` and `packages/*/docs/index.md` are checked for stale claims.
3. `README.md` common workflows remain accurate.
4. Archive docs remain clearly historical and excluded from active self-indexing.
   **Plans**: TBD

Plans:

- [x] 05-01: Refresh active architecture and operations docs.
- [x] 05-02: Refresh app/package docs and README workflow notes.

## Progress

**Execution Order:**
Phases execute in dependency order: 1 → 2 and 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 27 → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41 → 42

| Phase                                                        | Plans Complete | Status   | Completed  |
| ------------------------------------------------------------ | -------------- | -------- | ---------- |
| 1. Baseline Validation                                       | 2/2            | Complete | 2026-04-26 |
| 2. Security Boundaries                                       | 2/2            | Complete | 2026-04-26 |
| 3. Build Reliability                                         | 3/3            | Complete | 2026-04-26 |
| 4. Runtime Surfaces                                          | 2/2            | Complete | 2026-04-26 |
| 5. Documentation Alignment                                   | 2/2            | Complete | 2026-04-26 |
| 6. Retrieval and Context Quality                             | 1/1            | Complete | 2026-04-26 |
| 7. Agent Tool Calling Adoption                               | 1/1            | Complete | 2026-04-26 |
| 8. MCP Adoption Evaluation Harness                           | 2/2            | Complete | 2026-04-26 |
| 9. Large Corpus Performance and Token Budget Reliability     | 2/2            | Complete | 2026-04-26 |
| 10. Release Readiness and Distribution                       | 2/2            | Complete | 2026-04-26 |
| 11. Moxel Atlas Path and Home Layout                         | 2/2            | Complete | 2026-04-27 |
| 12. Host-Aware Repo Identity and Folder Registry             | 2/2            | Complete | 2026-04-27 |
| 13. Enterprise Host Setup and Repo Resolver                  | 2/2            | Complete | 2026-04-27 |
| 14. Repo Artifact Build Format                               | 2/2            | Complete | 2026-04-27 |
| 15. Artifact-Only Remote Fetch and Stale Import UX           | 2/2            | Complete | 2026-04-27 |
| 16. Global Corpus Import and Multi-Repo Runtime              | 2/2            | Complete | 2026-04-27 |
| 17. Missing Artifact Fallback and Local-Only Index           | 2/2            | Complete | 2026-04-27 |
| 18. Adoption Instructions and Issue/PR Templates             | 2/2            | Complete | 2026-04-27 |
| 19. Artifact Verification and CI Freshness                   | 2/2            | Complete | 2026-04-27 |
| 20. Consumer UX Polish and Documentation                     | 2/2            | Complete | 2026-04-27 |
| 21. White-label artifact resolver                            | 2/2            | Complete | 2026-04-27 |
| 22. White-label runtime storage                              | 2/2            | Complete | 2026-04-27 |
| 23. White-label MCP identity                                 | 2/2            | Complete | 2026-04-27 |
| 24. White-label docs and audit                               | 2/2            | Complete | 2026-04-28 |
| 25. Document Metadata Profiles and Public Artifact Filtering | 2/2            | Complete | 2026-04-28 |
| 26. Atlas Self-indexing and First-party Skills               | 2/2            | Complete | 2026-04-28 |
| 27. Interactive Skill Creator Workflow                       | 2/2            | Complete | 2026-04-28 |
| 28. Public Consumption Docs Site Readiness                   | 2/2            | Complete | 2026-04-28 |
| 29. Server Docs Portal and OpenAPI Polish                    | 2/2            | Complete | 2026-04-28 |
| 30. Scalar-first OpenAPI Docs Refinement                     | 2/2            | Complete | 2026-04-28 |
| 31. Open-source Release Prep                                 | 2/2            | Complete | 2026-04-28 |
| 32. CI Validation                                            | 1/1            | Complete | 2026-04-28 |
| 33. Release Pipeline                                         | 2/2            | Complete | 2026-04-28 |
| 34. Commander and Clack CLI Migration                        | 3/3            | Complete | 2026-04-28 |
| 35. Embedded Enterprise CLI Mount                            | 2/2            | Complete | 2026-04-28 |
| 36. Production Build Diagnostics and Nested Error Surfacing  | 2/2            | Complete | 2026-04-29 |
| 37. Real-Repo Build Pipeline Repro and Root-Cause Fixes      | 2/2            | Complete | 2026-04-29 |
| 38. Local-Git Checkout Semantics and Local Branch Support    | 2/2            | Complete | 2026-04-29 |
| 39. Init, Repo State, and Command-State Clarity              | 3/3            | Complete | 2026-04-29 |
| 40. Command UX Simplification and Production Onboarding      | 3/3            | Complete | 2026-04-29 |
| 41. Production Onboarding UAT and Release Gate               | 1/1            | Complete | 2026-04-29 |
| 42. Post-release Bug Hunt Remediation                        | 3/3            | Complete | 2026-04-29 |

### Phase 6: Retrieval and Context Quality

**Goal:** Improve retrieval usefulness and MCP context performance so agents receive high-signal, non-poisoned context with fewer tool calls and clearer human-readable scope names.
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 1 plan

Plans:

- [x] 06-01: Improve answer-ready context Complete.

### Phase 7: Agent Tool Calling Adoption

**Goal:** Increase likelihood that agents and LLMs call Atlas MCP whenever user questions concern a repository already indexed by Atlas, instead of answering from stale memory or skipping available repo context.
**Description:** Research 2026 agent tool-use, tool-retrieval, MCP, and agentic RAG literature, then turn findings into Atlas-facing improvements that make MCP use more discoverable, measurable, and behaviorally likely. Focus on when-to-call decisions, tool descriptions, prompts/resources, indexed-repo detection, evaluations, and guardrails that nudge agents toward Atlas MCP for repo-specific questions without forcing irrelevant calls.
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 1 plan

**Research focus:**

1. 2026 tool-use unification/evaluation work such as UniToolCall and The Evolution of Tool Use in LLM Agents.
2. 2026 MCP-specific benchmarks such as MCP-Atlas, MCPAgentBench revisions, and ICLR 2026 MCP-Bench findings.
3. Tool retrieval and tool-RAG approaches, prioritizing 2026 ScaleMCP-style and large-catalog MCP/tool selection work over older 2025 baselines.
4. Prompt/resource design that makes available repo coverage obvious to agents before answering.
5. Evaluation harnesses that measure whether agents call Atlas MCP for indexed-repo questions and avoid calls for unrelated questions.

**Success Criteria** (what must be TRUE):

1. 2026 papers and benchmark findings are summarized with implications for Atlas MCP; older 2025 work is used only as baseline context.
2. Atlas exposes indexed repository coverage in a form agents can discover before answering repo-specific questions.
3. MCP tool descriptions, resource metadata, or prompt guidance make `plan_context`/retrieval tool use clearly appropriate for indexed-repo questions.
4. Tests or scripted evaluations measure call/no-call behavior for indexed, ambiguous, and non-indexed repo questions.
5. Changes preserve local-first guarantees and do not encourage unnecessary external lookup or credential exposure.

Plans:

- [x] 07-01: Expose indexed repo coverage for MCP discovery.

### Phase 8: MCP Adoption Evaluation Harness

**Goal:** Prove agents call Atlas MCP when user questions concern indexed repositories, and avoid Atlas calls when questions are unrelated or non-indexed.
**Description:** Turn Phase 6 and Phase 7 behavior claims into repeatable call/no-call evaluations. Cover indexed repository prompts, ambiguous repository references, non-indexed repository prompts, generic questions, and security-sensitive prompts.
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Scripted evaluations cover indexed, ambiguous, non-indexed, generic, and security-sensitive prompts.
2. Expected tool-use behavior is explicit for `atlas://manifest`, `plan_context`, and no-call cases.
3. Evaluation output reports pass/fail results and adoption score or equivalent summary.
4. Tests or fixtures run locally without network access and preserve local-first guarantees.
5. Documentation explains how to run and interpret MCP adoption evaluations.

Plans:

- [x] 08-01: Add MCP tool-call adoption eval scenarios.
- [x] 08-02: Add adoption scoring/reporting and documentation.

### Phase 9: Large Corpus Performance and Token Budget Reliability

**Goal:** Keep sync, build, retrieval, and MCP context Complete reliable as indexed documentation corpora grow.
**Description:** Add large-corpus performance scenarios and harden token-budget enforcement so richer `plan_context` payloads stay bounded, explain omissions, and remain useful for agents.
**Requirements**: TBD
**Depends on:** Phase 8
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Large-corpus fixture or generated-corpus scenarios exercise build, incremental rebuild, retrieval, and context Complete.
2. `plan_context` output stays within configured token budgets.
3. Omission diagnostics explain budget, authority, freshness, archive, or redundancy exclusions.
4. Performance expectations for local validation are documented.
5. Retrieval remains store-backed and does not import source adapters or fetch remote content at query time.

Plans:

- [x] 09-01: Add large-corpus build/retrieval performance scenarios.
- [x] 09-02: Harden token-budget enforcement and context omission diagnostics.

### Phase 10: Release Readiness and Distribution

**Goal:** Turn completed v1.0 hardening into a shippable local-first release by validating package metadata, CLI/server distribution surfaces, workspace exports, docs, and release automation.
**Description:** Audit package manifests and add local-only distribution smoke checks so Atlas can be installed, imported, and verified without relying on monorepo-only assumptions or publishing to a registry.
**Requirements**: TBD
**Depends on:** Phase 9
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Publishable packages expose intended public APIs through correct `exports`, `types`, dependencies, and files/build intent.
2. CLI binary/help and server runtime surfaces can be validated from declared entrypoints.
3. Release dry-run/check workflow runs locally without network publish or registry credentials.
4. Distribution smoke checks cover package imports and app entrypoints.
5. Docs explain supported install, run, MCP, and release-readiness workflows accurately.

Plans:

- [x] 10-01: Audit package metadata and release surfaces.
- [x] 10-02: Add distribution smoke tests and release dry-run validation.

### Phase 11: Moxel Atlas Path and Home Layout

**Goal:** Replace Atlas contributor-oriented defaults with the clean Moxel consumer layout: repo-local `.moxel/atlas`, user-home `~/.moxel/atlas`, and no legacy `.atlas` default behavior.
**Depends on:** Phase 10
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. New default user home is `~/.moxel/atlas` with `config.yaml`, `corpus.db`, and `repos/` roots.
2. Repo-local writes target `.moxel/atlas` only.
3. `atlas setup` can create user-home config, while `atlas add-repo` lazy-creates it if missing.
4. Docs/examples no longer recommend `.atlas` or `~/.cache/atlas` for new workflows.

Plans:

- [x] 11-01: Introduce Moxel path helpers and home config defaults.
- [x] 11-02: Update CLI setup/add-repo initialization paths and docs.

### Phase 12: Host-Aware Repo Identity and Folder Registry

**Goal:** Use canonical repo IDs shaped as `host/owner/name` and store user repo state as per-repo folders with `repo.json` metadata.
**Depends on:** Phase 11
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Config, store, provenance, and CLI validation accept repo IDs such as `github.mycorp.com/platform/docs`.
2. Repo state is stored under `~/.moxel/atlas/repos/<host>/<owner>/<name>/repo.json`.
3. `atlas repo list`, `atlas repo remove`, and `atlas repo doctor` operate from folder metadata.
4. Removing a repo deletes its folder and removes imported corpus rows.

Plans:

- [x] 12-01: Update repo identity schema and deterministic ID handling.
- [x] 12-02: Implement folder registry metadata and repo management commands.

### Phase 13: Enterprise Host Setup and Repo Resolver

**Goal:** Make `atlas add-repo org/repo`, SSH URLs, HTTPS URLs, and local paths resolve predictably across configured GitHub/GHES hosts.
**Depends on:** Phase 12
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. `atlas setup` and `atlas hosts` manage default host, host priority, protocol, web URL, and API URL.
2. `atlas add-repo platform/docs` searches configured hosts in priority order and prompts only on ambiguity.
3. SSH URLs, HTTPS URLs, and `.`/local path inputs normalize to canonical repo identity.
4. Non-interactive ambiguity or missing host information fails with actionable `--host` or full-URL guidance.

Plans:

- [x] 13-01: Add host config, setup, and hosts commands.
- [x] 13-02: Implement repo input parser and host resolver.

### Phase 14: Repo Artifact Build Format

**Goal:** Let maintainers run `atlas init && atlas build` inside a normal checkout to create a committed, full ready-to-import `.moxel/atlas` artifact.
**Depends on:** Phase 13
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. `atlas init` in a Git checkout initializes `.moxel/atlas` for that repo.
2. `atlas build` writes `manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json`.
3. Artifact manifest contains schema, `repoId`, host, owner, name, ref, indexed revision, created timestamp, Atlas version, and format info.
4. Artifact contains no secrets or absolute machine-local paths.
5. CLI output gives explicit maintainer-controlled commit hint without attempting branch/commit/push.

Plans:

- [x] 14-01: Define artifact schema, checksum validation, and readable docs index.
- [x] 14-02: Wire repo-local init/build artifact export.

### Phase 15: Artifact-Only Remote Fetch and Stale Import UX

**Goal:** Make `atlas add-repo` fetch remote `.moxel/atlas` artifacts via GitHub/GHES APIs without cloning full repositories, then warn-but-import stale artifacts.
**Depends on:** Phase 14
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Remote add-repo downloads `.moxel/atlas` files into `~/.moxel/atlas/repos/<host>/<owner>/<name>/artifact/.moxel/atlas/` without full clone.
2. Local path or cwd repo input prefers the local checkout artifact over remote artifact.
3. Artifact checksum/schema validation runs before import.
4. If `indexedRevision` differs from remote ref HEAD, Atlas warns and imports anyway.
5. If artifact is missing, Atlas proceeds to the missing-artifact choice flow instead of cloning automatically.

Plans:

- [x] 15-01: Implement GitHub/GHES artifact file fetch and validation.
- [x] 15-02: Add add-repo artifact import flow with local-precedence and stale warnings.

### Phase 16: Global Corpus Import and Multi-Repo Runtime

**Goal:** Import per-repo artifacts into `~/.moxel/atlas/corpus.db` so search, retrieval, MCP, and server surfaces work across all added repos.
**Depends on:** Phase 15
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Artifact `corpus.db` snapshots can be imported into the global runtime corpus idempotently.
2. Re-importing a repo replaces prior rows for that repo without corrupting other repos.
3. Multi-repo search/retrieval/MCP reads from global corpus and preserves repo provenance.
4. Repo removal deletes associated global corpus rows.

Plans:

- [ ] 16-01: Implement artifact DB import/update/delete mechanics. _(Partial; blocked by canonical repo route verification.)_
- [ ] 16-02: Verify runtime search/retrieval/MCP across imported repos. _(Blocked by server canonical repo ID route semantics.)_

### Phase 17: Missing Artifact Fallback and Local-Only Index

**Goal:** Give users safe choices when remote repos do not maintain `.moxel/atlas`, including local-only indexing with documentation quality warnings.
**Depends on:** Phase 16
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Missing artifact prompt offers clone+index locally, skip, maintainer instructions, and generated issue/PR instructions.
2. `atlas index` clones to managed checkout and indexes local-only into the global corpus without writing `.moxel/atlas`.
3. Before indexing, Atlas checks documentation signal and warns on README-only or weak-doc repos.
4. Low-signal warnings suggest the `document-codebase` skill before indexing/building.
5. Managed clone indexing never stages, commits, pushes, or dirties repo-local artifacts.

Plans:

- [ ] 17-01: Add missing-artifact interactive and non-interactive flows.
- [ ] 17-02: Implement local-only index with documentation quality checks.

### Phase 18: Adoption Instructions and Issue/PR Templates

**Goal:** Help consumers ask repo owners to add `.moxel/atlas` without automating org-specific commit, branch, PR, or hook workflows.
**Depends on:** Phase 17
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Missing-artifact UX can show maintainer setup instructions immediately.
2. Atlas can generate issue/PR text explaining `.moxel/atlas`, benefits, and commands.
3. Generated guidance states maintainers control branch naming, commit messages, hooks, PR templates, and permissions.
4. Docs include consumer-to-maintainer adoption workflow.

Plans:

- [x] 18-01: Add maintainer instructions and generated issue/PR templates.
- [x] 18-02: Document org adoption workflow and permission boundaries.

### Phase 19: Artifact Verification and CI Freshness

**Goal:** Give repo owners reliable CI/manual checks to keep committed `.moxel/atlas` artifacts valid and fresh.
**Depends on:** Phase 18
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. `atlas artifact verify` validates manifest schema, checksums, corpus importability, and secret/path safety.
2. `atlas artifact verify --fresh` compares artifact revision with current HEAD/ref and exits non-zero when stale.
3. `atlas artifact inspect` summarizes artifact contents for humans.
4. Docs recommend CI verification first, while allowing manual, CI bot, or custom org automation.

Plans:

- [x] 19-01: Implement artifact verify/inspect commands.
- [x] 19-02: Add CI freshness docs and tests.

### Phase 20: Consumer UX Polish and Documentation

**Goal:** Make the new repo/library consumption workflow clear, tested, and documented for big-org users and maintainers.
**Depends on:** Phase 19
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Consumer guide covers setup, add-repo, stale warnings, missing artifacts, local-only index, and MCP/search use.
2. Maintainer guide covers init, build, commit, verify, docs quality, and CI.
3. Enterprise guide covers host setup, GHES auth, SSH/HTTPS, ambiguity resolution, and troubleshooting.
4. CLI help, README, and package docs match the new clean-break UX.
5. End-to-end tests cover local artifact, remote artifact, stale artifact, missing artifact, local-only index, and repo removal.

Plans:

- [x] 20-01: Update docs/help for consumer, maintainer, and enterprise workflows.
- [x] 20-02: Add end-to-end UX regression tests.

### Phase 21: White-label artifact resolver

**Goal:** Create shared white-label artifact root resolver and wire repo-local artifact commands for `init`, `build`, `artifact verify`, and `artifact inspect` while preserving default `.moxel/atlas` behavior.
**Requirements**: TBD
**Depends on:** Phase 20
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Shared resolver exposes a future-ready white-label profile with artifact root precedence CLI flag > env > config > default.
2. Artifact roots are normalized to `/` and reject Complete, absolute, traversal, and Windows drive-letter roots.
3. `atlas init` and `atlas build` can use `.acme/knowledge` without creating, reading, migrating, copying, or falling back to `.moxel/atlas`.
4. `atlas artifact verify` and `atlas artifact inspect` default to the effective artifact root unless explicit `--path` is supplied.
5. A migration hint appears only when custom root is selected, custom root is missing, and default `.moxel/atlas` exists.
6. Runtime storage, remote `add-repo` import paths, MCP identity, and full docs hardcode audit remain deferred to later white-label phases.

Plans:

- [ ] 21-01: Add shared white-label artifact root resolver.
- [ ] 21-02: Wire repo-local artifact commands to resolved artifact root.

### Phase 22: White-label runtime storage

**Goal:** Hard-cut user-facing white-label/artifact-root naming to identity naming, derive runtime storage from identity root, wire setup/config/add-repo/import/runtime commands through identity storage, and use per-repo `.atlas/` internals.
**Requirements**: TBD
**Depends on:** Phase 21
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. User-facing identity root surfaces are `--atlas-identity-root`, `ATLAS_IDENTITY_ROOT`, and `identity.root`; old `--moxellabs-atlas-artifact-root`, `--artifact-root`, `ATLAS_ARTIFACT_ROOT`, and `whiteLabel.artifactRoot` surfaces are removed without compatibility aliases.
2. No-option defaults remain `.moxel/atlas` for committed repo artifacts and `~/.moxel/atlas` for runtime storage.
3. Custom identity root `.acme/knowledge` derives committed artifact root `.acme/knowledge`, runtime root `~/.acme/knowledge`, config path `~/.acme/knowledge/config.yaml`, cache dir `~/.acme/knowledge`, and corpus DB `~/.acme/knowledge/corpus.db` unless explicit overrides win.
4. `add-repo` imports remote/local artifacts from the identity-derived committed root and stores fetched/runtime internals under `~/.acme/knowledge/repos/<host>/<owner>/<name>/.atlas/`.
5. Runtime commands `repo list`, `repo doctor`, `repo remove`, `search`, `inspect retrieval`, `mcp`, `serve`, `clean`, `prune`, and local-only `index` use effective identity runtime paths.
6. Existing `.moxel/atlas` and `~/.moxel/atlas` state is never copied, migrated, read as fallback, or deleted when a custom identity root is set.

Plans:

- [x] 22-01: Rename white-label profile to identity runtime root.
- [x] 22-02: Wire identity runtime storage into add-repo and runtime commands.

### Phase 23: White-label MCP identity

**Goal:** Plan identity-based MCP branding: server metadata, resource display names/titles, skill aliases, selected LLM-visible prompt/resource text, CLI atlas mcp, and HTTP /mcp bridge while keeping generic tools and atlas:// URI scheme stable.
**Requirements**: TBD
**Depends on:** Phase 22
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Public MCP identity names are `--atlas-mcp-name`, `ATLAS_MCP_NAME`, optional `ATLAS_MCP_TITLE`, and config `identity.mcp.name`, `identity.mcp.title`, `identity.mcp.resourcePrefix`.
2. No-option behavior preserves `atlas-mcp`, Atlas resource names/titles, Atlas skill aliases, and current CLI/server MCP behavior.
3. `--atlas-identity-root` remains runtime-storage-only and does not derive MCP server name/title/resource prefix.
4. Generic MCP tool names remain stable, including `find_docs`, `read_outline`, `read_section`, `plan_context`, `list_skills`, and `use_skill`.
5. Identity mode changes MCP server metadata, resource display names/titles, selected LLM-visible prompt/resource text, and skill aliases while keeping `atlas://` URI scheme stable.
6. `atlas mcp` stdio and HTTP `/mcp` bridge use the same effective MCP identity.
7. Minimal help/config docs mention Phase 23 identity knobs; full docs and hardcode audit remain Phase 24.

Plans:

- [x] 23-01: Add explicit MCP identity profile and brand-aware MCP package surfaces.
- [x] 23-02: Wire MCP identity through CLI stdio, HTTP bridge, and minimal help.

### Phase 24: White-label docs and audit

**Goal:** Refresh active docs/config/examples, audit hardcodes, and correct artifact mirror identity-root semantics.
**Requirements**: TBD
**Depends on:** Phase 23
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Active docs use public term `identity`, while historical PRD/architecture Complete files remain historical.
2. Active docs cover default `.moxel/atlas` / `~/.moxel/atlas` and custom `.acme/knowledge` / `~/.acme/knowledge` examples.
3. Artifact mirror semantics preserve identity root directly under runtime repo folders: `repos/<host>/<owner>/<name>/.acme/knowledge/` with no `.atlas/artifact`, `artifact/.moxel/atlas`, or extra `artifact/` layer.
4. Guard tests catch removed public names and stale active-doc/source hardcodes.
5. Full validation passes: `bun test`, `bun run typecheck`, and `bun run lint`.

Plans:

- [x] 24-01: Fix artifact mirror identity-root semantics and guard hardcodes.
- [x] 24-02: Refresh active identity docs and Complete state.

### Phase 25: Document metadata profiles and public artifact filtering

**Goal:** Establish first-class document metadata, publish profiles, and public artifact filtering so maintainers control which docs are indexed, published, stored, and retrieved by default.
**Requirements**: TBD
**Depends on:** Phase 24
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Active Markdown frontmatter can define `title`, `description`, `audience`, `purpose`, `visibility`, and `order` for docs-site and Atlas indexing/retrieval use.
2. `atlas.config.*` supports doc metadata rules and named profiles for files without frontmatter; frontmatter overrides config/default metadata for a file.
3. Built-in classification covers `README.md`, `docs/**`, `docs/archive/**`, `skills/**`, `.Complete/**`, and unmatched Markdown paths with safe defaults.
4. Built-in `public`, `contributor`, `maintainer`, and `internal` profiles exist; `atlas build` defaults to public profile and writes one committed public `.moxel/atlas` artifact.
5. Public artifact excludes internal/Complete/archive docs by default, including `.Complete/**`, while preserving metadata for included docs.
6. Store, search, retrieval, and MCP context Complete persist and honor metadata/profile filters; `atlas search` defaults to available artifact profile and accepts explicit profile/audience/purpose/visibility filters with clear unavailable-profile messages.
7. Tests prove config rules, frontmatter overrides, default classifications, public artifact filtering, and retrieval/search filter behavior.
8. Maintainer docs explain public artifact publishing, profile semantics, and how to classify folders/files.

Plans:

- [x] 25-01: Add document metadata model and classification rules.
- [x] 25-02: Add public profile artifact filtering and metadata-aware retrieval.

### Phase 26: Atlas self-indexing and first-party skills

**Goal:** Make Atlas dogfood its own public artifact and ship initial first-party skills, including `document-codebase`, through the normal `.moxel/atlas` publishing flow.
**Requirements**: TBD
**Depends on:** Phase 25
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. Atlas repo owns and commits a fresh public `.moxel/atlas` artifact containing `manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json`.
2. Atlas self-indexing uses Phase 25 public profile rules and excludes `.Complete/**` and other internal-only docs from the committed artifact.
3. `atlas artifact verify --fresh` passes for the repo-local artifact.
4. `atlas add-repo .` can import the local Atlas artifact and default consumer retrieval/search works from it.
5. `skills/document-codebase/SKILL.md` exists, has public metadata, and describes safe codebase documentation update behavior.
6. Build/extraction exposes first-party skills through indexed artifact and MCP skill surfaces where applicable.
7. README and active docs explain Atlas self-indexing and artifact freshness workflow.

Plans:

- [x] 26-01: Generate and verify Atlas self-indexed public artifact.
- [x] 26-02: Publish document-codebase first-party skill and self-indexing docs.

### Phase 27: Interactive skill creator workflow

**Goal:** Add an interactive `skill-creator` skill that researches Atlas codebase docs, recommends useful skills, supports discussion/spec refinement, asks follow-up questions, waits for explicit approval, and creates approved skill assets in the correct folders.
**Requirements**: TBD
**Depends on:** Phase 26
**Plans:** 2 plans

**Success Criteria** (what must be TRUE):

1. `skills/skill-creator/SKILL.md` exists with public metadata and clear trigger conditions.
2. Workflow researches self-indexed docs/source structure before recommending skills.
3. Recommendations include skill name, target users, trigger conditions, usefulness rationale, target path, confidence, risks, and overlap with existing skills.
4. Discussion flow supports user edits, follow-up questions, and repeated refinement until a concrete skill spec is agreed.
5. Skill creation requires explicit user approval of exact skill names and target paths; no files are written during research/recommendation/discussion.
6. Creation can write `SKILL.md`, references, scripts, templates, or checklists when specified by approved spec.
7. Docs/tests/static guards document and protect the no-write-before-approval boundary.
8. Created skills participate in self-index rebuild/freshness guidance.

Plans:

- [x] 27-01 Create skill-creator workflow assets and approval guardrails
- [x] 27-02 Expose skill-creator through docs, artifact, and runtime skill surfaces

### Phase 28: Public consumption docs site readiness

**Goal:** Polish public consumer/contributor/maintainer docs into static-site-ready content with frontmatter, navigation metadata, purpose-driven structure, and generated-site-friendly examples.
**Requirements**: TBD
**Depends on:** Phase 27
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Active public docs have minimal frontmatter with `title`, `description`, `audience`, `purpose`, `visibility`, and `order` where appropriate.
2. Consumer, contributor, maintainer, enterprise, configuration, security, runtime, self-indexing, and artifact workflow docs have clear audience/purpose, quickstart, concepts, commands, examples, and troubleshooting.
3. Docs distinguish public consumption docs from contributor/internal implementation or Complete docs.
4. Docs examples use current identity-root/profile/public-artifact terminology.
5. Docs structure can feed a generated docs site without relying on `.Complete` or archive files.
6. Guard tests or documentation checks catch stale public terminology, missing frontmatter in active public docs, and accidental inclusion of internal-only docs.

Plans:

- [x] 28-01 Normalize public docs frontmatter and navigation metadata
- [x] 28-02 Polish public docs content and add docs readiness guards

### Phase 29: Server docs portal and OpenAPI polish

**Goal:** Add a polished server docs portal while keeping Scalar-backed OpenAPI reference, so local server docs feel like an Atlas docs site rather than raw API reference only.
**Requirements**: TBD
**Depends on:** Phase 28
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):

1. Server exposes `/docs` as a branded docs landing page and keeps `/openapi` as a polished Scalar API reference page.
2. `/openapi.json` remains the raw machine-readable OpenAPI document.
3. Root route redirects to `/docs` unless Complete discovers a stronger compatibility reason not to.
4. Docs pages include identity-aware title/branding, local-first/security notes, quickstart examples, route-group guidance, MCP bridge notes, config/runtime links, and troubleshooting links.
5. Scalar remains embedded and usable for API exploration.
6. Server tests verify `/docs`, `/openapi`, `/openapi.json`, and redirect behavior.
7. OpenAPI metadata/examples align with public docs terminology without breaking existing route contracts.

Plans:

- [x] 29-01: Add server docs portal and OpenAPI JSON alias.
- [x] 29-02: Polish Scalar OpenAPI shell and metadata.

### Phase 30: Scalar-first OpenAPI docs refinement

**Goal:** Correct the Phase 29 UAT gap by making `/docs` the Scalar/OpenAPI experience, removing the separate custom docs landing page and large custom chrome, and improving documentation content inside OpenAPI/Scalar only.
**Requirements**: TBD
**Depends on:** Phase 29
**Plans:** 2 plans complete

**Success Criteria** (what must be TRUE):

1. Root `/` redirects to `/docs`.
2. `/docs` serves the same Scalar/OpenAPI experience as `/openapi`, not a separate custom docs landing page.
3. `/openapi` remains available for compatibility and serves the same Scalar/OpenAPI experience or an explicitly tested redirect to `/docs`.
4. Large custom panel above Scalar is removed.
5. `Back to Docs` link/chrome is removed.
6. `/openapi.json` remains the preferred raw machine-readable OpenAPI document, with compatibility raw JSON path preserved where already supported.
7. OpenAPI/Scalar content contains improved intro, quickstart guidance, tag descriptions, operation descriptions, and safe examples for all endpoint groups.
8. Tests verify docs routing, Scalar presence on `/docs`, absence of rejected custom chrome, valid raw OpenAPI JSON, and endpoint documentation coverage.

Plans:

- [x] 30-01: Make docs routes Scalar-first and remove custom docs chrome.
- [x] 30-02: Improve OpenAPI content inside Scalar.

### Phase 31: Open-source release prep

**Goal:** Prepare Atlas for public open-source release before CI or npm publishing by defining the public/private repository boundary, adding license/attribution/community docs, and keeping the public `.moxel/atlas` artifact fresh.
**Requirements**: OSS-RELEASE-PREP
**Depends on:** Phase 30
**Plans:** 2/2 plans complete

Plans:

- [ ] 31-01: Public repository hygiene and boundary cleanup.
- [ ] 31-02: Public docs, license, and community files.

### Phase 32: CI validation

**Goal:** Add public pull-request and push CI that validates Atlas with Bun, tests, distribution smoke, release dry-run, and public artifact freshness without requiring secrets.
**Requirements**: OSS-CI
**Depends on:** Phase 31
**Plans:** 1/1 plans complete

Plans:

- [x] 32-01: Add public pull-request CI validation.

### Phase 33: Release pipeline

**Goal:** Add safe tag-driven npm and GitHub release automation for `@moxellabs/atlas`, including package metadata, tarball smoke tests, dist-tag handling, checksums, and GitHub releases.
**Requirements**: OSS-RELEASE
**Depends on:** Phase 32
**Plans:** 2/2 plans complete

Plans:

- [x] 33-01: Decide publish shape and package metadata.
- [x] 33-02: Add tag-driven npm and GitHub release workflow.

### Phase 34: Hard-cut migrate Atlas CLI to commander plus @clack/prompts and @clack/core for command parsing, help, typed options, and interactive flows

**Goal:** Hard-cut migrate Atlas CLI command parsing, help, typed options, and interactive prompt foundations to commander and Clack while preserving JSON/script contracts.
**Requirements**: CLI-UX
**Depends on:** Phase 33
**Plans:** 3/3 plans complete

Plans:

- [x] 34-01: Add commander and Clack CLI runtime foundation.
- [x] 34-02: Migrate command tree to typed commander options and redesigned help.
- [x] 34-03: Polish Clack interactive flows, JSON boundaries, docs, and cleanup.

### Phase 35: Embedded enterprise CLI mount

**Goal:** Let enterprise users mount the full Atlas command tree under their existing Commander CLI namespace, so UX is `userCli <namespace> <all Atlas commands/options/flags>` without rebuilding Atlas through an SDK and without inventing unsupported branding/auth fields.
**Requirements**: ENTERPRISE-CLI-MOUNT
**Depends on:** Phase 34
**Plans:** 2/2 plans complete

**Current supported identity/config surface only:**

- `namespace`: wrapper command mount only; not persisted Atlas identity.
- `identityRoot`: maps to `--atlas-identity-root`, `ATLAS_IDENTITY_ROOT`, and config `identity.root`.
- `mcp.name`: maps to `--atlas-mcp-name`, `ATLAS_MCP_NAME`, and config `identity.mcp.name`.
- `mcp.title`: maps to `--atlas-mcp-title`, `ATLAS_MCP_TITLE`, and config `identity.mcp.title`.
- `mcp.resourcePrefix`: maps only to config `identity.mcp.resourcePrefix`; no CLI/env knob currently exists.
- `defaults.config`: maps to `--config` / `ATLAS_CONFIG`.
- `defaults.cacheDir`: maps to `ATLAS_CACHE_DIR` / config `cacheDir`.
- `defaults.logLevel`: maps to `ATLAS_LOG_LEVEL` / config `logLevel`.
- `defaults.caCertPath`: maps to `ATLAS_CA_CERT_PATH`.

**Wrapper schema:**

```ts
type AtlasMountConfig = {
  /** Commander namespace under enterprise CLI, e.g. `userCli acme ...`. */
  namespace: string;

  /** Existing Atlas identity root. Relative path only; same validation as current CLI/config. */
  identityRoot?: string;

  /** Existing MCP identity knobs. */
  mcp?: {
    /** Existing MCP server identity name; lower-kebab identifier. */
    name?: string;
    /** Existing MCP server display title. */
    title?: string;
    /** Existing MCP resource/skill alias prefix; config-only today. */
    resourcePrefix?: string;
  };

  /** Existing global config/env defaults only. */
  defaults?: {
    config?: string;
    cacheDir?: string;
    logLevel?: "debug" | "info" | "warn" | "error";
    caCertPath?: string;
  };
};
```

**Explicit non-goals:**

- Do not add `logo`, `color`, `docsUrl`, `supportUrl`, `productName`, or visual white-label fields.
- Do not add auth hooks or token callbacks.
- Do not expose a broad Atlas SDK or require enterprises to rebuild Atlas commands.

**Success Criteria** (what must be TRUE):

1. Enterprise code can call `attachAtlas(program, config)` or equivalent and get `userCli <namespace> <all Atlas commands/options/flags>`.
2. Standalone `atlas` binary behavior, help, defaults, command names, JSON/script contracts, and exit codes remain compatible.
3. `createAtlasProgram` or equivalent accepts mounted command metadata/default identity values without duplicating command definitions.
4. Mounted command injects only currently supported Atlas options/env/config values listed above.
5. `mcp.resourcePrefix` handling is documented as config-only unless current CLI/env support is explicitly added in same phase with tests and docs.
6. Tests cover command mounting, default injection, precedence against explicit user flags/env/config, no invented schema fields, and standalone Atlas compatibility.
7. Documentation shows one-minute setup using current schema and makes limits clear.

Plans:

- [x] 35-01: Add embedded Commander mount API.
- [x] 35-02: Add mount tests docs and compatibility guards.

### Phase 36: Production build diagnostics and nested error surfacing

**Goal:** Preserve and print nested build causes, failing phase/stage, and failing entity path so real production build failures can be debugged from `--json --verbose` output.
**Requirements:** PROD-DIAGNOSTICS
**Depends on:** Phase 35
**Plans:** 2/2 plans complete

Plans:

- [x] 36-01: Preserve nested build causes in indexer reports.
- [x] 36-02: Print actionable verbose and JSON build diagnostics in CLI.

### Phase 37: Real-repo build pipeline repro and root-cause fixes

**Goal:** Reproduce the incident boundary where `inspect topology --live` succeeds but `build` fails, then fix the actual post-discovery build-stage bug exposed by Phase 36 diagnostics.
**Requirements:** PROD-BUILD-REPRO, PROD-BUILD-FIX
**Depends on:** Phase 36
**Plans:** 2/2 plans complete

Plans:

- [x] 37-01: Add topology-success build-failure reproduction harness.
- [x] 37-02: Fix real build-stage failures exposed by diagnostics.

### Phase 38: Local-git checkout semantics and local branch support

**Goal:** Make `local-git` usable for local-only branches and explicit about whether Atlas reads current checkout or fetches a remote ref.
**Requirements:** LOCAL-GIT-CHECKOUT, LOCAL-GIT-ERRORS
**Depends on:** Phase 36
**Plans:** 2/2 plans complete

Plans:

- [x] 38-01: Add explicit current-checkout local-git mode.
- [x] 38-02: Clarify remote-ref errors and docs.

### Phase 39: Init, repo state, and command-state clarity

**Goal:** Make repo target inference and repo/config/registry/store/cache state boundaries clear enough that users can run commands from cwd or with bare repo names instead of repeating full ids or manually adding default GitHub host config.
**Requirements:** INIT-STATE-UX, STATE-LAYER-UX, REPO-TARGET-UX
**Depends on:** Phase 38
**Plans:** 3/3 plans complete

Plans:

- [x] 39-01: Add init target inference and precise missing-target errors.
- [x] 39-02: Make repo doctor and doctor explain checked state layers.
- [x] 39-03: Add shared repo target resolver across commands.

### Phase 40: Command UX simplification and production onboarding

**Goal:** Simplify Atlas command mental model so users know whether to run `setup`, `init`, `build`, `index`, or repo onboarding commands, can ask Atlas for the next step, and never see wrapper branding prompts in standalone setup.
**Requirements:** COMMAND-UX, CLI-NO-BRANDING
**Depends on:** Phase 39
**Plans:** 3/3 plans complete

**Primary mental model:**

1. `atlas setup` — one-time local runtime setup.
2. `atlas repo add <repo>` — consume existing artifact from a repo.
3. `atlas init && atlas build` — maintainer flow inside a repo checkout to publish/update artifact.
4. `atlas index <path>` — emergency local-only fallback, not primary happy path.
5. `atlas next` / `atlas status --next` — inspect current state and recommend the next command.
6. Repo targets infer from cwd/config/git origin/metadata/bare names; full `host/owner/name` ids and manual host setup are only needed for ambiguity or unknown GHES hosts.
7. Branding/default identity belongs in enterprise Commander wrapper code, not standalone `atlas setup`.

Plans:

- [x] 40-01: Define simplified command model and guided next-step command.
- [x] 40-02: Consolidate repo onboarding command aliases and docs.
- [x] 40-03: Remove branding and wrapper-only identity prompts from standalone setup.

### Phase 41: Production onboarding UAT and release gate

**Goal:** Add scripted production-like UAT that validates the full private-monorepo onboarding/debugging experience before release.
**Requirements:** PROD-UAT
**Depends on:** Phase 40
**Plans:** 1/1 plans complete

Plans:

- [x] 41-01: Add production onboarding UAT scenarios.

### Phase 42: Post-release bug hunt remediation

**Goal:** Fix prioritized bugs found by the post-v0.1.3 parallel bug hunt across CLI runtime/env handling, mounted MCP identity/exports, repo removal target resolution, source checkout diagnostics, and store consistency footguns.
**Requirements:** BUG-HUNT-CLI, BUG-HUNT-MCP, BUG-HUNT-STORE-SOURCE
**Depends on:** Phase 41
**Plans:** 3/3 plans complete

Plans:

- [x] 42-01: Fix CLI runtime and repo command regressions.
- [x] 42-02: Repair mounted MCP identity and public MCP exports.
- [x] 42-03: Harden source checkout diagnostics and store consistency footguns.
