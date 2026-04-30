---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: active
stopped_at: null
last_updated: "2026-04-30T15:05:00.000Z"
last_activity: 2026-04-30
progress:
  total_phases: 43
  completed_phases: 43
  total_plans: 90
  completed_plans: 90
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-26)

**Core value:** Local-first documentation ingestion, compilation, retrieval planning, and MCP/server access for multi-repo engineering docs.
**Current focus:** Phase 43 complete; v1.1 roadmap fully complete.

## Current Position

Phase: 43 of 43 (public package and UX surface hardening)
Plan: 5 of 5
Status: Complete
Last activity: 2026-04-30

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 90 / 90 planned
- Average duration: N/A
- Total execution time: N/A

**By Phase:**

| Phase                                                        | Plans | Status   |
| ------------------------------------------------------------ | ----- | -------- |
| 1. Baseline Validation                                       | 2/2   | Complete |
| 2. Security Boundaries                                       | 2/2   | Complete |
| 3. Build Reliability                                         | 3/3   | Complete |
| 4. Runtime Surfaces                                          | 2/2   | Complete |
| 5. Documentation Alignment                                   | 2/2   | Complete |
| 6. Retrieval and Context Quality                             | 1/1   | Complete |
| 7. Agent Tool Calling Adoption                               | 1/1   | Complete |
| 8. MCP Adoption Evaluation Harness                           | 2/2   | Complete |
| 9. Large Corpus Performance and Token Budget Reliability     | 2/2   | Complete |
| 10. Release Readiness and Distribution                       | 2/2   | Complete |
| 11. Moxel Atlas Path and Home Layout                         | 2/2   | Complete |
| 12. Host-Aware Repo Identity and Folder Registry             | 2/2   | Complete |
| 13. Enterprise Host Setup and Repo Resolver                  | 2/2   | Complete |
| 14. Repo Artifact Build Format                               | 2/2   | Complete |
| 15. Artifact-Only Remote Fetch and Stale Import UX           | 2/2   | Complete |
| 16. Global Corpus Import and Multi-Repo Runtime              | 2/2   | Complete |
| 17. Missing Artifact Fallback and Local-Only Index           | 2/2   | Complete |
| 18. Adoption Instructions and Issue/PR Templates             | 2/2   | Complete |
| 19. Artifact Verification and CI Freshness                   | 2/2   | Complete |
| 20. Consumer UX Polish and Documentation                     | 2/2   | Complete |
| 21. White-label Artifact Resolver                            | 2/2   | Complete |
| 22. White-label Runtime Storage                              | 2/2   | Complete |
| 23. White-label MCP Identity                                 | 2/2   | Complete |
| 24. White-label Docs and Audit                               | 2/2   | Complete |
| 25. Document Metadata Profiles and Public Artifact Filtering | 2/2   | Complete |
| 26. Atlas Self-indexing and First-party Skills               | 2/2   | Complete |
| 27. Interactive Skill Creator Workflow                       | 2/2   | Complete |
| 28. Public Consumption Docs Site Readiness                   | 2/2   | Complete |
| 29. Server Docs Portal and OpenAPI Polish                    | 2/2   | Complete |
| 30. Scalar-first OpenAPI Docs Refinement                     | 2/2   | Complete |
| 31. Open-source Release Prep                                 | 2/2   | Complete |
| 32. CI Validation                                            | 1/1   | Complete |
| 33. Release Pipeline                                         | 2/2   | Complete |
| 34. Commander and Clack CLI Migration                        | 3/3   | Complete |
| 35. Embedded Enterprise CLI Mount                            | 2/2   | Complete |
| 36. Production Build Diagnostics and Nested Error Surfacing  | 2/2   | Complete |
| 37. Real-Repo Build Pipeline Repro and Root-Cause Fixes      | 2/2   | Complete |
| 38. Local-Git Checkout Semantics and Local Branch Support    | 2/2   | Complete |
| 39. Init, Repo State, and Command-State Clarity              | 3/3   | Complete |
| 40. Command UX Simplification and Production Onboarding      | 3/3   | Complete |
| 41. Production Onboarding UAT and Release Gate               | 1/1   | Complete |
| 42. Post-release Bug Hunt Remediation                        | 3/3   | Complete |
| 43. Public Package and UX Surface Hardening                  | 5/5   | Complete |

