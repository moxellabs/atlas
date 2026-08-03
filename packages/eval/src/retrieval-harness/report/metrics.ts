import type { HealthMetric } from "../health";
import type { CaseResult, Report, ReportGroup } from "../types";

export function buildMetrics(cases: CaseResult[]): Report["metrics"] {
  const rankDistances = cases
    .map((result) => result.retrieval.rankDistance)
    .filter((value): value is number => value !== undefined);
  const cliLatencies = cases.map(
    (result) => result.cliLatencyMs ?? result.latencyMs,
  );
  return {
    passRate: rate(cases, (result) => result.passed),
    pathRecall: average(cases.map((result) => result.scores.pathRecall)),
    termRecall: average(cases.map((result) => result.scores.termRecall)),
    nonEmptyContextRate: rate(cases, (result) => result.scores.nonEmptyContext),
    averageLatencyMs: average(cases.map((result) => result.latencyMs)),
    medianLatencyMs: percentile(
      cases.map((result) => result.latencyMs),
      0.5,
    ),
    p95LatencyMs: percentile(
      cases.map((result) => result.latencyMs),
      0.95,
    ),
    averageCliLatencyMs: average(cliLatencies),
    medianCliLatencyMs: percentile(cliLatencies, 0.5),
    p95CliLatencyMs: percentile(cliLatencies, 0.95),
    averageRankedHits: average(cases.map((result) => result.rankedCount)),
    pathRecallAt1: average(cases.map((result) => result.retrieval.recallAt1)),
    pathRecallAt3: average(cases.map((result) => result.retrieval.recallAt3)),
    pathRecallAt5: average(cases.map((result) => result.retrieval.recallAt5)),
    expectedPathPrecisionAt1: average(
      cases.map((result) => result.retrieval.precisionAt1),
    ),
    expectedPathPrecisionAt3: average(
      cases.map((result) => result.retrieval.precisionAt3),
    ),
    expectedPathPrecisionAt5: average(
      cases.map((result) => result.retrieval.precisionAt5),
    ),
    expectedPathNdcgAt3: average(
      cases.map((result) => result.retrieval.ndcgAt3),
    ),
    expectedPathNdcgAt5: average(
      cases.map((result) => result.retrieval.ndcgAt5),
    ),
    mrr: average(cases.map((result) => result.retrieval.reciprocalRank)),
    noResultAccuracy: rate(cases, (result) => result.retrieval.noResultCorrect),
    forbiddenPathAccuracy: rate(
      cases,
      (result) => result.retrieval.forbiddenPathCorrect,
    ),
    averageRankDistance:
      rankDistances.length === 0 ? 0 : average(rankDistances),
    averageTopPathDiversity: average(
      cases.map((result) => result.retrieval.topPathDiversity),
    ),
  };
}

export function metricValue(
  metric: HealthMetric,
  metrics: Report["metrics"],
): number {
  const mapping: Record<HealthMetric, number> = {
    passRate: metrics.passRate,
    pathRecall: metrics.pathRecall,
    termRecall: metrics.termRecall,
    nonEmptyContextRate: metrics.nonEmptyContextRate,
    pathRecallAt1: metrics.pathRecallAt1,
    pathRecallAt3: metrics.pathRecallAt3,
    pathRecallAt5: metrics.pathRecallAt5,
    expectedPathPrecisionAt5: metrics.expectedPathPrecisionAt5,
    expectedPathNdcgAt5: metrics.expectedPathNdcgAt5,
    mrr: metrics.mrr,
    p95LatencyMs: metrics.p95LatencyMs,
    averageLatencyMs: metrics.averageLatencyMs,
    noResultAccuracy: metrics.noResultAccuracy,
    forbiddenPathAccuracy: metrics.forbiddenPathAccuracy,
  };
  return mapping[metric];
}

export function byGroup(
  cases: CaseResult[],
  keyFor: (result: CaseResult) => string | undefined,
): ReportGroup {
  const groups = new Map<string, CaseResult[]>();
  for (const result of cases) {
    const key = normalizeGroupKey(keyFor(result));
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, grouped]) => [
        group,
        {
          total: grouped.length,
          passed: grouped.filter((result) => result.passed).length,
          passRate: rate(grouped, (result) => result.passed),
          pathRecall: average(
            grouped.map((result) => result.scores.pathRecall),
          ),
          termRecall: average(
            grouped.map((result) => result.scores.termRecall),
          ),
          nonEmptyContextRate: rate(
            grouped,
            (result) => result.scores.nonEmptyContext,
          ),
          averageLatencyMs: average(grouped.map((result) => result.latencyMs)),
          recallAt5: average(
            grouped.map((result) => result.retrieval.recallAt5),
          ),
          mrr: average(
            grouped.map((result) => result.retrieval.reciprocalRank),
          ),
        },
      ]),
  );
}

export function countBy(
  cases: CaseResult[],
  keyFor: (result: CaseResult) => string,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const result of cases) {
    const key = normalizeGroupKey(keyFor(result));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function normalizeGroupKey(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? "unknown" : trimmed;
}

export function average(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? 0;
}

export function rate(
  results: CaseResult[],
  predicate: (result: CaseResult) => boolean,
): number {
  return results.length === 0
    ? 0
    : round(results.filter(predicate).length / results.length);
}

export function round(value: number): number {
  return Number(value.toFixed(4));
}
