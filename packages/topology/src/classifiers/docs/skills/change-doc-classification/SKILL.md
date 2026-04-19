---
name: change-doc-classification
description: Change Atlas document or skill classification. Use when an agent needs to modify packages/topology doc classification, skill classification, fallback docs behavior, topology rules, package/module/skill scope inference, authority selection, diagnostics, archive exclusion, or topology discovery tests.
---

# Change Doc Classification

Use this skill for changes in `packages/topology` that affect how paths become packages, modules, docs, or skills.

## Workflow

1. Locate the classification layer.
   - Doc classifier: `classifiers/classify-doc.ts`.
   - Skill classifier: `classifiers/classify-skill.ts`.
   - Rule matching: `rules/evaluate-topology-rules.ts`.
   - Scope inference: `rules/infer-package-scope.ts`, `infer-module-scope.ts`, `infer-skill-scope.ts`.
   - Discovery: `discovery/discover-packages.ts` and `discover-modules.ts`.
   - Adapter orchestration: `adapters/*.adapter.ts`.

2. Preserve classification invariants.
   - Explicit topology rules should win by priority, then stable rule ID.
   - Fallback docs behavior should stay conservative.
   - `docs/archive/**` should not become active root docs.
   - `skill.md` and `SKILL.md` should both be valid skill artifacts.
   - Package/module/skill IDs must be deterministic and repo-relative.

3. Update related surfaces.
   - If path conventions change, update CLI topology templates and `atlas.config.example.json`.
   - If scopes change, check indexer targeted builds and MCP resource expectations.
   - If diagnostics change, keep reasons actionable and confidence explicit.

4. Test classification.
   - Add or update tests in `packages/topology/src/adapters/*`, `discovery/*`, or `rules/*`.
   - Cover include/exclude rules, fallback behavior, package/module inference, skill ownership, archive exclusion, and deterministic ordering.
   - Run `bun test packages/topology`, then repo gates.

## Safety Rules

- Do not classify arbitrary Markdown as active docs unless the topology intentionally owns it.
- Do not infer module roots from package docs.
- Do not silently resolve impossible explicit skill ownership on non-skill module docs.
