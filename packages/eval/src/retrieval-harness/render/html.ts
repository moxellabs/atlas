import {
  classifyHealth,
  HEALTH_THRESHOLDS,
  type HealthLevel,
  type HealthMetric,
} from "../health";
import { METRIC_GLOSSARY } from "../metric-glossary";
import type {
  CaseResult,
  MetricDeltaEntry,
  QualityGroupSummary,
  Report,
  ReportThresholdResult,
  WeakCaseSummary,
} from "../types";
import { renderReportCss } from "./css";
import { REPORT_DEMO_DATA } from "./demo-data";
import { renderDetailPanels } from "./detail-panels";
import { renderExplorerScript } from "./explorer-script";
import { moxelBandedFieldScript } from "./moxel-theme";

interface QualityGateRow {
  readonly status: HealthLevel;
  readonly passed: boolean;
  readonly layer: string;
  readonly metric: string;
  readonly actual: string;
  readonly required: string;
  readonly delta: string;
  readonly type: string;
  readonly demo?: boolean;
}

interface FailureMode {
  readonly label: string;
  readonly count: number;
  readonly rate: number;
}

const NAV_ITEMS = [
  ["overview", "Overview"],
  ["quality-gates", "Quality Gates"],
  ["cross-layer-summary", "Cross-Layer Summary"],
  ["retrieval", "Retrieval"],
  ["answer-quality", "Answer Quality"],
  ["mcp-agent", "MCP Agent"],
  ["failure-analysis", "Failure Analysis"],
  ["case-explorer", "Case Explorer"],
  ["coverage-analysis", "Coverage Analysis"],
  ["trends-baselines", "Trends & Baselines"],
  ["methodology", "Methodology"],
  ["reproducibility", "Reproducibility"],
] as const;

export function renderHtml(report: Report): string {
  return `<!doctype html>
<html lang="en" data-severity="${escapeHtml(report.narrative.severity)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>MOXEL ATLAS EVALS — ${escapeHtml(report.dataset)}</title>
<style>${renderReportCss()}</style>
</head>
<body class="moxel-eval-body" data-severity="${escapeHtml(report.narrative.severity)}">
<canvas id="banded-field" aria-hidden="true"></canvas>
<div class="noise" aria-hidden="true"></div>
<div class="report-app" data-report-shell="moxel-atlas-eval-report-theme">
${renderSidebar()}
<main class="report-main">
<section class="tab-panel" id="overview" data-report-tab="overview">
${renderOverview(report)}
${renderQualityGates(report, "overview-quality-gates")}
${renderCrossLayerSummary("overview-cross-layer-summary")}
${renderFailureAnalysis(report, "overview-failure-analysis")}
${renderRetrievalPerformance(report, "overview-retrieval")}
${renderAnswerQuality("overview-answer-quality")}
</section>
<section class="tab-panel" id="quality-gates" data-report-tab="quality-gates" hidden>
${renderStandaloneHeader("Quality Gates", "All required and advisory thresholds, baseline deltas, and gate provenance.")}
${renderQualityGates(report, "quality-gates-detail")}
</section>
<section class="tab-panel" id="cross-layer-summary" data-report-tab="cross-layer-summary" hidden>
${renderStandaloneHeader("Cross-Layer Summary", "How retrieval quality and answer faithfulness combine across the complete evaluation pipeline.", true)}
${renderCrossLayerSummary("cross-layer-detail")}
</section>
<section class="tab-panel" id="retrieval" data-report-tab="retrieval" hidden>
${renderStandaloneHeader("Retrieval", "Rank quality, recall, latency, safety boundaries, and retrieval coverage.")}
${renderRetrievalPerformance(report, "retrieval-detail")}
</section>
${renderDetailPanels(report)}
${renderExplorer(report)}
${renderCoverageAnalysis(report)}
</main>
</div>
<div id="info-popover" class="info-popover" role="dialog" aria-modal="false" aria-live="polite" hidden></div>
<script id="atlas-eval-report-data" type="application/json">${safeJson(reportClientData(report))}</script>
<script>${moxelBandedFieldScript}</script>
<script>${renderExplorerScript()}</script>
</body>
</html>`;
}

function renderSidebar(): string {
  return `<aside class="report-sidebar"><div class="sidebar-brand" aria-label="Moxel">moxel</div><div class="sidebar-label">Atlas evaluation report</div><nav class="report-nav" aria-label="Evaluation report sections">${NAV_ITEMS.map(
    ([id, label], index) =>
      `<a href="#${id}"${index === 0 ? ' aria-current="location"' : ""}><span class="nav-mark" aria-hidden="true"></span>${label}</a>`,
  ).join(
    "",
  )}</nav><footer class="sidebar-footer">Generated with Atlas<br /><a href="https://moxel.dev/atlas">moxel.dev/atlas</a></footer></aside>`;
}

