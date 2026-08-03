import type { AgentEffectFreshness } from "../../agent-effect";
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
import { renderDetailPanels } from "./detail-panels";
import { renderExplorerScript } from "./explorer-script";
import { moxelBandedFieldScript } from "./moxel-theme";

export interface DashboardRenderOptions {
	readonly agentEffect?: AgentEffectFreshness;
}

interface QualityGateRow {
	readonly status: HealthLevel;
	readonly passed: boolean;
	readonly layer: string;
	readonly metric: string;
	readonly actual: string;
	readonly required: string;
	readonly delta: string;
	readonly type: string;
}

const NAV_ITEMS = [
	["overview", "Overview"],
	["quality-gates", "Quality Gates"],
	["cross-layer-summary", "Cross-Layer Summary"],
	["retrieval", "Retrieval"],
	["answer-quality", "Answer Quality"],
	["mcp-agent", "Luna + Atlas MCP"],
	["failure-analysis", "Failure Analysis"],
	["case-explorer", "Case Explorer"],
	["coverage-analysis", "Coverage Analysis"],
	["trends-baselines", "Trends & Baselines"],
	["methodology", "Methodology"],
	["reproducibility", "Reproducibility"],
] as const;

export function renderHtml(
	report: Report,
	options: DashboardRenderOptions = {},
): string {
	const effect = options.agentEffect ?? ({ status: "absent" } as const);
	return `<!doctype html>
<html lang="en" data-severity="${escapeHtml(report.narrative.severity)}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>MOXEL ATLAS EVALS — ${escapeHtml(report.dataset)}</title><style>${renderReportCss()}</style></head>
<body class="moxel-eval-body" data-severity="${escapeHtml(report.narrative.severity)}"><canvas id="banded-field" aria-hidden="true"></canvas><div class="noise" aria-hidden="true"></div><div class="report-app" data-report-shell="moxel-atlas-eval-report-theme">${renderSidebar()}<main class="report-main">
<section class="tab-panel" id="overview" data-report-tab="overview">${renderOverview(report, effect)}${renderQualityGates(report, "overview-quality-gates")}${renderCrossLayerSummary(effect, "overview-cross-layer-summary")}${renderFailureOverview(report, effect)}${renderRetrievalPerformance(report, "overview-retrieval")}</section>
<section class="tab-panel" id="quality-gates" data-report-tab="quality-gates" hidden>${renderStandaloneHeader("Quality Gates", "Actual deterministic CI thresholds and their observed values.")}${renderQualityGates(report, "quality-gates-detail")}</section>
<section class="tab-panel" id="cross-layer-summary" data-report-tab="cross-layer-summary" hidden>${renderStandaloneHeader("Cross-Layer Summary", "Measured treatment-answer completion and canonical grounding.")}${renderCrossLayerSummary(effect, "cross-layer-detail")}</section>
<section class="tab-panel" id="retrieval" data-report-tab="retrieval" hidden>${renderStandaloneHeader("Retrieval", "Rank quality, latency, safety boundaries, and deterministic coverage.")}${renderRetrievalPerformance(report, "retrieval-detail")}</section>
${renderDetailPanels(report, effect)}${renderExplorer(report)}${renderCoverageAnalysis(report)}
</main></div><div id="info-popover" class="info-popover" role="dialog" aria-modal="false" aria-live="polite" hidden></div><script id="atlas-eval-report-data" type="application/json">${safeJson(reportClientData(report))}</script><script>${moxelBandedFieldScript}</script><script>${renderExplorerScript()}</script></body></html>`;
}

function renderSidebar(): string {
	return `<aside class="report-sidebar"><div class="sidebar-brand" aria-label="Moxel">moxel</div><div class="sidebar-label">Atlas evaluation report</div><nav class="report-nav" aria-label="Evaluation report sections">${NAV_ITEMS.map(([id, label], index) => `<a href="#${id}"${index === 0 ? ' aria-current="location"' : ""}><span class="nav-mark" aria-hidden="true"></span>${label}</a>`).join("")}</nav><footer class="sidebar-footer">Generated with Atlas<br /><a href="https://moxel.dev/atlas">moxel.dev/atlas</a></footer></aside>`;
}

