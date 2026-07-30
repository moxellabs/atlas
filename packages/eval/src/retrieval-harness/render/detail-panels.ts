import type { Report } from "../types";
import { REPORT_DEMO_DATA } from "./demo-data";

type ChartTone = "good" | "warn" | "bad" | "neutral" | "muted";

interface ChartSeries {
  readonly label: string;
  readonly health: ChartTone;
  readonly values: readonly number[];
}

export function renderDetailPanels(report: Report): string {
  return [
    renderAnswerQualityPanel(),
    renderMcpAgentPanel(),
    renderFailureAnalysisPanel(),
    renderTrendsPanel(),
    renderMethodologyPanel(report),
    renderReproducibilityPanel(report),
  ].join("");
}

function renderAnswerQualityPanel(): string {
  const answer = REPORT_DEMO_DATA.answer;
  const cards = [
    [
      "Answer faithfulness",
      percent(answer.faithfulness, 1),
      "-5.7pp vs baseline",
      "bad",
    ],
    [
      "Supported claims",
      percent(answer.claimDisposition[0].value, 1),
      `${answer.claimDisposition[0].count} claims`,
      "good",
    ],
    [
      "Unsupported claims",
      percent(answer.unsupportedClaimRate, 1),
      "+3.1pp vs baseline",
      "bad",
    ],
    [
      "Citation coverage",
      percent(answer.citationCoverage, 1),
      "1,141 cited claims",
      "good",
    ],
    [
      "Answer completeness",
      percent(answer.answerCompleteness, 1),
      "+0.8pp vs baseline",
      "good",
    ],
    [
      "Average claims",
      answer.averageClaimsPerAnswer.toFixed(1),
      `${answer.totalClaims.toLocaleString("en-US")} total claims`,
      "neutral",
    ],
  ] as const;
  return `<section class="tab-panel" id="answer-quality" data-report-tab="answer-quality" data-source="demo" hidden>${renderTabHeader("Answer Quality", "Claim-level faithfulness, evidence support, hallucination patterns, and abstention behavior.", "Answer evaluation")}<div class="tab-kpi-grid six">${cards.map(([label, value, note, health]) => renderMetricCard(label, value, note, health, true)).join("")}</div><div class="detail-grid two-up"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Disposition</span><h2>Claim Disposition</h2></div>${demoBadge()}</div><div class="donut-detail">${renderDonut(answer.claimDisposition, String(answer.totalClaims), "claims")}<div class="donut-detail-legend">${answer.claimDisposition.map((item) => `<div><span><i data-health="${item.health}"></i>${item.label}</span><strong>${item.count.toLocaleString("en-US")}</strong><small>${percent(item.value, 1)}</small></div>`).join("")}</div></div></article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Taxonomy</span><h2>Hallucination Taxonomy</h2></div>${demoBadge()}</div><div class="taxonomy-bars">${answer.hallucinationTaxonomy.map((item) => `<div class="taxonomy-bar-row"><span>${item.label}</span><div class="micro-track"><i style="--micro-size:${item.rate * 100}%"></i></div><strong>${item.count}</strong><small>${percent(item.rate)}</small></div>`).join("")}</div></article></div><article class="data-card detail-card wide-chart-card"><div class="card-heading"><div><span class="card-eyebrow">Seven-run trend</span><h2>Claim Disposition Over Time</h2></div>${demoBadge()}</div>${renderLineChart(answer.history.labels, answer.history.series, 0, 1)}</article><div class="detail-grid abstention-grid"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Abstention</span><h2>Abstention Quality</h2></div>${demoBadge()}</div><div class="donut-detail compact">${renderDonut(answer.abstentionDisposition, percent(answer.abstentionRate, 1), "abstention rate")}<div class="donut-detail-legend">${answer.abstentionDisposition.map((item) => `<div><span><i data-health="${item.health}"></i>${item.label}</span><strong>${percent(item.value, 1)}</strong></div>`).join("")}</div></div></article><article class="data-card detail-card evidence-card"><div class="card-heading"><div><span class="card-eyebrow">Evidence audit</span><h2>Claim-Level Evidence</h2></div>${demoBadge()}</div><div class="table-wrap"><table class="evidence-table"><thead><tr><th>Case</th><th>Claim</th><th>Evidence</th><th>Disposition</th><th>Score</th></tr></thead><tbody>${answer.evidenceRows.map((row) => `<tr><td><code>${row.id}</code></td><td>${escapeHtml(row.claim)}</td><td>${escapeHtml(row.evidence)}</td><td><span class="table-pill" data-disposition="${row.disposition.toLowerCase()}">${row.disposition}</span></td><td><div class="score-meter"><i style="--score:${row.score * 100}%"></i><span>${row.score.toFixed(2)}</span></div></td></tr>`).join("")}</tbody></table></div></article></div></section>`;
}