## Accumulated Context

### Roadmap Evolution

- Phase 43 completed: npm tarball now excludes raw docs and self-artifact, public artifact guard blocks PRD/archive/planning leaks, HTTP search/context accept metadata filters, MCP resource-prefix env propagation is wired through CLI/server, custom identity-root repo metadata lookup is shared, manual releases check out and validate tags, and public CLI/docs/runtime UX drift is cleaned up.

- Phase 42 completed: Post-release bug hunt remediation fixed CLI env propagation, mounted MCP resource prefix, MCP barrel exports, repo remove target resolution, current-checkout sparse diagnostics, direct section deletion FTS cleanup, and store package dependency boundary. Verification passed: typecheck, lint, bun test, production UAT.

- Phase 21 completed: White-label artifact resolver with shared resolver and repo-local command integration.
- Phase 22 completed: White-label runtime storage with identity runtime derivation and add-repo/runtime command wiring.
- Phase 23 completed: White-label MCP identity with explicit MCP metadata/resource/skill alias identity and CLI/server bridge wiring.
- Phase 24 completed: White-label docs and audit with artifact mirror identity-root semantics correction.
- v1.1 release pipeline setup deferred until Phases 25-29 are planned/executed.
- Phase 25 completed: first-class document metadata, config profiles/rules, public artifact filtering, and metadata-aware search/retrieval/MCP filters landed.
- Phase 26 completed: Atlas now owns a generated public `.moxel/atlas` artifact, local artifact import/search dogfood passes, and `document-codebase` ships as a public first-party skill exposed through artifact/MCP surfaces.
- Phase 27 completed: `skill-creator` first-party skill now provides read-only research/recommendation, discussion/spec refinement, explicit exact-name/path approval gates, approved asset creation rules, docs/runtime exposure, MCP coverage, and fresh public artifact inclusion.
- Phase 28 completed: active public docs now have static-site-ready frontmatter/navigation metadata, purpose-driven public content, docs readiness guards, and a rebuilt fresh `.moxel/atlas` public artifact.
- Phase 29 added: Server docs portal and OpenAPI polish
- Phase 29 completed: `/docs` portal, root redirect to docs, `/openapi.json` alias, polished Scalar `/openapi` shell, local-first OpenAPI metadata, tests, and active docs updates landed.
- Phase 30 completed: `/docs` now serves Scalar/OpenAPI, custom docs landing page/large panel/Back to Docs chrome were removed, OpenAPI content now includes intro, quickstart, tag/operation descriptions, safe examples, and coverage tests.
- Phase 31 added: Open-source release prep
- Phase 31 planned with public repository hygiene and public docs/license/community files workstreams.
- Phase 32 added: CI validation
- Phase 32 planned with public pull-request CI validation workstream.
- Phase 32 completed: public GitHub Actions CI now validates pushes and pull requests with Bun 1.3.11, frozen installs, typecheck, lint, tests, distribution smoke, release dry-run, and public artifact freshness without secrets.
- Phase 33 added: Release pipeline
- Phase 33 planned with package metadata/publish-shape and tag-driven npm/GitHub release workstreams.
- Phase 33 completed: Atlas now publishes exactly one public npm package shape (`@moxellabs/atlas`), keeps workspace internals private, validates tarball install smoke, and has tag-driven npm/GitHub release automation with checksums.
- Phase 34 added: Hard-cut migrate Atlas CLI to commander plus @clack/prompts and @clack/core for command parsing, help, typed options, and interactive flows
- Phase 34 completed: Atlas CLI now uses commander for top-level and nested command help/dispatch, Clack-backed prompt primitives, preserved JSON/script behavior, and distribution smoke remains green.
- Phase 35 added: Embedded enterprise CLI mount

### Decisions

Decisions are logged in `.planning/PROJECT.md` Key Decisions table.

