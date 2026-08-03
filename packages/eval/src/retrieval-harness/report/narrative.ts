import {
  classifyHealth,
  formatMetricValue,
  HEALTH_THRESHOLDS,
  type HealthLevel,
  type HealthMetric,
  worstHealth,
} from "../health";
import { METRIC_GLOSSARY } from "../metric-glossary";
import type {
  CaseResult,
  NarrativeFinding,
  Report,
  ReportDeltas,
  WeakCaseSummary,
} from "../types";
import { weakestCases } from "./quality";
import { metricValue } from "./metrics";

interface HealthThreshold {
  readonly good: number;
  readonly warn: number;
  readonly direction?: "lower";
}

const NARRATIVE_METRICS: ReadonlyArray<HealthMetric> = [
  "passRate",
  "pathRecallAt5",
  "mrr",
  "pathRecallAt1",
  "p95LatencyMs",
  "noResultAccuracy",
  "forbiddenPathAccuracy",
  "termRecall",
];

export function buildNarrative(
  metrics: Report["metrics"],
  cases: CaseResult[],
  deltas?: ReportDeltas,
): Report["narrative"] {
  const total = cases.length;
  const passed = cases.filter((result) => result.passed).length;
  const findings: NarrativeFinding[] = NARRATIVE_METRICS.map((metric) =>
    narrativeFinding(metric, metrics, passed, total),
  );
  const severity = worstHealth(findings.map((finding) => finding.severity));
  const headline = buildHeadline(findings, severity, passed, total);
  const verdict = buildVerdict(findings, deltas);
  const caveats = [
    "This report measures retrieval evidence quality, not generated-answer faithfulness or hallucination rate.",
    "Expected-path precision and nDCG are lower-bound sparse-label metrics; unlabeled relevant documents can make true relevance higher.",
    "Perfect pass rate means deterministic gates passed, not that ranking is saturated or optimal.",
  ];
  const attentionAreas = weakestCases(cases, 5).map((result) => ({
    severity: attentionSeverity(result),
    message: `${result.id}: ${result.reason}`,
    caseId: result.id,
  }));
  return {
    severity,
    headline,
    verdict,
    keyFindings: findings,
    caveats,
    attentionAreas,
    metricNotes: [
      "Recall@k measures whether expected source paths appear in practical reading windows.",
      "MRR rewards earlier first expected evidence and exposes ranking headroom even when cases pass.",
      "Latency buckets summarize local CLI query responsiveness.",
    ],
  };
}

function narrativeFinding(
  metric: HealthMetric,
  metrics: Report["metrics"],
  passed: number,
  total: number,
): NarrativeFinding {
  const value = metricValue(metric, metrics);
  const severity = classifyHealth(metric, value);
  const threshold = HEALTH_THRESHOLDS[metric] as HealthThreshold;
  const direction = threshold.direction === "lower" ? "lower" : "higher";
  const displayValue =
    metric === "passRate"
      ? `${passed}/${total} (${formatMetricValue(metric, value)})`
      : formatMetricValue(metric, value);
  return {
    metric,
    label: METRIC_GLOSSARY[metric].label,
    value: displayValue,
    severity,
    message: narrativeMessage(metric, severity, direction, threshold, value),
  };
}

function narrativeMessage(
  metric: HealthMetric,
  severity: HealthLevel,
  direction: "higher" | "lower",
  threshold: HealthThreshold,
  value: number,
): string {
  const bound = severity === "bad" ? threshold.warn : threshold.good;
  const comparator = direction === "lower" ? "≤" : "≥";
  const verdict =
    severity === "good"
      ? "within the healthy band"
      : severity === "warn"
        ? `in the warn band (needs ${comparator} ${formatMetricValue(metric, threshold.good)} to clear)`
        : `below the warn floor (needs ${comparator} ${formatMetricValue(metric, bound)} to recover)`;
  const target = `${formatMetricValue(metric, threshold.good)} / ${formatMetricValue(metric, threshold.warn)} warn`;
  return `${METRIC_GLOSSARY[metric].label} is ${formatMetricValue(metric, value)}, ${verdict}. Targets: ${target}.`;
}