function renderMcpAgentPanel(): string {
  const mcp = REPORT_DEMO_DATA.mcp;
  const cards = [
    ["Agent pass rate", percent(mcp.passRate, 1), "-1.2pp vs baseline", "warn"],
    [
      "Tool selection",
      percent(mcp.toolSelectionAccuracy, 1),
      "+1.1pp vs baseline",
      "good",
    ],
    ["Protocol errors", percent(mcp.protocolErrorRate, 1), "0 errors", "good"],
    [
      "Median trajectory",
      `${mcp.medianSteps.toFixed(1)} steps`,
      `p95 ${mcp.p95Steps} steps`,
      "neutral",
    ],
  ] as const;
  return `<section class="tab-panel" id="mcp-agent" data-report-tab="mcp-agent" data-source="demo" hidden>${renderTabHeader("MCP Agent", "Tool selection, trajectory efficiency, protocol health, and task completion.", "Agent evaluation")}<div class="tab-kpi-grid four">${cards.map(([label, value, note, health]) => renderMetricCard(label, value, note, health, true)).join("")}</div><div class="detail-grid two-up"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Outcomes</span><h2>Outcome Distribution</h2></div>${demoBadge()}</div><div class="donut-detail">${renderDonut(mcp.outcomes, "248", "agent cases")}<div class="donut-detail-legend">${mcp.outcomes.map((item) => `<div><span><i data-health="${item.health}"></i>${item.label}</span><strong>${percent(item.value, 1)}</strong></div>`).join("")}</div></div></article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Efficiency</span><h2>Trajectory Efficiency</h2></div>${demoBadge()}</div>${renderScatter(mcp.trajectoryPoints)}</article></div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Representative case</span><h2>Agent Trace</h2></div><span class="table-pill pass">Successful</span></div><div class="agent-trace">${mcp.trace.map((step, index) => `<div class="trace-step"><span class="trace-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${step.label}</strong><p>${step.detail}</p></div><span class="trace-state">${step.state}</span></div>`).join("")}</div></article><div class="case-study-grid"><article class="data-card agent-case-list"><div class="card-heading"><div><span class="card-eyebrow">Cases</span><h2>Agent Case List</h2></div>${demoBadge()}</div>${mcp.cases.map((item, index) => `<button type="button" class="agent-case-row${index === 0 ? " selected" : ""}"><span><strong>${item.id}</strong><small>${item.title}</small></span><span class="table-pill ${item.status.toLowerCase()}">${item.status}</span><span>${item.steps} steps</span></button>`).join("")}</article><article class="data-card agent-case-detail"><div class="card-heading"><div><span class="card-eyebrow">Selected case</span><h2>agent-042 · Resolve runtime surface</h2></div><strong class="case-score">0.97</strong></div><dl class="agent-detail-grid"><div><dt>Expected tool</dt><dd>atlas_find_scopes</dd></div><div><dt>Selected tool</dt><dd>atlas_find_scopes</dd></div><div><dt>Tool calls</dt><dd>4</dd></div><div><dt>Protocol errors</dt><dd>0</dd></div><div><dt>Final answer</dt><dd>Faithful</dd></div><div><dt>Completion</dt><dd>1.8s</dd></div></dl><div class="diagnosis-box"><strong>Diagnosis</strong><p>Direct scope resolution, one retrieval pass, and grounded synthesis. No redundant tool calls.</p></div></article></div><div class="detail-grid two-up"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Capability risk</span><h2>Capability-Risk Matrix</h2></div>${demoBadge()}</div>${renderRiskHeatmap(mcp.riskHeatmap)}</article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Domain performance</span><h2>Success by Domain</h2></div>${demoBadge()}</div><div class="table-wrap"><table><thead><tr><th>Domain</th><th>Cases</th><th>Success</th><th>Delta</th></tr></thead><tbody>${mcp.domains.map((row) => `<tr><td>${row.label}</td><td>${row.cases}</td><td>${percent(row.success, 1)}</td><td data-trend="${row.delta >= 0 ? "good" : "bad"}">${signedPoints(row.delta)}</td></tr>`).join("")}</tbody></table></div></article></div><article class="data-card detail-card wide-chart-card"><div class="card-heading"><div><span class="card-eyebrow">Seven-run trend</span><h2>Success Rate Over Time</h2></div>${demoBadge()}</div>${renderLineChart(mcp.history.labels, mcp.history.series, 0.35, 1)}<div class="latest-run-strip"><div><span>Latest overall</span><strong>${percent(mcp.passRate, 1)}</strong></div><div><span>Tool selection</span><strong>${percent(mcp.toolSelectionAccuracy, 1)}</strong></div><div><span>Loop free</span><strong>${percent(mcp.loopFreeRate, 1)}</strong></div><div><span>Protocol errors</span><strong>0</strong></div></div></article><div class="method-meta-grid">${[
    ["Harness", "Atlas MCP agent harness"],
    ["Judge", "Deterministic + model judge"],
    ["Max steps", "10"],
    ["Timeout", "30s"],
    ["Retries", "Disabled"],
    ["Protocol", "MCP 2025-06-18"],
  ]
    .map(
      ([label, value]) =>
        `<div class="data-card"><span>${label}</span><strong>${value}</strong>${demoBadge()}</div>`,
    )
    .join("")}</div></section>`;
}

function renderFailureAnalysisPanel(): string {
  const failures = REPORT_DEMO_DATA.failures;
  const maximum = Math.max(...failures.modes.map((mode) => mode.count));
  return `<section class="tab-panel" id="failure-analysis" data-report-tab="failure-analysis" data-source="demo" hidden>${renderTabHeader("Failure Analysis", "Ranked failure modes, root causes, blockers, and release impact.", "Failure intelligence")}<div class="failure-summary-strip">${failures.summary.map((item) => `<article class="data-card"><span>${item.label}</span><strong>${item.value}</strong><small>${item.delta} vs baseline</small>${demoBadge()}</article>`).join("")}</div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Ranked by impact</span><h2>Failure Modes</h2></div>${demoBadge()}</div><div class="table-wrap"><table class="failure-mode-table"><thead><tr><th>Rank</th><th>Failure mode</th><th>Layer</th><th>Frequency</th><th>Rate</th><th>Delta</th><th>Severity</th></tr></thead><tbody>${failures.modes.map((mode) => `<tr><td class="failure-rank">${String(mode.rank).padStart(2, "0")}</td><td><strong>${mode.label}</strong></td><td>${mode.layer}</td><td><div class="embedded-bar"><i data-health="${mode.severity}" style="--bar-size:${(mode.count / maximum) * 100}%"></i><span>${mode.count}</span></div></td><td>${percent(mode.rate, 1)}</td><td data-trend="${mode.delta > 0 ? "bad" : mode.delta < 0 ? "good" : "flat"}">${signedPoints(mode.delta)}</td><td><span class="table-pill ${mode.severity}">${mode.severity === "bad" ? "High" : mode.severity === "warn" ? "Medium" : "Low"}</span></td></tr>`).join("")}</tbody></table></div></article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Root causes</span><h2>Root Cause Trends</h2></div>${demoBadge()}</div><div class="root-cause-list">${failures.roots.map((root) => `<div class="root-cause-row"><div><strong>${root.label}</strong><span>${root.owner}</span></div>${renderSparkline(root.trend, root.trend.at(-1)! > root.trend[0]! ? "bad" : "good")}<strong>${root.cases} cases</strong></div>`).join("")}</div></article><div class="blocker-grid">${failures.blockers.map((blocker) => `<article class="data-card blocker-card"><div><span class="table-pill bad">${blocker.status}</span>${demoBadge()}</div><code>${blocker.id}</code><h3>${blocker.title}</h3><dl><div><dt>Owner</dt><dd>${blocker.owner}</dd></div><div><dt>Impact</dt><dd>${blocker.impact}</dd></div></dl></article>`).join("")}</div><aside class="impact-callout"><div><span class="alert-icon">!</span><div><strong>Release impact</strong><p>Three severe blockers fail required quality gates. The run should not become the new baseline.</p></div></div><span>Gated fail</span></aside></section>`;
}

function renderTrendsPanel(): string {
  const trends = REPORT_DEMO_DATA.trends;
  return `<section class="tab-panel" id="trends-baselines" data-report-tab="trends-baselines" data-source="demo" hidden>${renderTabHeader("Trends & Baselines", "Seven-run metric history, thresholds, event markers, and run comparisons.", "Longitudinal analysis")}<div class="trend-stack">${trends.metrics
    .map(
      (metric, index) =>
        `<article class="data-card trend-metric-card"><div class="trend-summary"><span>${metric.label}</span><strong>${metric.value}${metric.unit}</strong><small data-trend="${metric.delta > 0 && index !== 1 ? "bad" : metric.delta < 0 && index !== 6 ? "bad" : "good"}">${metric.delta > 0 ? "+" : ""}${metric.delta}${metric.unit === "%" ? "pp" : metric.unit} vs baseline</small><span class="target-label">Target ${metric.target}${metric.unit}</span>${demoBadge()}</div>${renderLineChart(
          trends.labels,
          [
            {
              label: "This run",
              health: index === 2 || index === 6 ? "bad" : "neutral",
              values: metric.current,
            },
            { label: "Baseline", health: "muted", values: metric.baseline },
            {
              label: "Target",
              health: "good",
              values: metric.current.map(() => metric.target),
            },
          ],
          Math.min(...metric.current, ...metric.baseline, metric.target) * 0.94,
          Math.max(...metric.current, ...metric.baseline, metric.target) * 1.04,
          true,
        )}</article>`,
    )
    .join(
      "",
    )}</div><div class="delta-card-grid">${trends.metrics.map((metric, index) => `<article class="data-card delta-card"><span>${metric.label}</span><strong>${metric.delta > 0 ? "+" : ""}${metric.delta}${metric.unit === "%" ? "pp" : metric.unit}</strong>${renderSparkline(metric.current, index === 2 || index === 6 ? "bad" : "neutral")}${demoBadge()}</article>`).join("")}</div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Run history</span><h2>Run Comparison</h2></div>${demoBadge()}</div><div class="table-wrap"><table class="run-comparison-table"><thead><tr><th>Run</th><th>Date</th><th>Overall</th><th>Retrieval</th><th>Answer</th><th>MCP Agent</th><th>Status</th></tr></thead><tbody>${trends.comparisons.map((run) => `<tr><td><code>${run.run}</code></td><td>${run.date}</td><td>${run.score.toFixed(1)}</td><td>${run.retrieval.toFixed(1)}%</td><td>${run.answer.toFixed(1)}%</td><td>${run.agent.toFixed(1)}%</td><td><span class="table-pill ${run.status === "Passing" ? "pass" : run.status === "Baseline" ? "neutral" : "bad"}">${run.status}</span></td></tr>`).join("")}</tbody></table></div></article></section>`;
}

function renderMethodologyPanel(report: Report): string {
  const pipeline = [
    ["01", "Dataset", "Versioned cases and expectations"],
    ["02", "Execution", "Retrieval and MCP trajectories"],
    ["03", "Evidence", "Paths, spans, and tool results"],
    ["04", "Deterministic", "Schema and threshold checks"],
    ["05", "Judging", "Claim and answer evaluation"],
    ["06", "Aggregation", "Gates, trends, and reports"],
  ];
  const measures = [
    ["Retrieval quality", "Recall@K, MRR, nDCG, precision"],
    ["Answer quality", "Faithfulness, support, contradiction"],
    ["Agent behavior", "Tool choice, trajectory, completion"],
    ["Safety", "Forbidden paths and abstention"],
    ["Reliability", "Latency, protocol, reproducibility"],
  ];
  return `<section class="tab-panel" id="methodology" data-report-tab="methodology" hidden>${renderTabHeader("Methodology", "Evaluation pipeline, measurement boundaries, thresholds, and scoring definitions.", "Evaluation design", false)}<article class="data-card detail-card methodology-pipeline"><div class="card-heading"><div><span class="card-eyebrow">End-to-end process</span><h2>Evaluation Pipeline</h2></div></div><div class="pipeline-steps">${pipeline.map(([index, label, detail]) => `<div class="pipeline-step"><span>${index}</span><strong>${label}</strong><small>${detail}</small></div>`).join("")}</div></article><div class="measure-grid">${measures.map(([label, detail]) => `<article class="data-card measure-card"><span class="measure-icon"></span><h3>${label}</h3><p>${detail}</p></article>`).join("")}</div><aside class="scope-callout"><strong>Out of scope</strong><p>The current deterministic harness does not independently verify model truth beyond supplied evidence, production traffic, or human preference. Preview layers remain marked as demo data.</p></aside><div class="detail-grid three-up"><article class="data-card detail-card"><span class="card-eyebrow">Thresholds</span><h2>Gate Policy</h2><ul class="method-list"><li>Required gates block release</li><li>Soft gates require review</li><li>Baseline regressions use tolerance</li><li>Safety gates are exact</li></ul></article><article class="data-card detail-card"><span class="card-eyebrow">Composition</span><h2>Case Mix</h2><ul class="method-list"><li>${report.totalCases} live retrieval cases</li><li>Capability and risk stratification</li><li>Positive and abstention cases</li><li>Stable path expectations</li></ul></article><article class="data-card detail-card"><span class="card-eyebrow">Failure definition</span><h2>What Counts as Failure</h2><ul class="method-list"><li>Required expectation missed</li><li>Forbidden evidence returned</li><li>Unsupported claim generated</li><li>Protocol or trajectory violation</li></ul></article></div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Core definitions</span><h2>Metric Reference</h2></div></div><div class="table-wrap"><table class="metric-reference"><thead><tr><th>Metric</th><th>Layer</th><th>Definition</th><th>Direction</th><th>Primary target</th></tr></thead><tbody>${[
    [
      "Recall@K",
      "Retrieval",
      "Expected source appears within top K results",
      "Higher",
      "≥ 0.90",
    ],
    [
      "MRR",
      "Retrieval",
      "Reciprocal rank of first expected source",
      "Higher",
      "≥ 0.60",
    ],
    [
      "Faithfulness",
      "Answer",
      "Claims supported by retrieved evidence",
      "Higher",
      "≥ 0.90",
    ],
    [
      "Unsupported claim rate",
      "Answer",
      "Claims without sufficient evidence support",
      "Lower",
      "≤ 0.05",
    ],
    [
      "Agent pass rate",
      "MCP Agent",
      "Cases completing all required outcomes",
      "Higher",
      "≥ 0.90",
    ],
    [
      "Protocol error rate",
      "MCP Agent",
      "Invalid MCP requests or responses",
      "Lower",
      "= 0",
    ],
    [
      "Forbidden path accuracy",
      "Safety",
      "Cases excluding prohibited sources",
      "Higher",
      "= 1.00",
    ],
  ]
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join(
      "",
    )}</tbody></table></div></article><div class="detail-grid two-up"><article class="data-card metric-kind-card"><span class="table-pill pass">Deterministic</span><h2>Deterministic Metrics</h2><p>Exact paths, terms, exclusions, ranks, protocol behavior, latency, and structured expectations. Reproducible without model credentials.</p></article><article class="data-card metric-kind-card"><span class="table-pill neutral">Judge assisted</span>${demoBadge()}<h2>Judge Metrics</h2><p>Claim support, answer completeness, intent resolution, and nuanced trajectory quality. Previewed until the judge pipeline is implemented.</p></article></div></section>`;
}

function renderReproducibilityPanel(report: Report): string {
  const command =
    "bun tooling/scripts/mcp-retrieval-eval.ts --dataset evals/mcp-retrieval.dataset.json --out mcp-retrieval-report.json --html mcp-retrieval-report.html --trend-log none";
  const metadata = [
    [
      "Run ID",
      report.runtime.repoRevision?.slice(0, 7) ?? REPORT_DEMO_DATA.runId,
      report.runtime.repoRevision ? "Live" : "Demo",
    ],
    ["Dataset", report.dataset, "Live"],
    ["Generated", formatTimestamp(report.generatedAt), "Live"],
    ["Repository", report.repoId ?? report.runtime.repoId ?? "unknown", "Live"],
    ["Repo revision", report.runtime.repoRevision ?? "unknown", "Live"],
    ["Indexed revision", report.runtime.indexedRevision ?? "unknown", "Live"],
    ["Corpus documents", String(report.runtime.docCount ?? "unknown"), "Live"],
    ["Runtime source", report.runtime.source, "Live"],
    ["Duration", REPORT_DEMO_DATA.duration, "Demo"],
  ];
  return `<section class="tab-panel" id="reproducibility" data-report-tab="reproducibility" hidden>${renderTabHeader("Reproducibility", "Run identity, exact command, artifacts, checksums, and environment verification.", "Run provenance", false)}<div class="repro-meta-grid">${metadata.map(([label, value, source]) => `<article class="data-card"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${source}</small>${source === "Demo" ? demoBadge() : ""}</article>`).join("")}</div><article class="data-card command-card"><div class="card-heading"><div><span class="card-eyebrow">Exact reproduction</span><h2>Reproduction Command</h2></div><button type="button" data-copy-text="${escapeHtml(command)}">Copy command</button></div><pre><code>${escapeHtml(command)}</code></pre></article><div class="detail-grid three-up"><article class="data-card artifact-card"><span class="card-eyebrow">Artifacts</span><h2>Report Bundle</h2><ul><li>mcp-retrieval-report.json</li><li>mcp-retrieval-report.html</li><li>dataset manifest</li><li>runtime diagnostics</li></ul></article><article class="data-card artifact-card"><span class="card-eyebrow">Identity</span><h2>Runtime Contract</h2><dl><div><dt>CLI</dt><dd>${escapeHtml(report.runtime.cli)}</dd></div><div><dt>Execution</dt><dd>${report.runtime.executionMode ?? "spawn-cli"}</dd></div><div><dt>Source</dt><dd>${report.runtime.source}</dd></div></dl></article><article class="data-card artifact-card"><span class="card-eyebrow">Checksums</span><h2>Artifact Integrity</h2>${demoBadge()}<dl><div><dt>Dataset</dt><dd><code>sha256:4f29a6…d921</code></dd></div><div><dt>Corpus</dt><dd><code>sha256:98ac31…af02</code></dd></div><div><dt>Report</dt><dd><code>sha256:cb7210…4e18</code></dd></div></dl></article></div><article class="data-card reproducibility-checklist"><div class="card-heading"><div><span class="card-eyebrow">Verification</span><h2>Reproducibility Checklist</h2></div><span class="repro-status">Reproducible</span></div>${[
    ["Dataset resolved", report.runtime.datasetPath ?? report.dataset],
    ["Corpus opened", report.runtime.corpusDbPath ?? "CLI default"],
    ["Revision recorded", report.runtime.repoRevision ?? "unknown"],
    ["Index revision recorded", report.runtime.indexedRevision ?? "unknown"],
    ["Case count stable", `${report.totalCases} cases`],
    ["Machine report written", "JSON + standalone HTML"],
  ]
    .map(
      ([label, detail]) =>
        `<div class="check-row"><span class="check-icon">✓</span><strong>${label}</strong><small>${escapeHtml(detail)}</small></div>`,
    )
    .join(
      "",
    )}</article><aside class="repro-footer"><div><strong>Standalone by design</strong><p>The HTML report embeds its styles, charts, interaction script, and evaluation payload. No external chart runtime is required.</p></div><a href="mcp-retrieval-report.json">Open machine-readable report</a></aside></section>`;
}

function renderTabHeader(
  title: string,
  description: string,
  eyebrow: string,
  demo = true,
): string {
  return `<header class="tab-page-header"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${demo ? demoBadge() : ""}</header>`;
}

function renderMetricCard(
  label: string,
  value: string,
  note: string,
  health: ChartTone,
  demo: boolean,
): string {
  return `<article class="data-card tab-kpi" data-health="${health}"><div><span class="metric-icon"></span><span>${label}</span>${demo ? demoBadge() : ""}</div><strong>${value}</strong><small>${note}</small><span class="kpi-state">${health === "good" ? "Pass" : health === "bad" ? "Fail" : health === "warn" ? "Warn" : "Observed"}</span></article>`;
}

function renderDonut(
  items: readonly {
    readonly label: string;
    readonly value: number;
    readonly health: string;
  }[],
  primary: string,
  secondary: string,
): string {
  let offset = 0;
  const segments = items
    .map((item) => {
      const amount = item.value * 100;
      const segment = `<circle data-health="${item.health}" cx="74" cy="74" r="52" pathLength="100" stroke-dasharray="${amount} ${100 - amount}" stroke-dashoffset="${-offset}"/>`;
      offset += amount;
      return segment;
    })
    .join("");
  return `<svg class="detail-donut" viewBox="0 0 148 148" role="img" aria-label="${escapeHtml(secondary)} distribution"><circle class="donut-track" cx="74" cy="74" r="52"/>${segments}<text class="donut-primary" x="74" y="70">${escapeHtml(primary)}</text><text class="donut-secondary" x="74" y="88">${escapeHtml(secondary)}</text></svg>`;
}

function renderLineChart(
  labels: readonly string[],
  series: readonly ChartSeries[],
  minimum: number,
  maximum: number,
  compact = false,
): string {
  const width = 720;
  const height = compact ? 168 : 230;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const span = Math.max(maximum - minimum, 0.0001);
  const point = (index: number, value: number): readonly [number, number] => [
    left + (index / Math.max(labels.length - 1, 1)) * plotWidth,
    top + (1 - (value - minimum) / span) * plotHeight,
  ];
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = minimum + ((4 - index) / 4) * span;
    const y = top + (index / 4) * plotHeight;
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="4" y="${y + 4}">${formatAxis(value)}</text>`;
  }).join("");
  const paths = series
    .map((item) => {
      const path = item.values
        .map(
          (value, index) =>
            `${index === 0 ? "M" : "L"}${point(index, value).join(" ")}`,
        )
        .join(" ");
      return `<path class="series-line" data-health="${item.health}" d="${path}"/>${item.values
        .map((value, index) => {
          const [x, y] = point(index, value);
          return `<circle class="series-point" data-health="${item.health}" cx="${x}" cy="${y}" r="${compact ? 2.4 : 3.5}"/>`;
        })
        .join("")}`;
    })
    .join("");
  const xLabels = labels
    .map((label, index) => {
      const [x] = point(index, minimum);
      return `<text class="x-axis-label" x="${x}" y="${height - 8}">${label}</text>`;
    })
    .join("");
  return `<div class="multi-line-chart${compact ? " compact" : ""}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Metric trend chart"><g class="detail-chart-grid">${grid}</g>${paths}${xLabels}</svg><div class="series-legend">${series.map((item) => `<span><i data-health="${item.health}"></i>${item.label}</span>`).join("")}</div></div>`;
}