- Phase 11 completed: default user-home state moved to `~/.moxel/atlas`, repo-local artifact defaults moved to `.moxel/atlas`, `atlas setup` added, and `atlas add-repo` lazy-creates Moxel home config/directories.
- Phase 12 completed: canonical repo IDs use `host/owner/name`; per-repo state lives under `~/.moxel/atlas/repos/<host>/<owner>/<name>/repo.json`; `atlas repo list/doctor/remove` operate from registry metadata.
- Phase 13 completed: configured hosts support GitHub/GHES defaults, priority, protocol, web/API URLs; `atlas hosts` manages hosts; `atlas add-repo` resolves shorthand, SSH URLs, HTTPS URLs, and local paths to canonical repo IDs.
- Phase 14 completed: maintainers can run `atlas init && atlas build` in a Git checkout to create `.moxel/atlas/manifest.json`, `corpus.db`, `checksums.json`, and `docs.index.json` with schema/checksum/safety validation and no Git mutation.
- Phase 15 completed: `atlas add-repo` fetches remote `.moxel/atlas` artifacts via GitHub/GHES API without cloning, validates schema/checksums, prefers local checkout artifacts, warns but imports stale artifacts, and returns missing-artifact choices without cloning.
- Phase 16 completed: artifact corpus import/update/delete mechanics and multi-repo CLI/retrieval/MCP/server verification passed; server mutation fixture now uses canonical slash-bearing repo IDs.
- Phase 17 completed: missing-artifact UX offers clone+index, skip, maintainer instructions, and issue/PR instructions; `atlas index` performs local-only indexing with documentation signal warnings and no repo-local artifact writes.
- Phase 18 completed: missing-artifact UX now emits reusable adoption templates; `atlas adoption-template` generates maintainer setup, issue text, and PR text; docs define consumer-to-maintainer adoption workflow and permission boundaries.
- Phase 21 completed: `@atlas/config` now resolves repo-local artifact roots with CLI > env > config > default precedence; `init`, repo-local `build`, `artifact verify`, and `artifact inspect` honor custom roots without `.moxel/atlas` fallback.
- Phase 22 completed: hard-cut public naming to `--atlas-identity-root`, `ATLAS_IDENTITY_ROOT`, and `identity.root`; derive custom runtime paths such as `~/.acme/knowledge`; wire setup/config/add-repo/runtime commands; store per-repo internals under `repos/<host>/<owner>/<name>/.atlas/`; no compatibility aliases, migration, copy, delete, or fallback.
- Phase 23 planned: explicit MCP identity names are `--atlas-mcp-name`, `ATLAS_MCP_NAME`, optional `ATLAS_MCP_TITLE`, and config `identity.mcp.name/title/resourcePrefix`; generic MCP tool names and `atlas://` URI scheme stay stable; stdio `atlas mcp` and HTTP `/mcp` bridge use same effective identity.

### Pending Todos

- Phase 31 ready to execute after license decision: recommended `AGPL-3.0-or-later` plus `NOTICE` plus trademark guidance if protection matters most.
- Phase 32 completed after Phase 31 public boundary/docs landed.
- Phase 33 completed after Phase 32 CI landed: release package metadata, tarball smoke, release workflow, maintainer release docs, and public artifact refresh are done.

### Blockers/Concerns

- GSD subagent execution unavailable in this runtime; inline sequential planning/execution used successfully.
- `pi-gsd-tools state begin-phase` command unavailable in this harness (`Unknown command: state`); tracking files updated manually.
- GSD verifier subagent unavailable in this runtime; Phase 38 verification ran inline.
- `.planning/PROJECT.md` was referenced by STATE.md but missing on disk during Phase 38 project-md evolution step; skipped PROJECT.md update.
- Previous codebase map commit skipped because `.planning/codebase/*.md` is gitignored.

### Production Feedback Recovery Planning

- User production incident report `.planning/issues/user-feedback.md` analyzed on 2026-04-29. Version/global-local install confusion is explicitly ignored as a user environment issue, not an Atlas product issue.
- Confirmed product issues: opaque `CLI_BUILD_FAILED` / `IndexerBuildError`, missing nested cause/stage/entity diagnostics, `inspect topology --live` succeeds while `build` fails, surprising `local-git` remote-ref requirement for local-only branches, confusing config/registry/store/cache state boundaries, unclear `init` target behavior, repeated full `--repo-id host/owner/name` and manual GitHub host setup requirements despite cwd/git-origin/bare repo-name context, confusing `setup`/`init`/`build`/`index` command mental model, and standalone setup surfacing wrapper-only branding/identity concerns.
- Added Phase 36 for nested build diagnostics, Phase 37 for real build pipeline reproduction/root-cause fixes, Phase 38 for local-git current-checkout semantics, Phase 39 for init/state clarity and shared repo target inference, Phase 40 for command UX simplification, no-branding setup, and guided next-step command, and Phase 41 for production onboarding UAT/release gate.

