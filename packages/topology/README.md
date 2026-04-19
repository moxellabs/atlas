# @atlas/topology

Repository topology discovery and document classification for ATLAS.

This package turns a source file tree plus topology rules into package nodes, module nodes, classified docs, and skill nodes.

## Runtime Role

- Finds package manifests from configured workspace globs.
- Discovers module roots from module-local docs and rule hints.
- Evaluates topology rules with include/exclude patterns, authority, ownership, and priority.
- Classifies documentation and skills into repo/package/module/skill scopes.
- Selects a built-in topology adapter for mixed monorepos, module-local docs, or package/top-level layouts.

## Public API

- Adapters: `MixedMonorepoTopologyAdapter`, `ModuleLocalDocsTopologyAdapter`, `PackageTopLevelTopologyAdapter`
- Adapter selection: `selectTopologyAdapter`
- Discovery: `discoverPackages`, `discoverModules`
- Classification: `classifyDoc`, `classifySkill`
- Rule utilities: `evaluateTopologyRules`, `isMatch`
- Structured topology errors and diagnostics

## Development

```bash
bun --cwd packages/topology run typecheck
bun test packages/topology
```
