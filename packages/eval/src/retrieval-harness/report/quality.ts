import type {
  CaseResult,
  QualityGroupSummary,
  RankBucket,
  WeakCaseSummary,
} from "../types";
import { average, normalizeGroupKey, percentile, rate, round } from "./metrics";

export function rankBuckets(cases: CaseResult[]): RankBucket[] {
  const buckets: Array<[string, string, (result: CaseResult) => boolean]> = [
    ["rank-1", "1", (result) => result.retrieval.bestExpectedPathRank === 1],
    [
      "rank-2-3",
      "2-3",
      (result) =>
        (result.retrieval.bestExpectedPathRank ?? 0) >= 2 &&
        (result.retrieval.bestExpectedPathRank ?? 0) <= 3,
    ],
    [
      "rank-4-5",
      "4-5",
      (result) =>
        (result.retrieval.bestExpectedPathRank ?? 0) >= 4 &&
        (result.retrieval.bestExpectedPathRank ?? 0) <= 5,
    ],
    [
      "rank-6-10",
      "6-10",
      (result) =>
        (result.retrieval.bestExpectedPathRank ?? 0) >= 6 &&
        (result.retrieval.bestExpectedPathRank ?? 0) <= 10,
    ],
    [
      "rank-gt-10",
      ">10",
      (result) => (result.retrieval.bestExpectedPathRank ?? 0) > 10,
    ],
    [
      "missing",
      "missing/no label",
      (result) => result.retrieval.bestExpectedPathRank === undefined,
    ],
  ];
  return buckets.map(([bucket, label, predicate]) => {
    const count = cases.filter(predicate).length;
    return {
      bucket,
      label,
      count,
      rate: cases.length === 0 ? 0 : round(count / cases.length),
    };
  });
}

export function latencyBuckets(cases: CaseResult[]): RankBucket[] {
  const buckets: Array<[string, string, (latency: number) => boolean]> = [
    ["latency-lte-250", "≤250ms", (latency) => latency <= 250],
    [
      "latency-251-500",
      "251-500ms",
      (latency) => latency > 250 && latency <= 500,
    ],
    [
      "latency-501-1000",
      "501-1000ms",
      (latency) => latency > 500 && latency <= 1000,
    ],
    ["latency-gt-1000", ">1000ms", (latency) => latency > 1000],
  ];
  return buckets.map(([bucket, label, predicate]) => {
    const count = cases.filter((result) => predicate(result.latencyMs)).length;
    return {
      bucket,
      label,
      count,
      rate: cases.length === 0 ? 0 : round(count / cases.length),
    };
  });
}

export function weakestCases(
  cases: CaseResult[],
  limit = 10,
): WeakCaseSummary[] {
  return [...cases]
    .sort(compareWeakness)
    .slice(0, limit)
    .map((result) => ({
      id: result.id,
      category: result.category,
      ...(result.feature === undefined ? {} : { feature: result.feature }),
      ...(result.riskArea === undefined ? {} : { riskArea: result.riskArea }),
      passed: result.passed,
      recallAt5: result.retrieval.recallAt5,
      mrr: result.retrieval.reciprocalRank,
      ...(result.retrieval.bestExpectedPathRank === undefined
        ? {}
        : { bestExpectedPathRank: result.retrieval.bestExpectedPathRank }),
      latencyMs: result.latencyMs,
      reason: weakReason(result),
    }));
}

export function byQualityGroup(
  cases: CaseResult[],
  keyFor: (result: CaseResult) => string | undefined,
): Record<string, QualityGroupSummary> {
  const groups = new Map<string, CaseResult[]>();
  for (const result of cases) {
    const key = normalizeGroupKey(keyFor(result));
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .map(([group, grouped]) => [group, qualitySummary(grouped)] as const)
      .sort(
        ([leftName, left], [rightName, right]) =>
          left.recallAt5 - right.recallAt5 ||
          left.mrr - right.mrr ||
          right.total - left.total ||
          leftName.localeCompare(rightName),
      ),
  );
}

function compareWeakness(left: CaseResult, right: CaseResult): number {
  return (
    Number(left.passed) - Number(right.passed) ||
    left.retrieval.recallAt5 - right.retrieval.recallAt5 ||
    left.retrieval.reciprocalRank - right.retrieval.reciprocalRank ||
    (right.retrieval.bestExpectedPathRank ?? Number.MAX_SAFE_INTEGER) -
      (left.retrieval.bestExpectedPathRank ?? Number.MAX_SAFE_INTEGER) ||
    right.latencyMs - left.latencyMs ||
    left.id.localeCompare(right.id)
  );
}

function weakReason(result: CaseResult): string {
  if (!result.passed) return "failed deterministic expectations";
  if (result.retrieval.bestExpectedPathRank === undefined)
    return "expected path missing or unlabeled no-result case";
  if (result.retrieval.recallAt5 < 1) {
    if (result.retrieval.topPathDiversity <= 1 && result.topPaths.length >= 2)
      return "top-5 dominated by one directory";
    return "expected path outside top five";
  }
  if (result.retrieval.bestExpectedPathRank > 1)
    return "expected path not ranked first";
  return "slow relative latency";
}

function qualitySummary(cases: CaseResult[]): QualityGroupSummary {
  return {
    total: cases.length,
    passed: cases.filter((result) => result.passed).length,
    passRate: rate(cases, (result) => result.passed),
    recallAt5: average(cases.map((result) => result.retrieval.recallAt5)),
    mrr: average(cases.map((result) => result.retrieval.reciprocalRank)),
    averageLatencyMs: average(cases.map((result) => result.latencyMs)),
    p95LatencyMs: percentile(
      cases.map((result) => result.latencyMs),
      0.95,
    ),
    weakestCases: weakestCases(cases, 3).map((result) => result.id),
  };
}