## Session Continuity

Last session: 2026-04-28
Stopped at: Phase 41 complete; all phases complete
Resume file: `.planning/ROADMAP.md`

### Phase 41 Execution

- Phase 41 completed: added scripted production onboarding UAT in `tooling/scripts/production-uat.ts`.
- UAT covers top-level command-order help, setup no-branding help, fresh/post-setup `atlas next`, `repo add` alias delegation, GitHub origin inference, local-only current-checkout init, live topology discovery, verbose `CLI_BUILD_FAILED` nested diagnostics, and doctor state-layer JSON.
- Added `bun run uat:production` and CI `Production onboarding UAT` release gate.
- Added troubleshooting release checklist and bug-report command set.
- Verification passed: `bun run uat:production`, `bun run typecheck`, and `bun run lint`.
- Background Phase 41 session reported success but did not write final artifacts, so final UAT implementation and completion bookkeeping were completed inline by manager.

### Phase 40 Execution

- Phase 40 completed: added `atlas next` to inspect setup/repo/artifact/corpus state and recommend one command with human and JSON output.
- Top-level help now shows grouped onboarding paths and distinguishes `setup`, `repo add`, `init && build`, and fallback `index <path>`.
- `atlas repo add <repo>` now shares implementation with legacy `atlas add-repo`.
- Standalone setup no longer surfaces wrapper-only branding/MCP display identity prompts/options; Commander wrapper defaults remain supported.
- Verification passed: focused CLI tests for next/status/help/repo add/add-repo/setup/branding/commander, `bun run typecheck`, and `bun run lint`.
- Planned files missing were mapped to active equivalents: setup UX in `init.command.ts`, docs in README/ingestion-build-flow/CLI docs/configuration.
- Top-level help now shows quick path and intent groups: Start, Use repos, Build artifacts, Search/query, and Diagnose.
- `atlas repo add <repo>` is now the primary repo lifecycle command and delegates to existing `add-repo`; `atlas add-repo` remains a compatibility alias with stable JSON/script behavior.
- Docs now separate consumer (`setup` → `repo add`), maintainer (`init` → `build` → `artifact verify`), and emergency local-only (`index`) flows.
- Standalone `atlas setup` help no longer surfaces MCP display identity flags; setup prompt/output wording is functional runtime/artifact-root language, and wrapper display identity/defaults are documented as Commander wrapper code concerns.
- Verification passed: `bun test apps/cli/src/cli.test.ts --test-name-pattern "next|status|help|repo add|add-repo|setup|branding|commander"`, `bun run typecheck`, and `bun run lint`.
- GSD subagents were unavailable (`agents_installed: false`), so execution and verification ran inline sequentially. `pi-gsd-tools state begin-phase` remains unavailable in this harness (`Unknown command: state`). Planned docs `docs/quickstart.md`, `docs/consumer-workflow.md`, `docs/maintainer-workflow.md`, and command file `apps/cli/src/commands/setup.command.ts` do not exist; equivalent active files were updated.

### Phase 39 Execution

