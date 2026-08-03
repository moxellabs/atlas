import type { CaseResult } from "../types";

export function result(
  input: Partial<CaseResult> & Pick<CaseResult, "id" | "category">,
): CaseResult {
  const defaultRetrieval: CaseResult["retrieval"] = {
    expectedPathRanks: [1],
    bestExpectedPathRank: 1,
    recallAt1: 1,
    recallAt3: 1,
    recallAt5: 1,
    reciprocalRank: 1,
    precisionAt1: 1,
    precisionAt3: 0.3333,
    precisionAt5: 0.2,
    ndcgAt3: 1,
    ndcgAt5: 1,
    rankDistance: 0,
    topPathDiversity: 1,
    noResultCorrect: true,
    forbiddenPathCorrect: true,
  };
  return {
    id: input.id,
    category: input.category,
    query: input.query ?? "query",
    passed: input.passed ?? true,
    latencyMs: input.latencyMs ?? 10,
    selectedCount: input.selectedCount ?? 1,
    rankedCount: input.rankedCount ?? 2,
    scores: input.scores ?? {
      pathRecall: 1,
      termRecall: 1,
      nonEmptyContext: true,
    },
    retrieval: input.retrieval ?? defaultRetrieval,
    missing: input.missing ?? {
      pathIncludes: [],
      pathExcludes: [],
      pathPrecedes: [],
      terms: [],
      diagnosticsInclude: [],
      rankedHits: [],
      confidence: [],
      noResults: [],
    },
    topPaths: input.topPaths ?? [],
    diagnostics: input.diagnostics ?? [],
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    ...(input.feature === undefined ? {} : { feature: input.feature }),
    ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.capability === undefined ? {} : { capability: input.capability }),
    ...(input.claim === undefined ? {} : { claim: input.claim }),
    ...(input.whyItMatters === undefined
      ? {}
      : { whyItMatters: input.whyItMatters }),
    ...(input.expectedBehavior === undefined
      ? {}
      : { expectedBehavior: input.expectedBehavior }),
    ...(input.coverageType === undefined
      ? {}
      : { coverageType: input.coverageType }),
    ...(input.riskArea === undefined ? {} : { riskArea: input.riskArea }),
  };
}

export function partialRetrieval(
  overrides: Partial<CaseResult["retrieval"]>,
): CaseResult["retrieval"] {
  return {
    expectedPathRanks: [],
    recallAt1: 0,
    recallAt3: 0,
    recallAt5: 0,
    reciprocalRank: 0,
    precisionAt1: 0,
    precisionAt3: 0,
    precisionAt5: 0,
    ndcgAt3: 0,
    ndcgAt5: 0,
    topPathDiversity: 0,
    noResultCorrect: true,
    forbiddenPathCorrect: true,
    ...overrides,
  };
}