function renderOverview(report: Report, effect: AgentEffectFreshness): string {
	const revision = report.runtime.repoRevision?.slice(0, 12) ?? "not recorded";
	const severity = report.narrative.severity;
	return `<div class="overview-header"><div class="report-heading"><div><div class="eyebrow">Atlas evaluation report</div><h1>${escapeHtml(report.dataset)} <span aria-hidden="true">·</span> Evidence Report</h1><p class="report-subtitle">Deterministic retrieval evidence${effect.status === "absent" ? "; Luna agent evidence has not been collected." : ` plus ${effect.status} local Luna agent evidence.`}</p></div><div class="gate-badge" data-health="${severity}"><strong>${severity === "bad" ? "GATED FAIL" : severity === "warn" ? "GATED WARN" : "GATED PASS"}</strong><span>${severity === "bad" ? "Needs work" : severity === "warn" ? "Review advised" : "Ready"}</span></div></div><div class="metadata-row">${metadataChip("Revision", revision)}${metadataChip("Dataset", report.dataset)}${metadataChip("Retrieval cases", String(report.totalCases))}${metadataChip("Generated", formatTimestamp(report.generatedAt))}${metadataChip("Corpus", runtimeLabel(report))}</div>${renderPrimaryAlert(report)}${renderExecutiveSummary(report, effect)}</div>`;
}

function metadataChip(label: string, value: string): string {
	return `<span class="metadata-chip"><span class="metadata-icon" aria-hidden="true"></span><span class="sr-only">${escapeHtml(label)}: </span>${escapeHtml(value)}</span>`;
}

function renderPrimaryAlert(report: Report): string {
	const primary =
		report.narrative.keyFindings.find(
			(finding) => finding.severity === report.narrative.severity,
		) ?? report.narrative.keyFindings[0];
	const metric =
		primary === undefined ? "Deterministic pass rate" : primary.label;
	const value =
		primary === undefined
			? `${report.passedCases}/${report.totalCases}`
			: primary.value;
	return `<article class="primary-alert" data-health="${report.narrative.severity}"><div class="alert-copy"><span class="alert-icon" aria-hidden="true">${statusGlyph(report.narrative.severity)}</span><div><h2>${escapeHtml(report.narrative.headline)}</h2><p>${escapeHtml(report.narrative.verdict)}</p></div></div><div class="primary-blocker"><span>Primary signal</span><strong>${escapeHtml(metric)}</strong><div><b>${escapeHtml(value)}</b><small>Measured deterministic result</small></div></div></article>`;
}

function renderExecutiveSummary(
	report: Report,
	effect: AgentEffectFreshness,
): string {
	const agentCards =
		effect.status === "absent"
			? [
					summaryCard(
						"Luna paired benchmark",
						"Not collected",
						"Run locally before a release",
						"neutral",
					),
				]
			: [
					summaryCard(
						"Treatment completion",
						percent(effect.snapshot.metrics.treatment.completionRate, 1),
						`${signedPoints(effect.snapshot.metrics.treatment.completionRate - effect.snapshot.metrics.baseline.completionRate)} vs baseline`,
						health(effect.snapshot.metrics.treatment.completionRate),
					),
					summaryCard(
						"Atlas MCP adoption",
						percent(effect.snapshot.metrics.mcp.adoptionRate, 1),
						effect.status === "fresh"
							? "Fresh local evidence"
							: `Stale · ${effect.snapshot.releaseId}`,
						health(effect.snapshot.metrics.mcp.adoptionRate),
					),
				];
	return `<div class="section-title compact"><div><h2>Executive Summary</h2></div></div><div class="summary-grid">${[
		summaryCard(
			"Retrieval pass rate",
			percent(report.metrics.passRate, 1),
			deltaText(report, "passRate"),
			classifyHealth("passRate", report.metrics.passRate),
		),
		summaryCard(
			"Recall@5",
			percent(report.metrics.pathRecallAt5, 1),
			deltaText(report, "pathRecallAt5"),
			classifyHealth("pathRecallAt5", report.metrics.pathRecallAt5),
		),
		summaryCard(
			"Retrieval p95",
			`${Math.round(report.metrics.p95LatencyMs)}ms`,
			deltaText(report, "p95LatencyMs"),
			classifyHealth("p95LatencyMs", report.metrics.p95LatencyMs),
		),
		...agentCards,
	].join("")}</div>`;
}