- Phase 39 completed: added shared repo target resolution for explicit flags, repo-local metadata, cwd-config matches, Git origin, unique bare names, and single-config fallbacks.
- `atlas init`, `build`, `repo doctor`, and inspect commands can infer repo target from cwd/Git origin without requiring repeated `--repo-id host/owner/name` or manual default GitHub host setup.
- Missing/ambiguous target errors now report checked sources and candidates; JSON uses structured `CLI_REPO_TARGET_REQUIRED` / `CLI_REPO_TARGET_AMBIGUOUS` payloads.
- `repo doctor` and `doctor` now explain config/registry/store/cache/build layers and avoid implying build readiness when no build ran.
- Verification passed: focused CLI tests for init/doctor/repo target/build/inspect/cwd/bare repo flows, `bun run typecheck`, and `bun run lint`.
- GSD subagents unavailable, `pi-gsd-tools state begin-phase` unavailable, and `.planning/PROJECT.md` missing; execution/verification ran inline and project evolution skipped.
- `atlas init` now infers GitHub.com repo IDs from cwd Git origin without requiring manual default host setup and emits `targetResolution` metadata in JSON.
- `build`, `repo doctor`, `repo show`, `inspect repo`, and `inspect topology` use the shared resolver where they need one repo; eligible Commander args are optional so cwd inference can run.
- `doctor` and `repo doctor` now label checked state layers (`runtime-config`, `db`, `local-git-cache`, `server-readiness`, `config`, `registry`, `store`, `artifact-metadata`) and human output clarifies these commands do not run `build`.
- Build verbose diagnostics now render a derived layer for failing stages such as source/cache, topology, compile, and persistence.
- Docs updated in CLI app docs, runtime surfaces, and troubleshooting for target inference, ambiguity handling, state layer boundaries, and doctor-vs-build expectations.
- Verification passed: focused CLI target/doctor/build/inspect tests, `bun run typecheck`, and `bun run lint`.
- GSD subagents were unavailable (`agents_installed: false`), so execution and verification ran inline sequentially. `pi-gsd-tools state begin-phase` remains unavailable in this harness (`Unknown command: state`). `.planning/PROJECT.md` is still missing, so PROJECT evolution was skipped.

### Phase 38 Execution

- Phase 38 completed: added explicit `git.refMode` semantics for `local-git`, with `remote` preserving managed cache fetch/detach behavior and `current-checkout` reading local checkout `HEAD` without fetch, checkout, clone, or sparse mutation.
- Local-only checked-out branches and detached HEAD builds now work in current-checkout mode.
- Remote-ref errors now explain Atlas tried `origin <ref>` and suggest `refMode: current-checkout` for local-only branch/current working tree use.
- Verification passed: focused local-git current-checkout/remote-ref tests, focused CLI init/current-checkout tests, full local-git adapter tests, `bun run typecheck`, and `bun run lint`.
- GSD verifier subagent unavailable in this runtime and `.planning/PROJECT.md` missing; verification ran inline and PROJECT evolution was skipped.
- Repo-local `atlas init` now records `refMode: current-checkout`; `atlas build` reads current checkout `HEAD`, supporting local-only branches and detached HEAD artifact publishing.
- Remote ref failures now include origin-ref wording, `ref`/`refMode` structured context, and recovery guidance to use `refMode: current-checkout` for local-only branches.
- Docs updated in configuration, ingestion/build flow, and troubleshooting to explain remote mode versus current checkout mode and `HEAD` semantics.
- Verification passed: focused current-checkout/remote-ref adapter tests, focused CLI init/local-only tests, full local-git adapter test file, `bun run typecheck`, and `bun run lint`.
- GSD subagents were unavailable (`agents_installed: false`), `pi-gsd-tools state begin-phase` was unavailable (`Unknown command: state`), and `.planning/PROJECT.md` was missing, so execution/verification ran inline and state/project evolution was handled manually or skipped as noted.

### Phase 37 Execution

- Phase 37 completed: added topology-success/build-failure CLI and indexer regressions, preserving nested verbose causes and `docsConsidered` on failed builds.
- Fixed build-stage root cause where generated/vendor directories skipped by live topology could still poison source listings/build compilation; source listings now ignore generated/vendor directories consistently.
- Transactional failure behavior verified: post-discovery compile failures persist no docs and no manifest.
- Verification passed: `bun test packages/indexer/src/indexer.test.ts apps/cli/src/cli.test.ts --test-name-pattern "post-discovery|build failure|topology.*build|generated and vendored|CLI_BUILD_FAILED"`, `bun test packages/source-ghes/src/ghes-source.test.ts --test-name-pattern "tree|blob|list"`, `bun run typecheck`, and `bun run lint`.
- Fixed build/topology ignore-boundary divergence: local-git and GHES source listings now skip generated/vendor roots such as `.moxel`, `.atlas`, `node_modules`, `dist`, `coverage`, and `target` before topology classification.
- Build failures now classify compile, chunk, and persistence boundaries more narrowly; persistence errors no longer collapse into generic build stage.
- Troubleshooting docs now explain source/planning/compile/chunk/persistence/build stages, fields to inspect/share, and ignored-directory regression signal.
- Verification passed: focused CLI/indexer boundary tests, source-ghes tree/blob tests, `bun run typecheck`, and `bun run lint`.
- GSD subagents were unavailable (`agents_installed: false`) and `pi-gsd-tools state begin-phase` was unavailable (`Unknown command: state`), so execution ran inline sequentially and state/roadmap were updated manually.