function renderScatter(points: readonly (readonly number[])[]): string {
  const width = 560;
  const height = 280;
  const left = 48;
  const top = 20;
  const plotWidth = 480;
  const plotHeight = 212;
  const x = (value: number): number => left + ((value - 2) / 7) * plotWidth;
  const y = (value: number): number =>
    top + (1 - (value - 0.35) / 0.65) * plotHeight;
  const grid = [0.4, 0.6, 0.8, 1]
    .map(
      (value) =>
        `<line x1="${left}" y1="${y(value)}" x2="${left + plotWidth}" y2="${y(value)}"/><text x="7" y="${y(value) + 4}">${value.toFixed(1)}</text>`,
    )
    .join("");
  return `<div class="scatter-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Trajectory steps plotted against task score"><g class="detail-chart-grid">${grid}</g><line class="trend-fit" x1="${x(2)}" y1="${y(0.98)}" x2="${x(9)}" y2="${y(0.42)}"/>${points.map(([steps = 0, score = 0]) => `<circle cx="${x(steps)}" cy="${y(score)}" r="5"/>`).join("")}${[2, 3, 4, 5, 6, 7, 8, 9].map((value) => `<text class="x-axis-label" x="${x(value)}" y="258">${value}</text>`).join("")}<text class="axis-title" x="288" y="278">Trajectory steps</text></svg></div>`;
}