function renderOverview(report: Report): string {
  const revision = report.runtime.repoRevision?.slice(0, 7);
  const runId = revision ?? REPORT_DEMO_DATA.runId;
  const runIdDemo = revision === undefined;
  const severity = report.narrative.severity;
  const gateLabel =
    severity === "bad"
      ? "GATED FAIL"
      : severity === "warn"
        ? "GATED WARN"
        : "GATED PASS";
  const statusLabel =
    severity === "bad"
      ? "Needs work"
      : severity === "warn"
        ? "Review advised"
        : "Ready";
  return `<div class="overview-header">
<div class="report-heading"><div><div class="eyebrow">Atlas evaluation report</div><h1>${escapeHtml(report.dataset)} <span aria-hidden="true">·</span> Full Evaluation</h1><p class="report-subtitle">Comprehensive retrieval report with answer-quality and MCP previews clearly marked as demo data.</p></div><div class="gate-badge" data-health="${severity}"><strong>${gateLabel}</strong><span>${statusLabel}</span></div></div>
<div class="metadata-row" aria-label="Run metadata">${renderMetadataChip("Run ID", runId, runIdDemo)}${renderMetadataChip("Dataset", report.dataset)}${renderMetadataChip("Cases", String(report.totalCases))}${renderMetadataChip("Generated", formatTimestamp(report.generatedAt))}${renderMetadataChip("Duration", REPORT_DEMO_DATA.duration, true)}</div>
${renderPrimaryAlert(report)}
${renderExecutiveSummary(report)}
</div>`;
}

function renderMetadataChip(
  label: string,
  value: string,
  demo = false,
): string {
  return `<span class="metadata-chip"><span class="metadata-icon" aria-hidden="true"></span><span class="sr-only">${escapeHtml(label)}: </span>${escapeHtml(value)}${demo ? renderDemoBadge() : ""}</span>`;
}

function renderPrimaryAlert(report: Report): string {
  const severity = report.narrative.severity;
  const primary =
    report.narrative.keyFindings.find(
      (finding) => finding.severity === severity,
    ) ?? report.narrative.keyFindings[0];
  const blockerLabel = primary?.label ?? "Deterministic pass rate";
  const blockerValue =
    primary?.value ?? `${report.passedCases}/${report.totalCases}`;
  const threshold = primary
    ? METRIC_GLOSSARY[primary.metric].targets
    : "All deterministic expectations";
  return `<article class="primary-alert" data-health="${severity}"><div class="alert-copy"><span class="alert-icon" aria-hidden="true">${statusGlyph(severity)}</span><div><h2>${escapeHtml(report.narrative.headline)}</h2><p>${escapeHtml(report.narrative.verdict)}</p></div></div><div class="primary-blocker"><span>Primary signal</span><strong>${escapeHtml(blockerLabel)}</strong><div><b>${escapeHtml(blockerValue)}</b><small>${escapeHtml(threshold)}</small></div></div></article>`;
}

function renderExecutiveSummary(report: Report): string {
  const passDelta = deltaFor(report, "passRate");
  const cards = [
    {
      label: "Overall Score",
      value: REPORT_DEMO_DATA.overall.score.toFixed(1),
      delta: `${signedNumber(REPORT_DEMO_DATA.overall.delta)} vs baseline`,
      status: report.narrative.severity,
      demo: true,
    },
    {
      label: "Retrieval Pass Rate",
      value: percent(report.metrics.passRate, 1),
      delta: passDelta
        ? `${formatDeltaMagnitude(passDelta)} vs baseline`
        : "No baseline",
      status: classifyHealth("passRate", report.metrics.passRate),
    },
    {
      label: "Answer Faithfulness",
      value: percent(REPORT_DEMO_DATA.answer.faithfulness, 1),
      delta: `${signedPercentagePoints(REPORT_DEMO_DATA.answer.faithfulnessDelta)} vs baseline`,
      status: "bad" as const,
      demo: true,
    },
    {
      label: "MCP Agent Pass Rate",
      value: percent(REPORT_DEMO_DATA.mcp.passRate, 1),
      delta: `${signedPercentagePoints(REPORT_DEMO_DATA.mcp.passRateDelta)} vs baseline`,
      status: "warn" as const,
      demo: true,
    },
    {
      label: "Safety Score",
      value: percent(REPORT_DEMO_DATA.safetyScore),
      delta: "No change",
      status: "good" as const,
      demo: true,
    },
  ];
  return `<div class="section-title compact"><div><h2>Executive Summary</h2></div></div><div class="summary-grid" aria-label="Executive summary">${cards
    .map(
      (card) =>
        `<article class="summary-card" data-health="${card.status}"${card.demo ? ' data-source="demo"' : ""}><div class="summary-label"><span class="metric-icon" aria-hidden="true"></span>${card.label}${card.demo ? renderDemoBadge() : ""}</div><strong>${card.value}</strong><span class="summary-delta">${card.delta}</span><span class="status-tag" data-health="${card.status}">${healthLabel(card.status)}</span></article>`,
    )
    .join("")}</div>`;
}