### Phase 36 Execution

- Phase 36 completed: failed indexer build reports now preserve nested `Error.cause` chains, source diagnostics captured before terminal failure, failing stage/repo/entity/path metadata, and redacted structured diagnostic causes.
- CLI build failures now use concise default human output with rerun guidance and verbose human/JSON output for nested cause details; non-verbose JSON recursively strips stacks while preserving messages/codes/paths.
- Added `docs/troubleshooting.md` production triage guidance for `CLI_BUILD_FAILED`, `IndexerBuildError`, topology-vs-build boundaries, and safe share/redact fields.
- Verification passed: `bun test packages/indexer/src/reports/build-report.test.ts packages/indexer/src/indexer.test.ts`, `bun test apps/cli/src/cli.test.ts --test-name-pattern "build.*diagnostic|CLI_BUILD_FAILED|verbose"`, `bun run typecheck`, and `bun run lint`.
- GSD subagents were unavailable (`agents_installed: false`) and `pi-gsd-tools state begin-phase` was unavailable (`Unknown command: state`), so execution ran inline sequentially and state/roadmap were updated manually.

### Phase 35 Execution

- Phase 35 completed: Atlas now exposes `@moxellabs/atlas/commander` with `attachAtlas()` and `createAtlasCommand()` for mounting the full command tree under enterprise Commander namespaces.
- Standalone CLI behavior stays on the shared command registration path with existing `atlas <command>` help/defaults.
- Wrapper schema remains constrained to current supported fields only; no visual branding/auth schema and no resourcePrefix CLI/env knob were added.
- Added enterprise mount docs, package subpath build, distribution smoke coverage, and CLI/type guard tests.
- Verification passed: focused mounted/compat tests, full CLI tests, full `bun test`, `bun run typecheck`, `bun run lint`, `bun run build:package`, and `bun run smoke:distribution`.

### Phase 35 Planning

- Added Phase 35: Embedded enterprise CLI mount.
- Added `.planning/phases/35-embedded-enterprise-cli-mount/35-CONTEXT.md` with current supported Atlas identity/config surfaces only.
- Added `.planning/phases/35-embedded-enterprise-cli-mount/35-RESEARCH.md` with concise implementation research from current CLI/config code.
- Added `.planning/phases/35-embedded-enterprise-cli-mount/35-01-PLAN.md` for embedded Commander mount API implementation.
- Added `.planning/phases/35-embedded-enterprise-cli-mount/35-02-PLAN.md` for tests, docs, distribution smoke, and unsupported-field guards.
- Phase 35 target UX: `userCli <namespace> <all Atlas commands/options/flags>` through a Commander mount API, without broad SDK rebuild.
- Phase 35 wrapper schema is limited to current knobs: `namespace`, `identityRoot`, `mcp.name`, `mcp.title`, `mcp.resourcePrefix`, and existing global defaults for config/cache/log/CA cert.
- Explicit non-goals: no logo/color/docsUrl/supportUrl/productName fields, no auth hooks, no invented white-label schema.

### Phase 30 Planning

- Added `.planning/phases/30-scalar-first-openapi-docs-refinement/30-CONTEXT.md` from the Phase 29 UAT gap.
- Added `.planning/phases/30-scalar-first-openapi-docs-refinement/30-RESEARCH.md` for gap-closure planning research.
- Added `30-01-PLAN.md` for Scalar-first route cleanup: `/docs` serves Scalar/OpenAPI, `/` redirects to `/docs`, `/openapi` compatibility remains, custom docs landing page/panel and `Back to Docs` chrome are removed, and tests assert absence of rejected UI.
- Added `30-02-PLAN.md` for OpenAPI/Scalar content enhancement: intro, quickstart, tag descriptions, endpoint descriptions, examples, and documentation coverage tests.
- Phase 30 executed inline in this runtime and completed both planned workstreams.

### Phase 29 Execution

