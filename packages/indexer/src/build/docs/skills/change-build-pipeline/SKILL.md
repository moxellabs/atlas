---
name: change-build-pipeline
description: Change Atlas indexer build pipeline behavior. Use when an agent needs to modify packages/indexer build, rebuild, persistence, incremental selection, summaries, skill extraction, tokenizer/compiler/store coordination, recovery semantics, build reports, or indexer integration tests.
---

# Change Build Pipeline

Use this skill for changes in `packages/indexer` that affect how Atlas turns source docs into persisted corpus artifacts.

## Workflow

1. Identify the build stage.
   - Planning: `incremental/plan-incremental-build.ts` and `incremental/collect-affected-docs.ts`.
   - Rebuild: `build/rebuild-docs.ts`.
   - Persistence: `build/persist-build-results.ts`.
   - Reports: `reports/build-report.ts` and `types/indexer.types.ts`.
   - Service wiring: `services/create-indexer-services.ts`.

2. Preserve pipeline invariants.
   - Source adapters provide files and revisions.
   - Topology decides packages, modules, docs, and skills.
   - Compiler creates canonical docs, sections, summaries, and skill metadata.
   - Tokenizer creates chunks with stable IDs and counts.
   - Store persistence must keep docs, sections, chunks, summaries, skills, packages, modules, and manifests aligned.
   - Failed rebuilds must preserve the previous good corpus.

3. Make targeted changes.
   - If selection changes, update targeted/full/incremental/delete behavior.
   - If artifact shape changes, update persistence and report counts together.
   - If diagnostics change, make them useful to CLI/server/MCP consumers.
   - If module summaries change, verify retained stored docs plus rebuilt docs are handled correctly.

4. Test the operation.
   - Add or update integration coverage in `packages/indexer/src/indexer.test.ts`.
   - Cover full build, incremental edit, deletion, targeted selector, failure recovery, and GHES/local-git impact when relevant.
   - Run `bun test packages/indexer`, then repo gates.

## Safety Rules

- Do not advance manifests for failed full builds.
- Do not leave child artifacts stale after document replacement.
- Do not treat partial targeted builds as a fully fresh repo.
- Do not bypass transaction boundaries in persistence.