function renderQualityGates(report: Report, id: string): string {
  const rows = qualityGateRows(report);
  const passed = rows.filter((row) => row.passed).length;
  const demoCount = rows.filter((row) => row.demo).length;
  return `<section class="report-section" id="${id}">${renderSectionHeader("Quality Gates", "Required and advisory thresholds across evaluation layers.", `${passed} / ${rows.length} passed · ${demoCount} demo`)}<div class="data-card table-card"><div class="table-wrap"><table class="gates-table"><thead><tr><th scope="col">Status</th><th scope="col">Layer</th><th scope="col">Metric</th><th scope="col">Actual</th><th scope="col">Required</th><th scope="col">Delta vs Baseline</th><th scope="col">Type</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr${row.demo ? ' data-source="demo"' : ""}><td><span class="table-status" data-health="${row.status}" aria-label="${healthLabel(row.status)}">${statusGlyph(row.status)}</span></td><td>${escapeHtml(row.layer)}</td><td>${escapeHtml(row.metric)}${row.demo ? renderDemoBadge() : ""}</td><td class="numeric">${escapeHtml(row.actual)}</td><td class="numeric muted-cell">${escapeHtml(row.required)}</td><td class="numeric" data-health="${row.status}">${escapeHtml(row.delta)}</td><td>${escapeHtml(row.type)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div class="card-footer">Live rows come from this report. Demo rows preserve the reference layout until those eval layers exist.</div></div></section>`;
}

function qualityGateRows(report: Report): QualityGateRow[] {
  const actualRows = (
    report.thresholds?.results ?? defaultQualityGates(report)
  ).map((gate): QualityGateRow => {
    const metric = gate.metric as HealthMetric;
    const delta = deltaFor(report, metric);
    return {
      status: gate.passed ? classifyHealth(metric, gate.actual) : "bad",
      passed: gate.passed,
      layer: "Retrieval",
      metric: gate.label,
      actual: formatMetric(metric, gate.actual),
      required: `${gate.direction === "higher" ? "≥" : "≤"} ${formatMetric(metric, gate.limit)}`,
      delta: delta ? formatDeltaMagnitude(delta) : "—",
      type: "Required",
    };
  });
  return [
    ...actualRows,
    {
      status: "bad",
      passed: false,
      layer: "Answer",
      metric: "Faithfulness",
      actual: percent(REPORT_DEMO_DATA.answer.faithfulness, 1),
      required: "≥ 90.0%",
      delta: signedPercentagePoints(REPORT_DEMO_DATA.answer.faithfulnessDelta),
      type: "Demo",
      demo: true,
    },
    {
      status: "bad",
      passed: false,
      layer: "Answer",
      metric: "Unsupported claim rate",
      actual: percent(REPORT_DEMO_DATA.answer.unsupportedClaimRate, 1),
      required: "≤ 5.0%",
      delta: signedPercentagePoints(
        REPORT_DEMO_DATA.answer.unsupportedClaimDelta,
      ),
      type: "Demo",
      demo: true,
    },
    {
      status: "good",
      passed: true,
      layer: "MCP Agent",
      metric: "Protocol error rate",
      actual: percent(REPORT_DEMO_DATA.mcp.protocolErrorRate, 1),
      required: "= 0.0%",
      delta: "—",
      type: "Demo",
      demo: true,
    },
    {
      status: "warn",
      passed: true,
      layer: "Judge",
      metric: "Inter-sample agreement",
      actual: percent(REPORT_DEMO_DATA.judgeAgreement.value, 1),
      required: "≥ 80.0%",
      delta: signedPercentagePoints(REPORT_DEMO_DATA.judgeAgreement.delta),
      type: "Demo soft",
      demo: true,
    },
  ];
}

function defaultQualityGates(report: Report): ReportThresholdResult[] {
  return [
    gateResult(
      "passRate",
      "Pass rate",
      report.metrics.passRate,
      HEALTH_THRESHOLDS.passRate.good,
      "higher",
    ),
    gateResult(
      "pathRecallAt5",
      "Recall@5",
      report.metrics.pathRecallAt5,
      HEALTH_THRESHOLDS.pathRecallAt5.good,
      "higher",
    ),
    gateResult(
      "mrr",
      "MRR",
      report.metrics.mrr,
      HEALTH_THRESHOLDS.mrr.good,
      "higher",
    ),
    gateResult(
      "forbiddenPathAccuracy",
      "Forbidden path accuracy",
      report.metrics.forbiddenPathAccuracy,
      HEALTH_THRESHOLDS.forbiddenPathAccuracy.good,
      "higher",
    ),
    gateResult(
      "p95LatencyMs",
      "p95 latency",
      report.metrics.p95LatencyMs,
      HEALTH_THRESHOLDS.p95LatencyMs.good,
      "lower",
    ),
  ];
}