- Added `/docs` branded local Atlas docs portal with local-first/security notes, quickstart commands, route-group guidance, MCP bridge notes, config/runtime/security docs links, and troubleshooting.
- Changed root `/` redirect to `/docs`.
- Added preferred raw OpenAPI `/openapi.json` while preserving compatibility `/openapi/json`.
- Polished `/openapi` Scalar shell with Docs/Raw JSON links, route-group guide, loopback/CORS/security notes, and curl example.
- Updated OpenAPI info/server/tag descriptions to current local-first terminology.
- Updated `docs/runtime-surfaces.md` and `apps/server/docs/index.md` to document docs portal and OpenAPI paths.
- Verification passed: focused server docs/OpenAPI tests, full server test, `bun run typecheck`, `bun run lint`, and full `bun test`.

### Phase 28 Execution

- Added frontmatter/navigation metadata across active public root docs, app docs, package docs, and public skill docs.
- Polished README, docs landing, configuration, ingestion/build, retrieval, runtime, security, and self-indexing docs for public consumer/contributor/maintainer site use.
- Added `public docs are static-site ready` guard coverage and extended self-index fixture frontmatter assertions.
- Rebuilt `.moxel/atlas` public artifact with `bun apps/cli/src/index.ts build --profile public` and verified freshness with `bun apps/cli/src/index.ts artifact verify --fresh`.
- Verification passed: focused docs tests, `bun run typecheck`, full `bun test`, and `bun run lint`.

### Phase 14 Execution

- Added artifact helpers in `packages/indexer/src/artifact.ts` for schema, docs index, checksums, safety scanning, and corpus DB snapshots.
- Split `atlas setup` from repo-local `atlas init`.
- Added repo-local `atlas build` artifact export with maintainer-controlled commit hint and no Git staging/commit/branch/push.
- Verification passed: `bun run typecheck`, `bun test packages/indexer/src/indexer.test.ts apps/cli/src/cli.test.ts`, and `bun run lint`.

### Phase 16 Planning

- Added `.planning/phases/16-global-corpus-import-multi-repo-runtime/16-01-PLAN.md` for artifact DB import/update/delete mechanics.
- Added `.planning/phases/16-global-corpus-import-multi-repo-runtime/16-02-PLAN.md` for runtime CLI/retrieval/MCP/server multi-repo verification.
- Phase 16 dependency on Phase 15 artifact acquisition/import-ready handoff is satisfied.

### Phase 17 Planning

- Added `.planning/phases/17-missing-artifact-fallback-local-only-index/17-01-PLAN.md` for missing-artifact interactive and non-interactive flows.
- Added `.planning/phases/17-missing-artifact-fallback-local-only-index/17-02-PLAN.md` for local-only index with documentation quality checks.
- Phase 17 completed after Phase 16 global corpus import mechanics.

### Phase 18 Execution

- Added `.planning/phases/18-adoption-instructions-issue-pr-templates/18-01-SUMMARY.md` and `18-02-SUMMARY.md`.
- Added reusable adoption templates, direct `atlas adoption-template`, missing-artifact JSON/human wiring, docs, and guard tests.
- Verification passed: `bun run typecheck`, adoption template/missing artifact/adoption documentation CLI tests, and `bun run lint`.

### Phase 19 Planning

- Added `.planning/phases/19-artifact-verification-ci-freshness/19-01-PLAN.md` for `atlas artifact verify` and `atlas artifact inspect` commands.
- Added `.planning/phases/19-artifact-verification-ci-freshness/19-02-PLAN.md` for `atlas artifact verify --fresh`, CI freshness docs, and tests.
- Phase 19 depends on Phase 18 completion and is ready to execute.

### Phase 20 Planning

- Added `.planning/phases/20-consumer-ux-polish-documentation/20-01-PLAN.md` for consumer, maintainer, enterprise, README, package docs, and CLI help polish.
- Added `.planning/phases/20-consumer-ux-polish-documentation/20-02-PLAN.md` for local artifact, remote artifact, stale artifact, missing artifact, local-only index, repo removal, search/retrieval, and help/docs UX regression tests.
- Phase 20 depends on Phase 19 completion and is ready to execute after Phase 19.

### Phase 19 Execution

- Added `atlas artifact verify`, `atlas artifact verify --fresh`, and `atlas artifact inspect`.
- Added artifact helper validation for schema, repo ID shape, checksums, safety, corpus importability, and freshness.
- Added CI-first docs and tests guarding maintainer automation boundaries.
- Verification passed: typecheck, focused artifact helper/CLI tests, documentation guard tests, and lint.

