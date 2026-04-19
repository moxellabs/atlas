import type { Authority, QueryKind } from "@atlas/core";

/** Input for authority weighting. */
export interface AuthorityWeightInput {
  /** Candidate authority level. */
  authority: Authority;
  /** Query intent; overview queries value canonical docs slightly more. */
  queryKind: QueryKind;
}

/** Returns an explainable authority contribution for ranking. */
export function authorityWeight(input: AuthorityWeightInput): number {
  const base = input.authority === "canonical" ? 1 : input.authority === "preferred" ? 0.72 : 0.44;
  const overviewBoost = input.queryKind === "overview" && input.authority === "canonical" ? 0.14 : 0;
  const usageBoost = input.queryKind === "usage" && input.authority === "preferred" ? 0.08 : 0;
  return round(base + overviewBoost + usageBoost);
}

function round(value: number): number {
  return Number(Math.min(1.12, value).toFixed(3));
}