function buildHeadline(
  findings: NarrativeFinding[],
  severity: HealthLevel,
  passed: number,
  total: number,
): string {
  const passFinding = findings.find((finding) => finding.metric === "passRate");
  const rankFindings = findings.filter((finding) =>
    (["pathRecallAt1", "pathRecallAt5", "mrr"] as HealthMetric[]).includes(
      finding.metric,
    ),
  );
  const safetyFindings = findings.filter((finding) =>
    (["noResultAccuracy", "forbiddenPathAccuracy"] as HealthMetric[]).includes(
      finding.metric,
    ),
  );
  const latencyFinding = findings.find(
    (finding) => finding.metric === "p95LatencyMs",
  );
  const rankBad = rankFindings.some((finding) => finding.severity === "bad");
  const rankWarn = rankFindings.some((finding) => finding.severity !== "good");
  const safetyBad = safetyFindings.some(
    (finding) => finding.severity === "bad",
  );
  const passBad = passFinding?.severity === "bad";
  const latencyBad = latencyFinding?.severity === "bad";
  if (severity === "good") {
    return `Atlas retrieval is healthy: ${passed}/${total} pass and ranking signals are inside target bands.`;
  }
  if (passBad || safetyBad) {
    return `Atlas retrieval has a correctness regression: ${passed}/${total} pass${safetyBad ? ", safety gates leaked" : ""}. Triage before looking at ranking.`;
  }
  if (rankBad) {
    return `Retrieval is safe but poorly ranked: ${passed}/${total} pass, known-good evidence is missing from the top window.`;
  }
  if (latencyBad) {
    return `Retrieval is correct but slow: ${passed}/${total} pass, p95 latency is past the warn ceiling.`;
  }
  if (rankWarn) {
    return `Retrieval is passing with measurable rank headroom: ${passed}/${total} pass, ranking metrics in the warn band.`;
  }
  return `Retrieval is passing with minor warnings: ${passed}/${total} pass.`;
}

function buildVerdict(
  findings: NarrativeFinding[],
  deltas?: ReportDeltas,
): string {
  const segments: string[] = [];
  const passFinding = findings.find((finding) => finding.metric === "passRate");
  if (passFinding) {
    segments.push(`Pass gate: ${passFinding.value} (${passFinding.severity})`);
  }
  const rank = findings
    .filter((finding) =>
      (["pathRecallAt5", "mrr", "pathRecallAt1"] as HealthMetric[]).includes(
        finding.metric,
      ),
    )
    .map((finding) => `${finding.label} ${finding.value} (${finding.severity})`)
    .join(", ");
  if (rank) segments.push(`Rank: ${rank}`);
  const latency = findings.find((finding) => finding.metric === "p95LatencyMs");
  if (latency) {
    segments.push(
      `Latency: ${latency.label} ${latency.value} (${latency.severity})`,
    );
  }
  const safety = findings
    .filter((finding) =>
      (
        ["noResultAccuracy", "forbiddenPathAccuracy"] as HealthMetric[]
      ).includes(finding.metric),
    )
    .map((finding) => `${finding.label} ${finding.value} (${finding.severity})`)
    .join(", ");
  if (safety) segments.push(`Safety: ${safety}`);
  if (deltas && deltas.regressions.length > 0) {
    const top = deltas.regressions[0];
    if (top) {
      segments.push(
        `Regression vs baseline: ${top.label} moved by ${formatDeltaMagnitude(top.metric, top.delta)}`,
      );
    }
  }
  return `${segments.join(". ")}.`;
}

function attentionSeverity(result: WeakCaseSummary): HealthLevel {
  if (!result.passed) return "bad";
  if (result.bestExpectedPathRank === undefined) return "warn";
  if (result.recallAt5 < 0.5) return "bad";
  return "warn";
}

function formatDeltaMagnitude(metric: HealthMetric, delta: number): string {
  if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
    return `${delta > 0 ? "+" : ""}${Math.round(delta)}ms`;
  }
  const pct = Math.round(delta * 100);
  return `${pct > 0 ? "+" : ""}${pct}pp`;
}
