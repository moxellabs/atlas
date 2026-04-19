import type { AmbiguityResult, RankedHit, ScopeCandidate } from "../types";

/** Builds an ambiguity result when evidence is weak or plausible alternatives remain. */
export function buildAmbiguityResult(input: {
  /** Ranked hits considered by the planner. */
  rankedHits: readonly RankedHit[];
  /** Inferred scopes considered by the planner. */
  scopes: readonly ScopeCandidate[];
  /** Optional explicit reason supplied by the caller. */
  reason?: string | undefined;
}): AmbiguityResult | undefined {
  const reason = input.reason ?? detectAmbiguityReason(input.rankedHits, input.scopes);
  if (reason === undefined) {
    return undefined;
  }
  return {
    status: "ambiguous",
    reason,
    candidates: input.rankedHits.slice(0, 5),
    recommendedNextActions: recommendedActions(reason)
  };
}

function detectAmbiguityReason(rankedHits: readonly RankedHit[], scopes: readonly ScopeCandidate[]): string | undefined {
  if (rankedHits.length === 0) {
    return "No retrieval candidates matched the query.";
  }
  const [first, second] = rankedHits;
  if (first !== undefined && first.score < 0.85) {
    return "Top ranked evidence is weak.";
  }
  if (first !== undefined && second !== undefined && first.provenance.docId !== second.provenance.docId && Math.abs(first.score - second.score) <= 0.08) {
    return "Multiple top-ranked hits are too close to choose confidently.";
  }
  const strongScopes = scopes.filter((scope) => scope.score >= 0.62);
  if (strongScopes.length >= 3) {
    return "Query matches several plausible scopes.";
  }
  return undefined;
}

function recommendedActions(reason: string): string[] {
  if (reason.includes("No retrieval candidates")) {
    return ["Broaden the query terms.", "Check whether the repository has been indexed."];
  }
  if (reason.includes("scopes")) {
    return ["Specify the package, module, or skill name.", "Ask for one scope at a time."];
  }
  return ["Add a file path, module name, or more specific concept.", "Inspect the top alternatives before answering."];
}
