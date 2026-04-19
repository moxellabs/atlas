import type { ClassifiedDoc, DocKind, DocScope, ModuleNode, PackageNode, TopologyRule } from "@atlas/core";
import { createDocId } from "@atlas/core";

import { normalizeRepoPath } from "../path-utils";
import { ImpossibleOwnershipResolutionError } from "../errors";
import { evaluateTopologyRules } from "../rules/evaluate-topology-rules";
import type { RuleMatch } from "../rules/evaluate-topology-rules";
import { inferModuleScope } from "../rules/infer-module-scope";
import { inferPackageScope } from "../rules/infer-package-scope";
import { inferSkillScope } from "../rules/infer-skill-scope";

/** Options for classifying one documentation path. */
export interface ClassifyDocOptions {
  /** Stable repository identifier. */
  repoId: string;
  /** Repository-relative path. */
  path: string;
  /** Topology rules to evaluate. */
  rules: readonly TopologyRule[];
  /** Discovered package nodes. */
  packages: readonly PackageNode[];
  /** Discovered module nodes. */
  modules: readonly ModuleNode[];
}

/** Classifies one documentation path into kind, authority, scopes, and diagnostics. */
export function classifyDoc(options: ClassifyDocOptions): ClassifiedDoc | undefined {
  const path = normalizeRepoPath(options.path);
  const matches = evaluateTopologyRules({ path, rules: options.rules });
  const primaryMatch = selectPrimaryRuleMatch(matches);
  if (!primaryMatch && !isFallbackDocPath(path)) {
    return undefined;
  }

  const packageInference = inferPackageScope(path, options.packages);
  const moduleInference = inferModuleScope(path, options.modules);
  const skillInference = inferSkillScope(path, options.repoId, options.packages, options.modules, options.rules);
  const kind = primaryMatch?.kind ?? fallbackKind(path, packageInference.scope !== undefined);
  const authority = primaryMatch?.authority ?? "supplemental";
  const scopes = buildDocScopes({
    repoId: options.repoId,
    primaryMatch,
    packageScope: packageInference.scope,
    moduleScope: moduleInference.scope,
    skillScope: skillInference.scope
  });
  assertNoContradictoryOwnership({
    path,
    primaryMatch,
    packageInferred: packageInference.scope !== undefined,
    moduleInferred: moduleInference.scope !== undefined,
    skillInferred: skillInference.scope !== undefined
  });

  return {
    docId: createDocId({ repoId: options.repoId, path }),
    repoId: options.repoId,
    path,
    kind,
    authority,
    scopes,
    packageId: moduleInference.moduleNode?.packageId ?? packageInference.packageNode?.packageId,
    moduleId: moduleInference.moduleNode?.moduleId,
    skillId: skillInference.skillId,
    diagnostics: buildClassificationDiagnostics(matches, primaryMatch, {
      packageInferred: packageInference.scope !== undefined,
      moduleInferred: moduleInference.scope !== undefined,
      skillInferred: skillInference.scope !== undefined,
      fallbackUsed: primaryMatch === undefined,
      ownershipFallback: ownershipFallbackReason(primaryMatch, {
        packageInferred: packageInference.scope !== undefined,
        moduleInferred: moduleInference.scope !== undefined,
        skillInferred: skillInference.scope !== undefined
      })
    })
  };
}

/** Selects the deterministic primary rule match. */
export function selectPrimaryRuleMatch(matches: readonly RuleMatch[]): RuleMatch | undefined {
  return matches[0];
}

function buildDocScopes(options: {
  repoId: string;
  primaryMatch?: RuleMatch | undefined;
  packageScope?: DocScope | undefined;
  moduleScope?: DocScope | undefined;
  skillScope?: DocScope | undefined;
}): DocScope[] {
  const attachTo = options.primaryMatch?.rule.ownership.attachTo ?? "repo";
  if (attachTo === "skill" && options.skillScope) {
    return [options.skillScope];
  }
  if (attachTo === "module" && options.moduleScope) {
    return [options.moduleScope];
  }
  if (attachTo === "package" && options.packageScope) {
    return [options.packageScope];
  }
  if (options.skillScope) {
    return [options.skillScope];
  }
  if (options.moduleScope) {
    return [options.moduleScope];
  }
  if (options.packageScope) {
    return [options.packageScope];
  }
  return [{ level: "repo", repoId: options.repoId }];
}

