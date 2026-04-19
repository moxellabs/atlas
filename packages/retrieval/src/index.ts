export { classifyQuery } from "./classify/classify-query";
export {
  RetrievalConfigurationError,
  RetrievalDependencyError,
  RetrievalError,
  RetrievalPlanningError
} from "./errors";
export type { RetrievalErrorContext } from "./errors";
export { expandSections } from "./planner/expand-sections";
export type { ExpandSectionsInput } from "./planner/expand-sections";
export { finalizeContext } from "./planner/finalize-context";
export type { FinalizeContextInput } from "./planner/finalize-context";
export { planContext } from "./planner/plan-context";
export { appendIfBudgetAllows, selectSummaries, toPlannedItem } from "./planner/select-summaries";
export type { SelectSummariesInput } from "./planner/select-summaries";
export { buildAmbiguityResult } from "./presenters/ambiguity-result";
export { buildHitRationale, summarizeHitRationale } from "./presenters/hit-rationale";
export { authorityWeight } from "./ranking/authority-weight";
export type { AuthorityWeightInput } from "./ranking/authority-weight";
export { localityWeight } from "./ranking/locality-weight";
export { rankCandidates } from "./ranking/rank-candidates";
export { redundancyPenalty } from "./ranking/redundancy-penalty";
export { inferScopes } from "./scopes/infer-scopes";
export type { InferScopesInput } from "./scopes/infer-scopes";
export type {
  AmbiguityResult,
  PlannedContext,
  PlannedItem,
  PlanContextInput,
  QueryClassification,
  RankedHit,
  RankCandidatesInput,
  RankingFactors,
  RetrievalCandidate,
  RetrievalDiagnostic,
  RetrievalScopeLevel,
  RetrievalStore,
  RetrievalTargetType,
  ScopeCandidate,
  ScopeInferenceResult
} from "./types";