### Phase 20 Execution

- Added consumer, maintainer, and enterprise workflow docs linked from README and docs index.
- Aligned CLI help and package docs with clean-break `.moxel/atlas` / `~/.moxel/atlas` UX and local imported corpus boundaries.
- Added consumer UX help/docs regression and artifact fixture coverage.
- Verification passed: `bun test apps/cli/src/cli.test.ts --test-name-pattern "consumer UX"`, `bun test apps/cli/src/cli.test.ts --test-name-pattern "help"`, `bun run typecheck`, and `bun run lint`.

### Phase 21 Planning

- Added `.planning/phases/21-white-label-artifact-resolver/21-01-PLAN.md` for the shared white-label artifact root resolver, config/env/CLI parsing, validation, normalization, and tests.
- Added `.planning/phases/21-white-label-artifact-resolver/21-02-PLAN.md` for wiring `init`, `build`, `artifact verify`, and `artifact inspect` to the resolved artifact root with migration hints and no fallback.
- Phase 21 explicitly defers runtime storage and remote `add-repo` import paths to Phase 22, MCP identity to Phase 23, and full docs hardcode audit to Phase 24.

### Phase 22 Execution

- Added `.planning/phases/22-white-label-runtime-storage/22-01-PLAN.md` for identity-root public naming, runtime root/config/cache/corpus derivation, setup wiring, and old flag/env/config removal.
- Added `.planning/phases/22-white-label-runtime-storage/22-02-PLAN.md` for `add-repo`, repo registry, per-repo `.atlas/` internals, runtime commands, no-fallback tests, and minimal help/template updates.
- Phase 22 completed with identity public naming, runtime derivation, add-repo identity artifact lookup, and per-repo `.atlas/` runtime internals.
- Phase 22 explicitly defers MCP identity to Phase 23 and full docs/hardcode audit to Phase 24.

### Phase 23 Planning

- Added `.planning/phases/23-white-label-mcp-identity/23-01-PLAN.md` for explicit MCP identity config/env/schema, MCP package metadata, resources, skill aliases, selected prompt text, and package tests.
- Added `.planning/phases/23-white-label-mcp-identity/23-02-PLAN.md` for CLI `atlas mcp` flags, stdio diagnostics, HTTP `/mcp` bridge wiring, minimal help/config docs, and CLI/server tests.
- Phase 23 plans preserve default `atlas-mcp`, Atlas resources/aliases, generic MCP tool names, and `atlas://` URI scheme while allowing explicit identity mode.
- Phase 23 explicitly defers full docs/hardcode audit to Phase 24.

### Phase 24 Planning

- Added `.planning/phases/24-white-label-docs-and-audit/24-01-PLAN.md` for artifact mirror identity-root semantics correction and hardcode guard tests.
- Added `.planning/phases/24-white-label-docs-and-audit/24-02-PLAN.md` for active docs/config/example refresh and planning state cleanup.
- Phase 24 requires imported mirrors to preserve identity root directly under runtime repo folders, e.g. `~/.acme/knowledge/repos/<host>/<owner>/<name>/.acme/knowledge/`, with no `.atlas/artifact`, `artifact/.moxel/atlas`, or extra `artifact/` folder.
- Phase 24 execution must run full validation: `bun test`, `bun run typecheck`, and `bun run lint`.

### Phase 23 Execution

- Added explicit MCP identity config/env/profile: `--atlas-mcp-name`, `--atlas-mcp-title`, `ATLAS_MCP_NAME`, `ATLAS_MCP_TITLE`, and config `identity.mcp.name/title/resourcePrefix`.
- Wired MCP package metadata, resource display names/titles, skill aliases, CLI `atlas mcp`, and HTTP `/mcp` bridge through same effective identity.
- Preserved default `atlas-mcp`, Atlas resource/alias behavior, generic MCP tool names, and `atlas://` URI scheme.
- Removed exported `WhiteLabelProfile` / `resolveWhiteLabelProfile` public compatibility aliases; exported public API is identity-only.
- Fixed blocking Phase 22 regressions in add-repo default config discovery, checkout path defaults, prune cache coverage, and artifact help wording.
- Verification passed: full `bun test`, focused Phase 22 regression tests, focused MCP identity tests, `bun run typecheck`, and `bun run lint`.