function summaryCard(
	label: string,
	value: string,
	note: string,
	state: HealthLevel | "neutral",
): string {
	return `<article class="summary-card" data-health="${state}"><div class="summary-label"><span class="metric-icon" aria-hidden="true"></span>${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong><span class="summary-delta">${escapeHtml(note)}</span><span class="status-tag" data-health="${state}">${healthLabel(state)}</span></article>`;
}

function renderQualityGates(report: Report, id: string): string {
	const rows = qualityGateRows(report);
	const passed = rows.filter((row) => row.passed).length;
	return `<section class="report-section" id="${id}">${renderSectionHeader("Quality Gates", "Only deterministic thresholds gate CI. Local Luna measurements are reported separately.", `${passed} / ${rows.length || 0} passed`)}<div class="data-card table-card"><div class="table-wrap"><table class="gates-table"><thead><tr><th>Status</th><th>Layer</th><th>Metric</th><th>Actual</th><th>Required</th><th>Delta</th><th>Type</th></tr></thead><tbody>${rows.map((row) => `<tr><td><span class="table-status" data-health="${row.status}">${statusGlyph(row.status)}</span></td><td>${escapeHtml(row.layer)}</td><td>${escapeHtml(row.metric)}</td><td class="numeric">${escapeHtml(row.actual)}</td><td class="numeric muted-cell">${escapeHtml(row.required)}</td><td class="numeric" data-health="${row.status}">${escapeHtml(row.delta)}</td><td>${escapeHtml(row.type)}</td></tr>`).join("") || '<tr><td colspan="7">No thresholds configured for this local report.</td></tr>'}</tbody></table></div><div class="card-footer">Threshold values come from this report’s machine-readable deterministic result.</div></div></section>`;
}

function qualityGateRows(report: Report): QualityGateRow[] {
	return (report.thresholds?.results ?? []).map((result) => ({
		status: result.passed ? "good" : "bad",
		passed: result.passed,
		layer: "Retrieval",
		metric: result.label,
		actual: thresholdValue(result, result.actual),
		required: `${result.direction === "higher" ? "≥" : "≤"} ${thresholdValue(result, result.limit)}`,
		delta: isHealthMetric(result.metric)
			? deltaText(report, result.metric)
			: "No baseline",
		type: "Required",
	}));
}

function renderCrossLayerSummary(
	effect: AgentEffectFreshness,
	id: string,
): string {
	if (effect.status === "absent") {
		return `<section class="report-section" id="${id}">${renderSectionHeader("Cross-Layer Summary", "Treatment answer completion and canonical grounding require a local Luna run.", "Not collected")}<article class="data-card detail-card"><p>No result is shown until a real local Luna snapshot is available.</p></article></section>`;
	}
	const pairs = effect.snapshot.pairs;
	const counts = {
		completeGrounded: pairs.filter(
			(pair) => criterion(pair, "completion") && criterion(pair, "grounding"),
		).length,
		completeUngrounded: pairs.filter(
			(pair) => criterion(pair, "completion") && !criterion(pair, "grounding"),
		).length,
		incompleteGrounded: pairs.filter(
			(pair) => !criterion(pair, "completion") && criterion(pair, "grounding"),
		).length,
		incompleteUngrounded: pairs.filter(
			(pair) => !criterion(pair, "completion") && !criterion(pair, "grounding"),
		).length,
	};
	return `<section class="report-section" id="${id}">${renderSectionHeader("Cross-Layer Summary", "Treatment outcomes from the Luna judge; ${effect.status} evidence.", effect.status === "fresh" ? "Fresh" : "Stale")}<div class="cross-layer-grid"><article class="data-card"><span>Complete + grounded</span><strong>${counts.completeGrounded}</strong><small>paired treatment answers</small></article><article class="data-card"><span>Complete + ungrounded</span><strong>${counts.completeUngrounded}</strong><small>needs evidence review</small></article><article class="data-card"><span>Incomplete + grounded</span><strong>${counts.incompleteGrounded}</strong><small>partial answer</small></article><article class="data-card"><span>Incomplete + ungrounded</span><strong>${counts.incompleteUngrounded}</strong><small>needs work</small></article></div></section>`;
}