function gateResult(
  metric: ReportThresholdResult["metric"],
  label: string,
  actual: number,
  limit: number,
  direction: "higher" | "lower",
): ReportThresholdResult {
  return {
    metric,
    label,
    actual,
    limit,
    direction,
    passed: direction === "higher" ? actual >= limit : actual <= limit,
  };
}

function renderCrossLayerSummary(id: string): string {
  const data = REPORT_DEMO_DATA.crossLayer;
  const cells = [
    ["good", data.retrievalPassedAnswerFaithful, "Correct pipeline"],
    ["bad", data.retrievalPassedAnswerUnfaithful, "Retrieval but unfaithful"],
    ["warn", data.retrievalFailedAnswerFaithful, "Faithful to wrong evidence"],
    ["bad", data.retrievalFailedAnswerUnfaithful, "Full pipeline failure"],
  ] as const;
  const descriptions = [
    [
      "good",
      data.retrievalPassedAnswerFaithful,
      "Retrieval succeeded and answers were faithful.",
    ],
    [
      "bad",
      data.retrievalPassedAnswerUnfaithful,
      "Retrieved expected evidence but answers contained unsupported claims.",
    ],
    [
      "warn",
      data.retrievalFailedAnswerFaithful,
      "Answers were faithful but retrieval missed key evidence.",
    ],
    [
      "bad",
      data.retrievalFailedAnswerUnfaithful,
      "Both retrieval and answer generation failed.",
    ],
  ] as const;
  return `<section class="report-section" id="${id}" data-source="demo">${renderSectionHeader("Cross-Layer Pipeline Health", "How retrieval and generation performance interact.", renderDemoBadge())}<div class="cross-layer-layout"><div class="matrix-shell"><div class="matrix-column-labels"><span>Answer Faithful</span><span>Answer Unfaithful</span></div><div class="matrix-body"><div class="matrix-row-labels"><span>Retrieval Passed</span><span>Retrieval Failed</span></div><div class="pipeline-matrix">${cells.map(([health, count, label]) => `<div class="matrix-cell" data-health="${health}"><strong>${count}</strong><span>${label}</span></div>`).join("")}</div></div></div><div class="matrix-legend">${descriptions.map(([health, count, description]) => `<div class="legend-item" data-health="${health}"><span class="legend-dot" aria-hidden="true"></span><div><strong>${count} cases</strong><p>${description}</p></div></div>`).join("")}</div></div></section>`;
}

function renderFailureAnalysis(report: Report, id: string): string {
  const modes = failureModes(report);
  const maximum = Math.max(...modes.map((mode) => mode.count), 1);
  return `<section class="report-section" id="${id}">${renderSectionHeader("Top Failure Modes", "Ranked by impact and frequency; passing cases can still surface rank headroom.")}<div class="failure-chart">${modes
    .map(
      (mode, index) =>
        `<div class="failure-row"><span class="failure-label">${escapeHtml(mode.label)}</span><div class="failure-track"><span class="failure-bar tone-${(index % 5) + 1}" style="--bar-size:${Math.max(4, (mode.count / maximum) * 100).toFixed(2)}%"></span></div><span class="failure-count">${mode.count} ${mode.count === 1 ? "case" : "cases"}</span><span class="failure-rate">${percent(mode.rate, 1)}</span></div>`,
    )
    .join("")}</div></section>`;
}

function failureModes(report: Report): FailureMode[] {
  const counts = new Map<string, number>();
  for (const item of report.quality.weakestCases) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  const modes = [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      rate: report.totalCases === 0 ? 0 : count / report.totalCases,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    )
    .slice(0, 5);
  return modes.length > 0
    ? modes
    : [{ label: "No failure modes detected", count: 0, rate: 0 }];
}

function renderRetrievalPerformance(report: Report, id: string): string {
  const metrics: Array<[string, string, HealthMetric]> = [
    ["Pass Rate", percent(report.metrics.passRate, 1), "passRate"],
    ["Recall@5", report.metrics.pathRecallAt5.toFixed(2), "pathRecallAt5"],
    ["MRR", report.metrics.mrr.toFixed(2), "mrr"],
    [
      "Forbidden Path Accuracy",
      percent(report.metrics.forbiddenPathAccuracy, 1),
      "forbiddenPathAccuracy",
    ],
    [
      "p95 Latency",
      `${Math.round(report.metrics.p95LatencyMs)}ms`,
      "p95LatencyMs",
    ],
  ];
  return `<section class="report-section" id="${id}">${renderSectionHeader("Retrieval Performance", "High-level retrieval effectiveness metrics.")}<div class="split-grid retrieval-grid"><article class="data-card metric-list">${metrics
    .map(([label, value, metric]) => {
      const delta = deltaFor(report, metric);
      return `<div class="metric-row"><span>${label}${renderInfoButton(metric)}</span><strong>${value}</strong><small data-health="${delta?.severity ?? "good"}">${delta ? formatDeltaMagnitude(delta) : "—"}</small></div>`;
    })
    .join(
      "",
    )}</article><article class="data-card chart-card" data-eval-chart="recall-funnel"><h3>Recall@K</h3>${renderRecallChart(report)}</article></div></section>`;
}

