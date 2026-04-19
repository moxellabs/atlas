export { MixedMonorepoTopologyAdapter } from "./adapters/mixed-monorepo.adapter";
export { ModuleLocalDocsTopologyAdapter } from "./adapters/module-local-docs.adapter";
export { PackageTopLevelTopologyAdapter } from "./adapters/package-top-level.adapter";
export { selectTopologyAdapter } from "./adapters/select-topology-adapter";
export type { SelectTopologyAdapterOptions } from "./adapters/select-topology-adapter";
export { classifyDoc, selectPrimaryRuleMatch } from "./classifiers/classify-doc";
export type { ClassifyDocOptions } from "./classifiers/classify-doc";
export { classifySkill } from "./classifiers/classify-skill";
export type { ClassifySkillOptions } from "./classifiers/classify-skill";
export { collectModuleRootCandidates, discoverModules, discoverModulesWithDiagnostics } from "./discovery/discover-modules";
export type { DiscoverModulesOptions, DiscoverModulesResult } from "./discovery/discover-modules";
export { discoverPackages, discoverPackagesWithDiagnostics, findPackageManifestPaths } from "./discovery/discover-packages";
export type { DiscoverPackagesOptions, DiscoverPackagesResult } from "./discovery/discover-packages";
export type { TopologyDiscoveryDiagnostic } from "./diagnostics";
export {
  ImpossibleOwnershipResolutionError,
  InconsistentModuleDiscoveryError,
  InconsistentPackageDiscoveryError,
  TopologyError,
  TopologyIdCollisionError,
  UnsupportedTopologyAdapterError
} from "./errors";
export { evaluateTopologyRules, isMatch, TopologyRuleError } from "./rules/evaluate-topology-rules";
export type { EvaluateTopologyRulesOptions, RuleMatch } from "./rules/evaluate-topology-rules";
export { inferModuleScope } from "./rules/infer-module-scope";
export type { ModuleScopeInference } from "./rules/infer-module-scope";
export { inferPackageScope } from "./rules/infer-package-scope";
export type { PackageScopeInference } from "./rules/infer-package-scope";
export { inferSkillScope, isSkillPath } from "./rules/infer-skill-scope";
export type { SkillScopeInference } from "./rules/infer-skill-scope";
