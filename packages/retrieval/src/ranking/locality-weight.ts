import type { Provenance } from "@atlas/core";

import type { ScopeCandidate } from "../types";

/** Computes a scope/locality contribution from inferred scopes and candidate provenance. */
export function localityWeight(provenance: Provenance, scopes: readonly ScopeCandidate[] = []): number {
  if (scopes.length === 0) {
    return 0.35;
  }

  let best = 0;
  for (const scope of scopes) {
    const contribution = localityForScope(provenance, scope) * scope.score;
    best = Math.max(best, contribution);
  }
  return Number(best.toFixed(3));
}

function localityForScope(provenance: Provenance, scope: ScopeCandidate): number {
  if (scope.level === "skill") {
    if (provenance.skillId === scope.skillId) {
      return 1;
    }
    if (scope.moduleId !== undefined && provenance.moduleId === scope.moduleId) {
      return 0.72;
    }
    if (scope.packageId !== undefined && provenance.packageId === scope.packageId) {
      return 0.48;
    }
    return provenance.repoId === scope.repoId ? 0.22 : 0;
  }
  if (scope.level === "module") {
    if (provenance.moduleId === scope.moduleId) {
      return 1;
    }
    if (scope.packageId !== undefined && provenance.packageId === scope.packageId) {
      return 0.58;
    }
    return provenance.repoId === scope.repoId ? 0.26 : 0;
  }
  if (scope.level === "package") {
    if (provenance.packageId === scope.packageId) {
      return 1;
    }
    return provenance.repoId === scope.repoId ? 0.34 : 0;
  }
  return provenance.repoId === scope.repoId ? 0.82 : 0;
}