function renderRecallChart(report: Report): string {
  const current: ReadonlyArray<readonly [string, number, boolean]> = [
    ["1", report.metrics.pathRecallAt1, false],
    ["5", report.metrics.pathRecallAt5, false],
    ["10", REPORT_DEMO_DATA.retrieval.recallAt10, true],
    ["20", REPORT_DEMO_DATA.retrieval.recallAt20, true],
    ["50", REPORT_DEMO_DATA.retrieval.recallAt50, true],
  ];
  const baseline: ReadonlyArray<readonly [string, number, boolean]> = [
    [
      "1",
      deltaFor(report, "pathRecallAt1")?.baseline ??
        report.metrics.pathRecallAt1,
      false,
    ],
    [
      "5",
      deltaFor(report, "pathRecallAt5")?.baseline ??
        report.metrics.pathRecallAt5,
      false,
    ],
    ["10", REPORT_DEMO_DATA.retrieval.baselineAt10, true],
    ["20", REPORT_DEMO_DATA.retrieval.baselineAt20, true],
    ["50", REPORT_DEMO_DATA.retrieval.baselineAt50, true],
  ];
  const point = (index: number, value: number): [number, number] => [
    64 + index * 102,
    28 + (1 - Math.max(0, Math.min(1, value))) * 168,
  ];
  const pathFor = (
    values: ReadonlyArray<readonly [string, number, boolean]>,
  ): string =>
    values
      .map(
        ([, value], index) =>
          `${index === 0 ? "M" : "L"}${point(index, value).join(" ")}`,
      )
      .join(" ");
  return `<div class="line-chart"><svg viewBox="0 0 540 240" role="img" aria-label="Recall at ranks one, five, ten, twenty, and fifty compared with baseline; ranks above five are demo projections"><g class="chart-gridlines">${[
    0, 0.25, 0.5, 0.75, 1,
  ]
    .map((value) => {
      const y = 28 + (1 - value) * 168;
      return `<line x1="52" y1="${y}" x2="488" y2="${y}"/><text x="8" y="${y + 4}">${value.toFixed(2)}</text>`;
    })
    .join(
      "",
    )}</g><path class="baseline-line" d="${pathFor(baseline)}"/>${baseline
    .map(([, value, demo], index) => {
      const [x, y] = point(index, value);
      return `<circle class="baseline-point" ${demo ? 'data-source="demo"' : ""} cx="${x}" cy="${y}" r="4"/>`;
    })
    .join("")}<path class="current-line" d="${pathFor(current)}"/>${current
    .map(([label, value, demo], index) => {
      const [x, y] = point(index, value);
      return `<circle class="current-point" ${demo ? 'data-source="demo"' : ""} cx="${x}" cy="${y}" r="5"/><text class="axis-label" x="${x}" y="222">${label}</text>`;
    })
    .join(
      "",
    )}</svg><div class="chart-legend"><span><i class="legend-swatch current"></i>This run</span><span><i class="legend-swatch baseline"></i>Baseline</span><span>${renderDemoBadge()} after K=5</span></div></div>`;
}

function renderAnswerQuality(id: string): string {
  const answer = REPORT_DEMO_DATA.answer;
  return `<section class="report-section" id="${id}" data-source="demo">${renderSectionHeader("Answer Quality", "Claim-level faithfulness and hallucination analysis.", renderDemoBadge())}<div class="split-grid answer-grid"><article class="data-card donut-card"><h3>Claim Disposition</h3><div class="donut-layout">${renderDispositionDonut()}<div class="donut-legend">${answer.claimDisposition.map((item) => `<div><span><i data-health="${item.health}"></i>${item.label}</span><strong>${percent(item.value, 1)}</strong></div>`).join("")}</div></div></article><article class="data-card taxonomy-card"><h3>Hallucination Taxonomy (Top)</h3>${answer.hallucinationTaxonomy.map((item) => `<div><span>${item.label}</span><strong>${item.count}</strong></div>`).join("")}</article></div></section>`;
}

function renderDispositionDonut(): string {
  let offset = 0;
  const segments = REPORT_DEMO_DATA.answer.claimDisposition
    .map((item) => {
      const amount = item.value * 100;
      const segment = `<circle data-health="${item.health}" cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="${amount} ${100 - amount}" stroke-dashoffset="${-offset}"/>`;
      offset += amount;
      return segment;
    })
    .join("");
  return `<svg class="donut-chart" viewBox="0 0 120 120" role="img" aria-label="Demo claim disposition chart"><circle class="donut-track" cx="60" cy="60" r="44"/>${segments}<text x="60" y="57">DEMO</text><text class="donut-total" x="60" y="72">100%</text></svg>`;
}