function renderFailureOverview(
	report: Report,
	effect: AgentEffectFreshness,
): string {
	const failures = report.quality.weakestCases
		.filter((item) => !item.passed)
		.slice(0, 5);
	const description =
		effect.status === "absent"
			? "Observed deterministic failures; agent failures are not collected."
			: "Observed deterministic failures and separately reported agent outcomes.";
	const worklist =
		failures.map(renderWorklistCard).join("") ||
		'<article class="worklist-row" data-health="good"><p>No deterministic retrieval failures in this run.</p></article>';
	return `<section class="report-section" id="overview-failure-analysis">${renderSectionHeader("Failure Analysis", description, `${report.failedCases} retrieval failures`)}<div class="worklist">${worklist}</div></section>`;
}

function renderRetrievalPerformance(report: Report, id: string): string {
	const cards: ReadonlyArray<readonly [string, string, string, HealthLevel]> = [
		[
			"Recall@1",
			percent(report.metrics.pathRecallAt1),
			deltaText(report, "pathRecallAt1"),
			classifyHealth("pathRecallAt1", report.metrics.pathRecallAt1),
		],
		[
			"Recall@3",
			percent(report.metrics.pathRecallAt3),
			deltaText(report, "pathRecallAt3"),
			classifyHealth("pathRecallAt3", report.metrics.pathRecallAt3),
		],
		[
			"Recall@5",
			percent(report.metrics.pathRecallAt5),
			deltaText(report, "pathRecallAt5"),
			classifyHealth("pathRecallAt5", report.metrics.pathRecallAt5),
		],
		[
			"MRR",
			report.metrics.mrr.toFixed(2),
			deltaText(report, "mrr"),
			classifyHealth("mrr", report.metrics.mrr),
		],
		[
			"p95 latency",
			`${Math.round(report.metrics.p95LatencyMs)}ms`,
			deltaText(report, "p95LatencyMs"),
			classifyHealth("p95LatencyMs", report.metrics.p95LatencyMs),
		],
		[
			"Forbidden-path accuracy",
			percent(report.metrics.forbiddenPathAccuracy),
			"Safety check",
			classifyHealth(
				"forbiddenPathAccuracy",
				report.metrics.forbiddenPathAccuracy,
			),
		],
	];
	return `<section class="report-section" id="${id}">${renderSectionHeader("Retrieval Performance", "Actual rank, latency, and safety measurements. Only evaluated ranks are plotted.", `${report.passedCases}/${report.totalCases} deterministic cases passed`)}<div class="kpi-grid">${cards.map(([label, value, note, state]) => `<article class="kpi-card" data-health="${state}"><span>${label}${metricInfo(label)}</span><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("")}</div><div class="detail-grid two-up"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Rank quality</span><h2>Recall at evaluated ranks</h2></div></div>${renderRecallChart(report)}</article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Latency</span><h2>Distribution</h2></div></div>${renderBuckets(report.quality.latencyBuckets)}</article></div></section>`;
}

function renderRecallChart(report: Report): string {
	const values: ReadonlyArray<readonly [string, number]> = [
		["1", report.metrics.pathRecallAt1],
		["3", report.metrics.pathRecallAt3],
		["5", report.metrics.pathRecallAt5],
	];
	const baseline = values.map(
		([rank, value], index) =>
			[
				rank,
				["pathRecallAt1", "pathRecallAt3", "pathRecallAt5"].map(
					(metric) => deltaFor(report, metric as HealthMetric)?.baseline,
				)[index] ?? value,
			] as const,
	);
	const point = (index: number, value: number): [number, number] => [
		92 + index * 170,
		28 + (1 - Math.max(0, Math.min(1, value))) * 168,
	];
	const path = (series: ReadonlyArray<readonly [string, number]>) =>
		series
			.map(
				([, value], index) =>
					`${index === 0 ? "M" : "L"}${point(index, value).join(" ")}`,
			)
			.join(" ");
	return `<div class="line-chart"><svg viewBox="0 0 540 240" role="img" aria-label="Measured recall at ranks one, three, and five compared with the deterministic baseline"><g class="chart-gridlines">${[
		0, 0.25, 0.5, 0.75, 1,
	]
		.map((value) => {
			const y = 28 + (1 - value) * 168;
			return `<line x1="52" y1="${y}" x2="488" y2="${y}"/><text x="8" y="${y + 4}">${value.toFixed(2)}</text>`;
		})
		.join("")}</g><path class="baseline-line" d="${path(baseline)}"/>${baseline
		.map(([, value], index) => {
			const [x, y] = point(index, value);
			return `<circle class="baseline-point" cx="${x}" cy="${y}" r="4"/>`;
		})
		.join("")}<path class="current-line" d="${path(values)}"/>${values
		.map(([label, value], index) => {
			const [x, y] = point(index, value);
			return `<circle class="current-point" cx="${x}" cy="${y}" r="5"/><text class="axis-label" x="${x}" y="222">${label}</text>`;
		})
		.join(
			"",
		)}</svg><div class="chart-legend"><span><i class="legend-swatch current"></i>This run</span><span><i class="legend-swatch baseline"></i>Baseline</span></div></div>`;
}

function renderBuckets(
	buckets: readonly {
		readonly label: string;
		readonly count: number;
		readonly rate: number;
	}[],
): string {
	return `<div class="taxonomy-bars">${buckets.map((bucket) => `<div class="taxonomy-bar-row"><span>${escapeHtml(bucket.label)}</span><div class="micro-track"><i style="--micro-size:${bucket.rate * 100}%"></i></div><strong>${bucket.count}</strong><small>${percent(bucket.rate)}</small></div>`).join("")}</div>`;
}

function renderExplorer(report: Report): string {
	const categories = optionList(
		unique(report.cases.map((item) => item.category)),
	);
	const profiles = optionList(
		unique(report.cases.map((item) => item.profile ?? "unknown")),
	);
	const risks = optionList(
		unique(report.cases.map((item) => item.riskArea ?? "unknown")),
	);
	const selected = report.cases[0];
	return `<section class="tab-panel" id="case-explorer" data-report-tab="case-explorer" hidden>${renderStandaloneHeader("Case Explorer", "Inspect individual deterministic retrieval queries, ranked evidence, and observed failures.")}<div class="case-workspace"><aside class="data-card case-browser"><div class="case-browser-controls" role="search"><div class="control search-control"><label for="case-search">Search cases</label><input id="case-search" type="search" placeholder="Query, path, profile, or case ID" /></div><div class="case-filter-row"><div class="control"><label for="filter-category">Category</label><select id="filter-category"><option value="">All</option>${categories}</select></div><div class="control"><label for="filter-profile">Profile</label><select id="filter-profile"><option value="">All</option>${profiles}</select></div></div><div class="case-filter-row"><div class="control"><label for="filter-risk">Risk</label><select id="filter-risk"><option value="">All</option>${risks}</select></div><div class="control"><label for="case-sort">Sort</label><select id="case-sort"><option value="weakest">Weakest rank</option><option value="recallAt5">Recall@5</option><option value="mrr">MRR</option><option value="latency">Latency</option><option value="ranked">Ranked hits</option><option value="id">Case ID</option></select></div></div><button id="clear-filters" type="button">Clear filters</button></div><div class="case-browser-summary"><span><strong id="visible-count">${report.cases.length}</strong> / ${report.cases.length} cases</span><span>Page 1</span></div><div id="empty-state" class="empty">No cases match these filters. <button type="button" data-clear-filters>Clear filters</button></div><div id="case-list" class="case-list compact-list">${report.cases.map((item, index) => renderCaseCard(item, index === 0)).join("")}</div><div class="case-pagination"><button type="button" disabled>Previous</button><span>1 of 1</span><button type="button" disabled>Next</button></div></aside><article class="data-card case-inspector">${selected === undefined ? '<div class="case-detail-empty"><strong>No cases in this dataset.</strong></div>' : renderSelectedCase(selected)}</article></div></section>`;
}

function renderCaseCard(item: CaseResult, selected: boolean): string {
	const state = caseHealth(item);
	const status = !item.passed
		? "fail"
		: item.retrieval.recallAt5 < 1
			? "rank headroom"
			: "pass";
	return `<button type="button" class="case-card compact-case${selected ? " selected" : ""}" data-case-card data-case-select="${escapeHtml(item.id)}" data-health="${state}" data-id="${escapeHtml(item.id)}" data-category="${escapeHtml(item.category)}" data-profile="${escapeHtml(item.profile ?? "unknown")}" data-risk="${escapeHtml(item.riskArea ?? "unknown")}" data-recall="${item.retrieval.recallAt5}" data-mrr="${item.retrieval.reciprocalRank}" data-latency="${item.latencyMs}" data-ranked="${item.rankedCount}" data-search="${escapeHtml(caseSearchText(item))}"><span class="compact-case-head"><strong>${escapeHtml(item.id)}</strong><span class="table-pill ${state}">${escapeHtml(status)}</span></span><span class="compact-case-title">${escapeHtml(caseSummary(item))}</span><span class="compact-case-metrics"><span>R@5 ${percent(item.retrieval.recallAt5)}</span><span>MRR ${item.retrieval.reciprocalRank.toFixed(2)}</span><span>${item.latencyMs}ms</span></span></button>`;
}

function renderSelectedCase(item: CaseResult): string {
	const state = caseHealth(item);
	const evidence = item.topPaths
		.slice(0, 6)
		.map(
			(path, index) =>
				`<tr><td>${index + 1}</td><td><code>${escapeHtml(path)}</code></td></tr>`,
		)
		.join("");
	return `<div class="case-inspector-header"><div><span class="card-eyebrow">Selected case</span><h2 id="case-detail-id">${escapeHtml(item.id)}</h2><p id="case-detail-category">${escapeHtml(item.category)} · ${escapeHtml(item.profile ?? "unknown")}</p></div><span id="case-detail-status" class="table-pill ${state}">${item.passed ? "Pass" : "Fail"}</span></div><div class="case-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected="true">Overview</button><button type="button" role="tab" aria-selected="false">Retrieval</button><button type="button" role="tab" aria-selected="false">Diagnostics</button><button type="button" role="tab" aria-selected="false">Metadata</button></div><div class="case-detail-body"><section class="case-copy-block"><span>Query</span><p id="case-detail-query">${escapeHtml(item.query)}</p></section><section class="case-copy-block"><span>Expected behavior</span><p id="case-detail-expected">${escapeHtml(item.expectedBehavior ?? "Required paths and terms present; forbidden paths absent; no-result behavior correct when expected.")}</p></section><section class="case-detail-section"><div class="case-section-heading"><span>Evaluation layers</span><h3>Deterministic result</h3></div><div class="case-layer-grid"><article><span>Pass</span><strong id="case-detail-pass">${item.passed ? "Passed" : "Failed"}</strong></article><article><span>Recall@5</span><strong id="case-detail-recall">${percent(item.retrieval.recallAt5)}</strong></article><article><span>MRR</span><strong id="case-detail-mrr">${item.retrieval.reciprocalRank.toFixed(2)}</strong></article><article><span>Latency</span><strong id="case-detail-latency">${item.latencyMs}ms</strong></article></div></section><section class="case-evidence-section"><div class="card-heading"><div><span class="card-eyebrow">Retrieval evidence</span><h3>Ranked Sources</h3></div><span>${item.topPaths.length} paths</span></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Path</th></tr></thead><tbody id="case-detail-evidence">${evidence}</tbody></table></div></section><section class="case-detail-section"><div class="diagnosis-box"><strong>Observed result</strong><p id="case-detail-diagnosis">${escapeHtml(caseDiagnosis(item))}</p></div><dl class="case-metadata-grid"><div><dt>Risk area</dt><dd id="case-detail-risk">${escapeHtml(item.riskArea ?? "unknown")}</dd></div><div><dt>Feature</dt><dd id="case-detail-feature">${escapeHtml(item.feature ?? "unknown")}</dd></div><div><dt>Priority</dt><dd id="case-detail-priority">${escapeHtml(item.priority ?? "unknown")}</dd></div><div><dt>Ranked hits</dt><dd id="case-detail-ranked">${item.rankedCount}</dd></div></dl></section></div>`;
}

