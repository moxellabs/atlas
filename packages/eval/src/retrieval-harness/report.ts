import type {
  BaselineSummary,
  CaseResult,
  Report,
  ReportThresholdInput,
  RuntimeInfo,
} from "./types";
import { computeDeltas, evaluateRegressions } from "./report/deltas";
import { buildMetrics, byGroup, countBy } from "./report/metrics";
import { buildNarrative } from "./report/narrative";
import {
  byQualityGroup,
  latencyBuckets,
  rankBuckets,
  weakestCases,
} from "./report/quality";
import { evaluateThresholds } from "./report/thresholds";

export function buildReport(
  dataset: {
    name: string;
    description?: string;
    repoId?: string;
    cases?: unknown[];
  },
  cases: CaseResult[],
  runtime: RuntimeInfo,
  _legacyJudge: { provider?: string; model?: string },
  thresholds: ReportThresholdInput = {},
  baseline?: BaselineSummary,
): Report {
  const passedCases = cases.filter((result) => result.passed).length;
  const metrics = buildMetrics(cases);
  const thresholdResults = evaluateThresholds(metrics, thresholds);
  const deltas = computeDeltas(
    metrics,
    baseline,
    thresholds.maxMetricRegression,
  );
  const regressionResults = deltas
    ? evaluateRegressions(deltas, thresholds.maxMetricRegression)
    : [];
  const combinedThresholdResults = [...thresholdResults, ...regressionResults];
  const narrative = buildNarrative(metrics, cases, deltas);
  return {
    dataset: dataset.name,
    ...(dataset.description === undefined
      ? {}
      : { description: dataset.description }),
    generatedAt: new Date().toISOString(),
    ...(dataset.repoId === undefined ? {} : { repoId: dataset.repoId }),
    runtime,
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    metrics,
    quality: {
      rankBuckets: rankBuckets(cases),
      latencyBuckets: latencyBuckets(cases),
      weakestCases: weakestCases(cases),
      byCapability: byQualityGroup(
        cases,
        (result) => result.capability ?? result.feature ?? result.category,
      ),
      byRiskArea: byQualityGroup(cases, (result) => result.riskArea),
      byProfile: byQualityGroup(cases, (result) => result.profile),
      byFeature: byQualityGroup(cases, (result) => result.feature),
      byCategory: byQualityGroup(cases, (result) => result.category),
      byPriority: byQualityGroup(cases, (result) => result.priority),
      byCoverageType: byQualityGroup(cases, (result) => result.coverageType),
    },
    narrative,
    coverage: {
      capabilities: countBy(
        cases,
        (result) => result.capability ?? result.feature ?? result.category,
      ),
      priorities: countBy(
        cases,
        (result) => result.priority ?? "unprioritized",
      ),
      riskAreas: countBy(cases, (result) => result.riskArea ?? "general"),
      coverageTypes: countBy(
        cases,
        (result) => result.coverageType ?? "deterministic",
      ),
    },
    ...(combinedThresholdResults.length === 0
      ? {}
      : {
          thresholds: {
            passed: combinedThresholdResults.every((result) => result.passed),
            results: combinedThresholdResults,
          },
        }),
    ...(deltas === undefined ? {} : { deltas }),
    byCategory: byGroup(cases, (result) => result.category),
    byProfile: byGroup(cases, (result) => result.profile),
    byFeature: byGroup(cases, (result) => result.feature),
    byScenario: byGroup(cases, (result) => result.scenario),
    cases,
  };
}