function renderExplorer(report: Report): string {
  const categories = optionList(
    unique(report.cases.map((testCase) => testCase.category)),
  );
  const profiles = optionList(
    unique(report.cases.map((testCase) => testCase.profile ?? "unknown")),
  );
  const risks = optionList(
    unique(report.cases.map((testCase) => testCase.riskArea ?? "unknown")),
  );
  const selected = report.cases[0];
  return `<section class="tab-panel" id="case-explorer" data-report-tab="case-explorer" hidden>${renderStandaloneHeader("Case Explorer", "Inspect individual queries, layer outcomes, retrieved evidence, and failure diagnosis.")}<div class="case-workspace"><aside class="data-card case-browser"><div class="case-browser-controls" role="search"><div class="control search-control"><label for="case-search">Search cases</label><input id="case-search" type="search" placeholder="Query, path, profile, or case ID" /></div><div class="case-filter-row"><div class="control"><label for="filter-category">Category</label><select id="filter-category"><option value="">All</option>${categories}</select></div><div class="control"><label for="filter-profile">Profile</label><select id="filter-profile"><option value="">All</option>${profiles}</select></div></div><div class="case-filter-row"><div class="control"><label for="filter-risk">Risk</label><select id="filter-risk"><option value="">All</option>${risks}</select></div><div class="control"><label for="case-sort">Sort</label><select id="case-sort"><option value="weakest">Weakest rank</option><option value="recallAt5">Recall@5</option><option value="mrr">MRR</option><option value="latency">Latency</option><option value="ranked">Ranked hits</option><option value="id">Case ID</option></select></div></div><button id="clear-filters" type="button">Clear filters</button></div><div class="case-browser-summary"><span><strong id="visible-count">${report.cases.length}</strong> / ${report.cases.length} cases</span><span>Page 1</span></div><div id="empty-state" class="empty">No cases match these filters. <button type="button" data-clear-filters>Clear filters</button></div><div id="case-list" class="case-list compact-list">${report.cases.map((testCase, index) => renderCaseCard(testCase, index === 0)).join("")}</div><div class="case-pagination"><button type="button" disabled>Previous</button><span>1 of 1</span><button type="button" disabled>Next</button></div></aside><article class="data-card case-inspector">${selected ? renderSelectedCase(selected) : `<div class="case-detail-empty"><strong>No cases in this dataset.</strong><p>Add a case to the dataset and regenerate the report.</p></div>`}</article></div></section>`;
}

function optionList(values: string[]): string {
  return values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    )
    .join("");
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function renderCaseCard(testCase: CaseResult, selected: boolean): string {
  const health = caseHealth(testCase);
  const status = !testCase.passed
    ? "fail"
    : testCase.retrieval.recallAt5 < 1
      ? "rank headroom"
      : "pass";
  return `<button type="button" class="case-card compact-case${selected ? " selected" : ""}" data-case-card data-case-select="${escapeHtml(testCase.id)}" data-health="${health}" data-id="${escapeHtml(testCase.id)}" data-category="${escapeHtml(testCase.category)}" data-profile="${escapeHtml(testCase.profile ?? "unknown")}" data-risk="${escapeHtml(testCase.riskArea ?? "unknown")}" data-recall="${testCase.retrieval.recallAt5}" data-mrr="${testCase.retrieval.reciprocalRank}" data-latency="${testCase.latencyMs}" data-ranked="${testCase.rankedCount}" data-search="${escapeHtml(caseSearchText(testCase))}"><span class="compact-case-head"><strong>${escapeHtml(testCase.id)}</strong><span class="table-pill ${health}">${escapeHtml(status)}</span></span><span class="compact-case-title">${escapeHtml(caseSummary(testCase))}</span><span class="compact-case-metrics"><span>R@5 ${percent(testCase.retrieval.recallAt5)}</span><span>MRR ${testCase.retrieval.reciprocalRank.toFixed(2)}</span><span>${testCase.latencyMs}ms</span></span></button>`;
}

