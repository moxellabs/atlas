import type {
  Report,
  ReportThresholdInput,
  ReportThresholdResult,
} from "../types";

export function evaluateThresholds(
  metrics: Report["metrics"],
  thresholds: ReportThresholdInput,
): ReportThresholdResult[] {
  return [
    floorThreshold(
      "passRate",
      "Pass rate",
      metrics.passRate,
      thresholds.minPassRate,
    ),
    floorThreshold(
      "pathRecall",
      "Path recall",
      metrics.pathRecall,
      thresholds.minPathRecall,
    ),
    floorThreshold(
      "termRecall",
      "Term recall",
      metrics.termRecall,
      thresholds.minTermRecall,
    ),
    floorThreshold(
      "nonEmptyContextRate",
      "Non-empty context",
      metrics.nonEmptyContextRate,
      thresholds.minNonEmptyContextRate,
    ),
    floorThreshold(
      "pathRecallAt1",
      "Recall@1",
      metrics.pathRecallAt1,
      thresholds.minRecallAt1,
    ),
    floorThreshold(
      "pathRecallAt3",
      "Recall@3",
      metrics.pathRecallAt3,
      thresholds.minRecallAt3,
    ),
    floorThreshold(
      "pathRecallAt5",
      "Recall@5",
      metrics.pathRecallAt5,
      thresholds.minRecallAt5,
    ),
    floorThreshold("mrr", "MRR", metrics.mrr, thresholds.minMrr),
    floorThreshold(
      "noResultAccuracy",
      "Abstain accuracy",
      metrics.noResultAccuracy,
      thresholds.minNoResultAccuracy,
    ),
    floorThreshold(
      "forbiddenPathAccuracy",
      "Forbidden-path accuracy",
      metrics.forbiddenPathAccuracy,
      thresholds.minForbiddenPathAccuracy,
    ),
    ceilingThreshold(
      "p95LatencyMs",
      "p95 latency",
      metrics.p95LatencyMs,
      thresholds.maxP95LatencyMs,
    ),
    ceilingThreshold(
      "averageLatencyMs",
      "Avg latency",
      metrics.averageLatencyMs,
      thresholds.maxAverageLatencyMs,
    ),
  ].filter((result): result is ReportThresholdResult => result !== undefined);
}

function floorThreshold(
  metric: ReportThresholdResult["metric"],
  label: string,
  actual: number,
  minimum: number | undefined,
): ReportThresholdResult | undefined {
  if (minimum === undefined) return undefined;
  return {
    metric,
    label,
    actual,
    limit: minimum,
    direction: "higher",
    passed: actual >= minimum,
  };
}

function ceilingThreshold(
  metric: ReportThresholdResult["metric"],
  label: string,
  actual: number,
  maximum: number | undefined,
): ReportThresholdResult | undefined {
  if (maximum === undefined) return undefined;
  return {
    metric,
    label,
    actual,
    limit: maximum,
    direction: "lower",
    passed: actual <= maximum,
  };
}