function buildClassificationDiagnostics(
  matches: readonly RuleMatch[],
  primaryMatch: RuleMatch | undefined,
  inference: {
    packageInferred: boolean;
    moduleInferred: boolean;
    skillInferred: boolean;
    fallbackUsed: boolean;
    ownershipFallback?: string | undefined;
  }
): ClassifiedDoc["diagnostics"] {
  const diagnostics: ClassifiedDoc["diagnostics"] = matches.map((match) => ({
    ruleId: match.ruleId,
    reason:
      match === primaryMatch
        ? `Selected topology rule ${match.ruleId} via ${match.matchedBy.includePattern}.`
        : `Competing topology rule ${match.ruleId} also matched via ${match.matchedBy.includePattern}.`,
    confidence: match === primaryMatch ? "high" : "medium"
  }));

  if (inference.packageInferred) {
    diagnostics.push({ reason: "Package scope inferred from path containment.", confidence: "high" });
  }
  if (inference.moduleInferred) {
    diagnostics.push({ reason: "Module scope inferred from path containment.", confidence: "high" });
  }
  if (inference.skillInferred) {
    diagnostics.push({ reason: "Skill scope inferred from skill path convention or rule.", confidence: "high" });
  }
  if (inference.fallbackUsed) {
    diagnostics.push({ reason: "Fallback structural documentation heuristic was used.", confidence: "low" });
  }
  if (inference.ownershipFallback) {
    diagnostics.push({ reason: inference.ownershipFallback, confidence: "medium" });
  }
  if (matches.length > 1) {
    diagnostics.push({ reason: "Multiple topology rules matched; highest priority rule selected.", confidence: "medium" });
  }

  return diagnostics;
}

function ownershipFallbackReason(
  primaryMatch: RuleMatch | undefined,
  inference: {
    packageInferred: boolean;
    moduleInferred: boolean;
    skillInferred: boolean;
  }
): string | undefined {
  const attachTo = primaryMatch?.rule.ownership.attachTo;
  if (attachTo === "package" && !inference.packageInferred) {
    return "Selected rule requested package ownership, but no package scope was inferred; repo fallback scope was used.";
  }
  if (attachTo === "module" && !inference.moduleInferred) {
    return "Selected rule requested module ownership, but no module scope was inferred; best available fallback scope was used.";
  }
  if (attachTo === "skill" && !inference.skillInferred) {
    return "Selected rule requested skill ownership, but no skill scope was inferred; best available fallback scope was used.";
  }
  return undefined;
}

function assertNoContradictoryOwnership(options: {
  path: string;
  primaryMatch: RuleMatch | undefined;
  packageInferred: boolean;
  moduleInferred: boolean;
  skillInferred: boolean;
}): void {
  const attachTo = options.primaryMatch?.rule.ownership.attachTo;
  if (attachTo === "skill" && options.moduleInferred && !options.skillInferred) {
    throw new ImpossibleOwnershipResolutionError("Rule requested skill ownership for a module path that is not a skill artifact.", {
      path: options.path,
      ruleId: options.primaryMatch?.ruleId
    });
  }
}

function isFallbackDocPath(path: string): boolean {
  return path.startsWith("docs/") && !path.startsWith("docs/archive/") && path.endsWith(".md");
}

function fallbackKind(path: string, hasPackageScope: boolean): DocKind {
  if (path.toLowerCase().endsWith("/skill.md")) {
    return "skill-doc";
  }
  return hasPackageScope ? "package-doc" : "repo-doc";
}