function renderSelectedCase(testCase: CaseResult): string {
  const health = caseHealth(testCase);
  const diagnosis = testCase.passed
    ? testCase.retrieval.recallAt5 < 1
      ? "Deterministic expectations passed, but known-good evidence has ranking headroom."
      : "The case passed deterministic retrieval expectations with strong evidence placement."
    : "One or more deterministic expectations failed. Inspect missing fields and diagnostics in the machine-readable report.";
  const evidenceRows = testCase.topPaths
    .slice(0, 6)
    .map((path, index) => {
      const relevance = Math.max(18, 96 - index * 13);
      return `<tr><td>${index + 1}</td><td><code>${escapeHtml(path)}</code></td><td><div class="relevance-meter"><i style="--relevance:${relevance}%"></i><span>${relevance}%</span></div></td></tr>`;
    })
    .join("");
  return `<div class="case-inspector-header"><div><span class="card-eyebrow">Selected case</span><h2 id="case-detail-id">${escapeHtml(testCase.id)}</h2><p id="case-detail-category">${escapeHtml(testCase.category)} · ${escapeHtml(testCase.profile ?? "unknown")}</p></div><span id="case-detail-status" class="table-pill ${health}">${testCase.passed ? "Pass" : "Fail"}</span></div><div class="case-detail-tabs" role="tablist" aria-label="Case details"><button type="button" role="tab" aria-selected="true">Overview</button><button type="button" role="tab" aria-selected="false">Retrieval</button><button type="button" role="tab" aria-selected="false">Diagnostics</button><button type="button" role="tab" aria-selected="false">Metadata</button></div><div class="case-detail-body"><section class="case-copy-block"><span>Query</span><p id="case-detail-query">${escapeHtml(testCase.query)}</p></section><section class="case-copy-block"><span>Expected behavior</span><p id="case-detail-expected">${escapeHtml(testCase.expectedBehavior ?? "Required paths and terms present; forbidden paths absent; no-result behavior correct when expected.")}</p></section><section class="case-copy-block"><span>Claim</span><p id="case-detail-claim">${escapeHtml(testCase.claim ?? "No answer-level claim is attached to this retrieval case.")}</p></section><section class="case-detail-section"><div class="case-section-heading"><span>Evaluation layers</span><h3>Layer Results</h3></div><div class="case-layer-grid"><article><span>Deterministic</span><strong id="case-detail-pass">${testCase.passed ? "Passed" : "Failed"}</strong></article><article><span>Recall@5</span><strong id="case-detail-recall">${percent(testCase.retrieval.recallAt5)}</strong></article><article><span>MRR</span><strong id="case-detail-mrr">${testCase.retrieval.reciprocalRank.toFixed(2)}</strong></article><article><span>Latency</span><strong id="case-detail-latency">${testCase.latencyMs}ms</strong></article></div></section><section class="case-evidence-section"><div class="card-heading"><div><span class="card-eyebrow">Retrieval evidence</span><h3>Ranked Sources</h3></div><span>${testCase.topPaths.length} paths</span></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Path</th><th>Relevance</th></tr></thead><tbody id="case-detail-evidence">${evidenceRows}</tbody></table></div></section><section class="case-detail-section"><div class="case-section-heading"><span>Case outcome</span><h3>Summary</h3></div><div class="diagnosis-box"><strong>Diagnosis</strong><p id="case-detail-diagnosis">${escapeHtml(diagnosis)}</p></div><dl class="case-metadata-grid"><div><dt>Risk area</dt><dd id="case-detail-risk">${escapeHtml(testCase.riskArea ?? "unknown")}</dd></div><div><dt>Feature</dt><dd id="case-detail-feature">${escapeHtml(testCase.feature ?? "unknown")}</dd></div><div><dt>Priority</dt><dd id="case-detail-priority">${escapeHtml(testCase.priority ?? "unknown")}</dd></div><div><dt>Ranked hits</dt><dd id="case-detail-ranked">${testCase.rankedCount}</dd></div></dl></section></div>`;
}
function renderCoverageAnalysis(report: Report): string {
  return `<section class="tab-panel" id="coverage-analysis" data-report-tab="coverage-analysis" hidden>${renderStandaloneHeader("Coverage Analysis", "Capability distribution, risk coverage, and the cases with the most retrieval headroom.")}<div class="report-section coverage-detail"><div class="data-card coverage-card" data-eval-chart="coverage-heatmap"><div class="coverage-toolbar"><h2 id="quality-title">Quality by capability</h2><select id="quality-group" aria-label="Change coverage heatmap group"><option value="byCapability">Capability</option><option value="byRiskArea">Risk area</option><option value="byProfile">Profile</option><option value="byCategory">Category</option><option value="byPriority">Priority</option><option value="byCoverageType">Coverage type</option></select></div><div id="quality-heatmap" class="heatmap">${renderHeatmap(report.quality.byCapability)}</div></div><div class="data-card worklist-card"><h2>Ranking worklist</h2><p class="muted">Cases below passed deterministic gates but known-good evidence was missing from the top five, not ranked first, or slow.</p><div class="worklist">${report.quality.weakestCases.map(renderWorklistCard).join("")}</div></div></div></section>`;
}

function renderHeatmap(group: Record<string, QualityGroupSummary>): string {
  return Object.entries(group)
    .map(([name, value]) => {
      const health = heatmapHealth(value);
      return `<article class="heat" data-health="${health}"><strong>${escapeHtml(name)}</strong><span>${value.passed}/${value.total} pass</span><small>R@5 ${percent(value.recallAt5)} · MRR ${value.mrr.toFixed(2)} · p95 ${Math.round(value.p95LatencyMs)}ms</small><div class="pillrow">${value.weakestCases.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("")}</div></article>`;
    })
    .join("");
}

function heatmapHealth(value: QualityGroupSummary): HealthLevel {
  const levels = [
    classifyHealth("pathRecallAt5", value.recallAt5),
    classifyHealth("mrr", value.mrr),
    classifyHealth("passRate", value.passRate),
  ];
  return levels.includes("bad")
    ? "bad"
    : levels.includes("warn")
      ? "warn"
      : "good";
}

