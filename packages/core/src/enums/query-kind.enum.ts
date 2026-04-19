/** Stable retrieval query intent classifications. */
export const QUERY_KINDS = [
  "overview",
  "exact-lookup",
  "usage",
  "skill-invocation",
  "troubleshooting",
  "diff",
  "location",
  "compare",
  "unknown"
] as const;

/** Type of user question the retrieval planner is handling. */
export type QueryKind = (typeof QUERY_KINDS)[number];