function renderSparkline(values: readonly number[], health: ChartTone): string {
  const width = 120;
  const height = 32;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(values.length - 1, 1)) * width},${height - 3 - ((value - minimum) / span) * (height - 6)}`,
    )
    .join(" ");
  return `<svg class="sparkline" data-health="${health}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

function renderRiskHeatmap(values: readonly (readonly number[])[]): string {
  const columns = ["Low", "Guarded", "Elevated", "High", "Critical"];
  const capabilities = [
    "Scope discovery",
    "Document retrieval",
    "Artifact verification",
    "Freshness checks",
    "Answer synthesis",
  ];
  return `<div class="risk-heatmap"><div class="risk-columns">${columns.map((label) => `<span>${label}</span>`).join("")}</div>${values.map((row, rowIndex) => `<div class="risk-row"><span>${capabilities[rowIndex] ?? `Capability ${rowIndex + 1}`}</span><div>${row.map((value) => `<i data-band="${value >= 0.88 ? "good" : value >= 0.72 ? "warn" : "bad"}" title="${percent(value, 1)}"><b>${Math.round(value * 100)}</b></i>`).join("")}</div></div>`).join("")}</div>`;
}

function demoBadge(): string {
  return `<span class="demo-badge">Demo data</span>`;
}

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPoints(value: number): string {
  return value === 0
    ? "—"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}

function formatAxis(value: number): string {
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  if (Math.abs(value) >= 10) return value.toFixed(0);
  return value.toFixed(2);
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} ${parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function escapeHtml(value: string | undefined): string {
  return (value ?? "unknown")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