function renderCoverageAnalysis(report: Report): string {
	return `<section class="tab-panel" id="coverage-analysis" data-report-tab="coverage-analysis" hidden>${renderStandaloneHeader("Coverage Analysis", "Capability distribution and cases with the most retrieval headroom.")}<div class="report-section coverage-detail"><div class="data-card coverage-card"><div class="coverage-toolbar"><h2 id="quality-title">Quality by capability</h2><select id="quality-group" aria-label="Change coverage heatmap group"><option value="byCapability">Capability</option><option value="byRiskArea">Risk area</option><option value="byProfile">Profile</option><option value="byCategory">Category</option><option value="byPriority">Priority</option><option value="byCoverageType">Coverage type</option></select></div><div id="quality-heatmap" class="heatmap">${renderHeatmap(report.quality.byCapability)}</div></div><div class="data-card worklist-card"><h2>Ranking worklist</h2><p class="muted">Cases with deterministic failures, missing top-five evidence, or slower retrieval.</p><div class="worklist">${report.quality.weakestCases.map(renderWorklistCard).join("")}</div></div></div></section>`;
}

function renderHeatmap(group: Record<string, QualityGroupSummary>): string {
	return Object.entries(group)
		.map(
			([name, value]) =>
				`<article class="heat" data-health="${heatmapHealth(value)}"><strong>${escapeHtml(name)}</strong><span>${value.passed}/${value.total} pass</span><small>R@5 ${percent(value.recallAt5)} · MRR ${value.mrr.toFixed(2)} · p95 ${Math.round(value.p95LatencyMs)}ms</small><div class="pillrow">${value.weakestCases.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("")}</div></article>`,
		)
		.join("");
}
function renderWorklistCard(item: WeakCaseSummary): string {
	const state: HealthLevel =
		!item.passed ||
		item.recallAt5 < 0.5 ||
		item.bestExpectedPathRank === undefined
			? "bad"
			: "warn";
	return `<article class="worklist-row" data-health="${state}"><div><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.category)}</span></div><p>${escapeHtml(item.reason)}</p><span class="numeric">R@5 ${percent(item.recallAt5)} · MRR ${item.mrr.toFixed(2)} · ${item.latencyMs}ms</span></article>`;
}
function renderStandaloneHeader(title: string, description: string): string {
	return `<header class="tab-page-header"><div><span class="eyebrow">Atlas evaluation report</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div></header>`;
}
function renderSectionHeader(
	title: string,
	description: string,
	aside = "",
): string {
	return `<div class="section-title"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${aside ? `<div class="section-aside">${escapeHtml(aside)}</div>` : ""}</div>`;
}
function metricInfo(label: string): string {
	const metric = Object.entries(METRIC_GLOSSARY).find(
		([, value]) => value.label === label,
	)?.[0] as HealthMetric | undefined;
	return metric === undefined
		? ""
		: `<button type="button" class="info-btn" data-info-metric="${metric}" aria-label="What is ${escapeHtml(label)}?">i</button>`;
}
function runtimeLabel(report: Report): string {
	return report.runtime.source === "repo-local-artifact"
		? "repo-local artifact"
		: "local configured corpus";
}
function criterion(
	pair: Exclude<
		AgentEffectFreshness,
		{ status: "absent" }
	>["snapshot"]["pairs"][number],
	id: string,
): boolean {
	return (
		pair.judge.treatment.criteria.find((item) => item.id === id)?.passed ===
		true
	);
}
function thresholdValue(result: ReportThresholdResult, value: number): string {
	return result.metric === "p95LatencyMs" ||
		result.metric === "averageLatencyMs"
		? `${Math.round(value)}ms`
		: result.metric === "mrr"
			? value.toFixed(2)
			: percent(value, 1);
}
function isHealthMetric(
	metric: ReportThresholdResult["metric"],
): metric is HealthMetric {
	return metric in HEALTH_THRESHOLDS;
}
function deltaFor(
	report: Report,
	metric: HealthMetric,
): MetricDeltaEntry | undefined {
	return report.deltas?.entries.find((entry) => entry.metric === metric);
}
function deltaText(report: Report, metric: HealthMetric): string {
	const delta = deltaFor(report, metric);
	if (delta === undefined) return "No baseline";
	if (metric === "p95LatencyMs" || metric === "averageLatencyMs")
		return `${delta.delta >= 0 ? "+" : ""}${Math.round(delta.delta)}ms`;
	if (metric === "mrr")
		return `${delta.delta >= 0 ? "+" : ""}${delta.delta.toFixed(2)}`;
	return signedPoints(delta.delta);
}
function signedPoints(value: number): string {
	return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}
