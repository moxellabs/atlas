import {
  HEALTH_THRESHOLDS,
  type HealthLevel,
  type HealthMetric,
} from "../health";
import { METRIC_GLOSSARY } from "../metric-glossary";
import type {
  BaselineSummary,
  MetricDeltaEntry,
  RegressionEntry,
  Report,
  ReportDeltas,
  ReportThresholdResult,
} from "../types";
import { metricValue, round } from "./metrics";

interface HealthThreshold {
  readonly direction?: "lower";
}

const BASELINE_METRICS: ReadonlyArray<HealthMetric> = [
  "passRate",
  "pathRecall",
  "termRecall",
  "nonEmptyContextRate",
  "pathRecallAt1",
  "pathRecallAt3",
  "pathRecallAt5",
  "expectedPathPrecisionAt5",
  "expectedPathNdcgAt5",
  "mrr",
  "p95LatencyMs",
  "averageLatencyMs",
  "noResultAccuracy",
  "forbiddenPathAccuracy",
];

export function computeDeltas(
  metrics: Report["metrics"],
  baseline: BaselineSummary | undefined,
  tolerance: number | undefined,
): ReportDeltas | undefined {
  if (baseline === undefined) return undefined;
  const entries: MetricDeltaEntry[] = [];
  for (const metric of BASELINE_METRICS) {
    const current = metricValue(metric, metrics);
    const baselineValue = (
      baseline.metrics as Record<string, number | undefined>
    )[metric];
    if (baselineValue === undefined) continue;
    const direction =
      (HEALTH_THRESHOLDS[metric] as HealthThreshold).direction === "lower"
        ? "lower"
        : "higher";
    const delta = round(current - baselineValue);
    entries.push({
      metric,
      label: METRIC_GLOSSARY[metric].label,
      current,
      baseline: baselineValue,
      delta,
      direction,
      severity: classifyDelta(metric, delta, direction, tolerance),
    });
  }
  const regressions: RegressionEntry[] = entries
    .filter((entry) => entry.severity === "bad")
    .map((entry) => ({
      metric: entry.metric,
      label: entry.label,
      delta: entry.delta,
      tolerance: tolerance ?? 0.05,
      direction: entry.direction,
    }));
  return {
    baseline: {
      ...(baseline.generatedAt === undefined
        ? {}
        : { generatedAt: baseline.generatedAt }),
      ...(baseline.repoRevision === undefined
        ? {}
        : { repoRevision: baseline.repoRevision }),
      ...(baseline.dataset === undefined ? {} : { dataset: baseline.dataset }),
    },
    entries,
    regressions,
  };
}

export function evaluateRegressions(
  deltas: ReportDeltas,
  tolerance: number | undefined,
): ReportThresholdResult[] {
  if (tolerance === undefined) return [];
  return deltas.regressions.map((regression) => ({
    metric: regression.metric as keyof Report["metrics"],
    label: `${regression.label} regression`,
    actual: regression.delta,
    limit: regression.direction === "higher" ? -tolerance : tolerance,
    direction: regression.direction === "higher" ? "higher" : "lower",
    passed: false,
  }));
}

function classifyDelta(
  metric: HealthMetric,
  delta: number,
  direction: "higher" | "lower",
  tolerance: number | undefined,
): HealthLevel {
  if (Math.abs(delta) < 1e-9) return "good";
  const isRegression = direction === "higher" ? delta < 0 : delta > 0;
  if (!isRegression) return "good";
  const magnitude = Math.abs(delta);
  if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
    if (magnitude > 500) return "bad";
    if (magnitude > 150) return "warn";
    return "good";
  }
  const effective = tolerance ?? 0.05;
  if (magnitude > effective) return "bad";
  if (magnitude > effective / 2) return "warn";
  return "good";
}