function renderWorklistCard(item: WeakCaseSummary): string {
  const health: HealthLevel =
    !item.passed ||
    item.recallAt5 < 0.5 ||
    item.bestExpectedPathRank === undefined
      ? "bad"
      : "warn";
  return `<article class="worklist-row" data-health="${health}"><div><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.category)}</span></div><p>${escapeHtml(item.reason)}</p><span class="numeric">R@5 ${percent(item.recallAt5)} · MRR ${item.mrr.toFixed(2)} · ${item.latencyMs}ms</span></article>`;
}

function renderStandaloneHeader(
  title: string,
  description: string,
  demo = false,
): string {
  return `<header class="tab-page-header"><div><span class="eyebrow">Atlas evaluation report</span><h1>${title}</h1><p>${description}</p></div>${demo ? renderDemoBadge() : ""}</header>`;
}

function renderSectionHeader(
  title: string,
  description: string,
  aside = "",
): string {
  return `<div class="section-title"><div><h2>${title}</h2><p>${description}</p></div>${aside ? `<div class="section-aside">${aside}</div>` : ""}</div>`;
}

function renderInfoButton(metric: HealthMetric): string {
  return `<button type="button" class="info-btn" data-info-metric="${metric}" aria-label="What is ${escapeHtml(METRIC_GLOSSARY[metric].label)}?">i</button>`;
}

function renderDemoBadge(): string {
  return `<span class="demo-badge">Demo data</span>`;
}

function statusGlyph(level: HealthLevel): string {
  if (level === "good") return "✓";
  if (level === "warn") return "!";
  return "×";
}

function healthLabel(level: HealthLevel | "neutral"): string {
  if (level === "good") return "Pass";
  if (level === "warn") return "Warn";
  if (level === "bad") return "Fail";
  return "Neutral";
}

function caseHealth(testCase: CaseResult): HealthLevel {
  if (!testCase.passed || testCase.retrieval.recallAt5 < 0.5) return "bad";
  if (
    testCase.retrieval.recallAt5 < 1 ||
    (testCase.retrieval.bestExpectedPathRank ?? 1) > 3
  )
    return "warn";
  return "good";
}

function caseSummary(testCase: CaseResult): string {
  if (testCase.expectedBehavior) return testCase.expectedBehavior;
  if (testCase.claim) return testCase.claim;
  return `Query: ${testCase.query}`;
}

function caseSearchText(testCase: CaseResult): string {
  return [
    testCase.id,
    testCase.category,
    testCase.profile,
    testCase.feature,
    testCase.riskArea,
    testCase.priority,
    testCase.coverageType,
    testCase.claim,
    testCase.whyItMatters,
    testCase.expectedBehavior,
    testCase.query,
    ...testCase.topPaths,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function deltaFor(
  report: Report,
  metric: HealthMetric,
): MetricDeltaEntry | undefined {
  return report.deltas?.entries.find((entry) => entry.metric === metric);
}

function formatDeltaMagnitude(delta: MetricDeltaEntry): string {
  const sign = delta.delta > 0 ? "+" : "";
  if (delta.metric === "p95LatencyMs" || delta.metric === "averageLatencyMs") {
    return `${sign}${Math.round(delta.delta)}ms`;
  }
  if (delta.metric === "mrr") return `${sign}${delta.delta.toFixed(2)}`;
  return `${sign}${(delta.delta * 100).toFixed(1)}pp`;
}

function signedPercentagePoints(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}

function signedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatMetric(metric: HealthMetric, value: number): string {
  if (metric === "p95LatencyMs" || metric === "averageLatencyMs")
    return `${Math.round(value)}ms`;
  if (metric === "mrr") return value.toFixed(2);
  return percent(value, 1);
}

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} ${parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function reportClientData(report: Report): unknown {
  return {
    quality: report.quality,
    narrative: report.narrative,
    glossary: METRIC_GLOSSARY,
    thresholds: HEALTH_THRESHOLDS,
    metrics: report.metrics,
    ...(report.deltas === undefined ? {} : { deltas: report.deltas }),
    cases: report.cases.map((testCase) => ({
      id: testCase.id,
      category: testCase.category,
      profile: testCase.profile ?? "unknown",
      feature: testCase.feature ?? "unknown",
      riskArea: testCase.riskArea ?? "unknown",
      priority: testCase.priority ?? "unknown",
      passed: testCase.passed,
      query: testCase.query,
      claim: testCase.claim,
      expectedBehavior: testCase.expectedBehavior,
      scores: testCase.scores,
      retrieval: testCase.retrieval,
      missing: testCase.missing,
      topPaths: testCase.topPaths.slice(0, 12),
      latencyMs: testCase.latencyMs,
      cliLatencyMs: testCase.cliLatencyMs,
      rankedCount: testCase.rankedCount,
    })),
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