function percent(value: number, digits = 0): string {
	return `${(value * 100).toFixed(digits)}%`;
}
function health(value: number): HealthLevel {
	return value >= 0.9 ? "good" : value >= 0.7 ? "warn" : "bad";
}
function healthLabel(level: HealthLevel | "neutral"): string {
	return level === "good"
		? "Pass"
		: level === "warn"
			? "Warn"
			: level === "bad"
				? "Fail"
				: "Info";
}
function statusGlyph(level: HealthLevel): string {
	return level === "good" ? "✓" : level === "warn" ? "!" : "×";
}
function caseHealth(item: CaseResult): HealthLevel {
	return !item.passed || item.retrieval.recallAt5 < 0.5
		? "bad"
		: item.retrieval.recallAt5 < 1 ||
			  (item.retrieval.bestExpectedPathRank ?? 1) > 3
			? "warn"
			: "good";
}
function heatmapHealth(value: QualityGroupSummary): HealthLevel {
	const states = [
		classifyHealth("pathRecallAt5", value.recallAt5),
		classifyHealth("mrr", value.mrr),
		classifyHealth("passRate", value.passRate),
	];
	return states.includes("bad")
		? "bad"
		: states.includes("warn")
			? "warn"
			: "good";
}
function caseSummary(item: CaseResult): string {
	return item.expectedBehavior ?? item.claim ?? `Query: ${item.query}`;
}
function caseDiagnosis(item: CaseResult): string {
	return item.passed
		? item.retrieval.recallAt5 < 1
			? "Deterministic expectations passed, but known-good evidence has ranking headroom."
			: "The case passed deterministic retrieval expectations."
		: "One or more deterministic expectations failed; inspect the machine-readable report for missing evidence and diagnostics.";
}
function caseSearchText(item: CaseResult): string {
	return [
		item.id,
		item.category,
		item.profile,
		item.feature,
		item.riskArea,
		item.priority,
		item.coverageType,
		item.claim,
		item.expectedBehavior,
		item.query,
		...item.topPaths,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
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
function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? value
		: `${parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} ${parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}
function reportClientData(report: Report): unknown {
	return {
		quality: report.quality,
		narrative: report.narrative,
		glossary: METRIC_GLOSSARY,
		thresholds: HEALTH_THRESHOLDS,
		metrics: report.metrics,
		...(report.deltas === undefined ? {} : { deltas: report.deltas }),
		cases: report.cases.map((item) => ({
			id: item.id,
			category: item.category,
			profile: item.profile ?? "unknown",
			feature: item.feature ?? "unknown",
			riskArea: item.riskArea ?? "unknown",
			priority: item.priority ?? "unknown",
			passed: item.passed,
			query: item.query,
			claim: item.claim,
			expectedBehavior: item.expectedBehavior,
			scores: item.scores,
			retrieval: item.retrieval,
			missing: item.missing,
			topPaths: item.topPaths.slice(0, 12),
			latencyMs: item.latencyMs,
			cliLatencyMs: item.cliLatencyMs,
			rankedCount: item.rankedCount,
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
