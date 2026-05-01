import {
	classifyHealth,
	HEALTH_THRESHOLDS,
	type HealthLevel,
	type HealthMetric,
	severityBadge,
	worstHealth,
} from "../health";
import { METRIC_GLOSSARY } from "../metric-glossary";
import type {
	CaseResult,
	MetricDeltaEntry,
	NarrativeFinding,
	QualityGroupSummary,
	RankBucket,
	Report,
	WeakCaseSummary,
} from "../types";
import { renderReportCss } from "./css";
import { renderExplorerScript } from "./explorer-script";
import { moxelBandedFieldScript } from "./moxel-theme";

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
<main class="report-shell" data-report-shell="moxel-atlas-eval-report-theme">
${renderLabHeader(report)}
${renderVerdictCard(report)}
${renderKpiStrip(report)}
${renderInterpretation(report)}
${renderCharts(report)}
${renderCoverageLab(report)}
${renderExplorer(report)}
${renderMethodology(report)}
${renderReproducibility(report)}
${renderResearchNotes(report)}
${renderStaticFallback(report)}
</main>
<div id="info-popover" class="info-popover" role="dialog" aria-modal="false" aria-live="polite" hidden></div>
<script id="atlas-eval-report-data" type="application/json">${safeJson(reportClientData(report))}</script>
<script>${moxelBandedFieldScript}</script>
<script>${renderExplorerScript()}</script>
</body>
</html>`;
}

function renderLabHeader(report: Report): string {
	const revision = report.runtime.repoRevision
		? report.runtime.repoRevision.slice(0, 7)
		: "local";
	const timestamp = report.generatedAt.slice(0, 16).replace("T", " ");
	return `<header class="topbar"><div class="wordmark">MOXEL ATLAS EVALS</div><div class="topmeta">${escapeHtml(report.dataset)} · ${escapeHtml(timestamp)}Z · rev ${escapeHtml(revision)}</div><div class="status-pill" data-health="${escapeHtml(report.narrative.severity)}">${severityBadge(report.narrative.severity)}</div></header>`;
}

function renderVerdictCard(report: Report): string {
	const description =
		report.description ??
		"Deterministic retrieval evaluation against atlas inspect retrieval.";
	return `<section class="verdict" data-health="${escapeHtml(report.narrative.severity)}" aria-labelledby="verdict-headline"><div class="eyebrow">Atlas retrieval eval · ${report.passedCases}/${report.totalCases} deterministic cases</div><h1 id="verdict-headline">${escapeHtml(report.narrative.headline)}</h1><p class="lede">${escapeHtml(report.narrative.verdict)}</p><p class="muted">${escapeHtml(description)} Measures retrieved source evidence for Atlas docs workflows. Does not score generated answers.</p></section>`;
}

function renderKpiStrip(report: Report): string {
	const findings = report.narrative.keyFindings;
	const shown = (
		[
			"passRate",
			"pathRecallAt5",
			"mrr",
			"p95LatencyMs",
			"noResultAccuracy",
		] as HealthMetric[]
	)
		.map((metric) => findings.find((finding) => finding.metric === metric))
		.filter((finding): finding is NarrativeFinding => finding !== undefined);
	const deltaFor = (metric: HealthMetric): MetricDeltaEntry | undefined =>
		report.deltas?.entries.find((entry) => entry.metric === metric);
	return `<section class="kpi-strip" aria-label="Headline metrics">${shown
		.map((finding) => renderKpiCard(finding, deltaFor(finding.metric)))
		.join("")}</section>`;
}

function renderKpiCard(
	finding: NarrativeFinding,
	delta: MetricDeltaEntry | undefined,
): string {
	return `<article class="kpi" data-health="${escapeHtml(finding.severity)}" data-metric="${escapeHtml(finding.metric)}"><div class="kpi-label">${escapeHtml(METRIC_GLOSSARY[finding.metric].label)}${renderInfoButton(finding.metric)}</div><strong class="kpi-value">${escapeHtml(finding.value)}</strong><small class="kpi-desc">${escapeHtml(
		METRIC_GLOSSARY[finding.metric].short.split(".")[0] ?? "",
	)}</small>${delta ? renderKpiDelta(delta) : ""}</article>`;
}

function renderKpiDelta(delta: MetricDeltaEntry): string {
	const magnitude = formatDeltaMagnitude(delta.metric, delta.delta);
	const isFlat = Math.abs(delta.delta) < 1e-9;
	const isImprovement =
		!isFlat &&
		(delta.direction === "higher" ? delta.delta > 0 : delta.delta < 0);
	const arrow = isFlat ? "·" : delta.delta > 0 ? "▲" : "▼";
	const trend = isFlat
		? "flat"
		: delta.delta > 0
			? isImprovement
				? "up-good"
				: "up-bad"
			: isImprovement
				? "down-good"
				: "down-bad";
	return `<span class="kpi-delta" data-trend="${escapeHtml(trend)}" title="vs baseline">${arrow} ${escapeHtml(magnitude)} vs baseline</span>`;
}

function renderInfoButton(metric: HealthMetric): string {
	return `<button type="button" class="info-btn" data-info-metric="${escapeHtml(metric)}" aria-label="What is ${escapeHtml(METRIC_GLOSSARY[metric].label)}?">i</button>`;
}

function renderInterpretation(report: Report): string {
	const severity = report.narrative.severity;
	return `<section class="panel callout" data-health="${escapeHtml(severity)}"><div class="eyebrow">Interpretation</div><h2>${escapeHtml(report.narrative.headline)}</h2><ul class="findings-list">${report.narrative.keyFindings
		.map(
			(finding) =>
				`<li class="finding" data-health="${escapeHtml(finding.severity)}"><span class="finding-label">${escapeHtml(finding.label)}${renderInfoButton(finding.metric)}</span><span class="finding-value" data-health="${escapeHtml(finding.severity)}">${escapeHtml(finding.value)}</span><span class="tag" data-health="${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span><span class="finding-msg">${escapeHtml(finding.message)}</span></li>`,
		)
		.join("")}</ul>${
		report.narrative.attentionAreas.length === 0
			? ""
			: `<h3>Attention areas</h3><ul class="attention-list">${report.narrative.attentionAreas
					.map(
						(area) =>
							`<li data-health="${escapeHtml(area.severity)}">${escapeHtml(area.message)}</li>`,
					)
					.join("")}</ul>`
	}<p class="muted">${report.narrative.caveats.map(escapeHtml).join(" ")}</p></section>`;
}

function renderCharts(report: Report): string {
	const recallBars: Array<[string, number, HealthMetric]> = [
		["Recall@1", report.metrics.pathRecallAt1, "pathRecallAt1"],
		["Recall@3", report.metrics.pathRecallAt3, "pathRecallAt3"],
		["Recall@5", report.metrics.pathRecallAt5, "pathRecallAt5"],
		[
			"Expected-path P@5",
			report.metrics.expectedPathPrecisionAt5,
			"expectedPathPrecisionAt5",
		],
		[
			"Expected-path nDCG@5",
			report.metrics.expectedPathNdcgAt5,
			"expectedPathNdcgAt5",
		],
	];
	const recallSeverity = worstHealth(
		recallBars.map(([, value, metric]) => classifyHealth(metric, value)),
	);
	const rankBucketsHealth = rankBucketHealth(report.quality.rankBuckets);
	const rankBucketSeverity = worstBucketSeverity(rankBucketsHealth);
	const latencyBucketsHealth = latencyBucketHealth(
		report.quality.latencyBuckets,
	);
	const latencyBucketSeverity = worstBucketSeverity(latencyBucketsHealth);
	const latencyHealth = classifyHealth(
		"p95LatencyMs",
		report.metrics.p95LatencyMs,
	);
	const recallLine: Array<[string, number, HealthLevel]> = recallBars.map(
		([label, value, metric]) => [label, value, classifyHealth(metric, value)],
	);
	return `<section class="chart-grid"><article class="panel chart-panel" data-eval-chart="recall-funnel" data-health="${escapeHtml(recallSeverity)}"><h2>Recall and sparse-label rank quality${renderInfoButton("pathRecallAt5")}</h2>${renderLineSvg(recallLine)}<p class="chart-caption">Recall@k asks: did known-good paths appear by rank k? Expected-path precision/nDCG are sparse-label lower bounds, not full relevance judgments.</p><div class="bars">${recallBars
		.map(([label, value, metric]) =>
			renderProgress(label, value, classifyHealth(metric, value)),
		)
		.join(
			"",
		)}</div></article><article class="panel chart-panel" data-eval-chart="rank-buckets" data-health="${escapeHtml(rankBucketSeverity)}"><h2>First expected path rank${renderInfoButton("mrr")}</h2>${renderBucketSvg(report.quality.rankBuckets, "cases", rankBucketsHealth)}<p class="chart-caption">Lower ranks are better. Missing/no-label bucket includes abstain cases or cases without a first expected path.</p></article><article class="panel chart-panel" data-eval-chart="latency-buckets" data-health="${escapeHtml(latencyBucketSeverity)}"><h2>Retrieval latency distribution${renderInfoButton("p95LatencyMs")}</h2>${renderBucketSvg(report.quality.latencyBuckets, "cases", latencyBucketsHealth)}<p class="chart-caption">Retrieval engine time only. p95: ${Math.round(report.metrics.p95LatencyMs)}ms (${escapeHtml(latencyHealth)}), median: ${Math.round(report.metrics.medianLatencyMs)}ms. Spawned CLI round-trip p95: ${Math.round(report.metrics.p95CliLatencyMs)}ms.</p></article><article class="panel chart-panel" data-eval-chart="safety-bars" data-health="${escapeHtml(
		worstHealth([
			classifyHealth("noResultAccuracy", report.metrics.noResultAccuracy),
			classifyHealth(
				"forbiddenPathAccuracy",
				report.metrics.forbiddenPathAccuracy,
			),
			classifyHealth("termRecall", report.metrics.termRecall),
			classifyHealth("nonEmptyContextRate", report.metrics.nonEmptyContextRate),
		]),
	)}"><h2>Safety and context${renderInfoButton("forbiddenPathAccuracy")}</h2><p class="chart-caption">Abstain and forbidden-path accuracy track whether Atlas refuses to leak. Term recall and non-empty context track whether it found anything useful at all.</p><div class="bars">${safetyBars(report).join("")}</div></article></section>`;
}

function rankBucketHealth(buckets: RankBucket[]): HealthLevel[] {
	return buckets.map((bucket) => {
		if (bucket.bucket === "rank-1") return "good";
		if (bucket.bucket === "rank-2-3") return "good";
		if (bucket.bucket === "rank-4-5") return "warn";
		if (bucket.bucket === "rank-6-10") return "bad";
		if (bucket.bucket === "rank-gt-10") return "bad";
		return "warn";
	});
}

function latencyBucketHealth(buckets: RankBucket[]): HealthLevel[] {
	return buckets.map((bucket) => {
		if (bucket.bucket === "latency-lte-250") return "good";
		if (bucket.bucket === "latency-251-500") return "good";
		if (bucket.bucket === "latency-501-1000") return "warn";
		return "bad";
	});
}

function worstBucketSeverity(levels: HealthLevel[]): HealthLevel {
	return levels.reduce<HealthLevel>((worst, level) => {
		if (level === "bad") return "bad";
		if (level === "warn" && worst === "good") return "warn";
		return worst;
	}, "good");
}

function safetyBars(report: Report): string[] {
	return [
		renderProgress(
			"Abstain accuracy",
			report.metrics.noResultAccuracy,
			classifyHealth("noResultAccuracy", report.metrics.noResultAccuracy),
		),
		renderProgress(
			"Forbidden-path accuracy",
			report.metrics.forbiddenPathAccuracy,
			classifyHealth(
				"forbiddenPathAccuracy",
				report.metrics.forbiddenPathAccuracy,
			),
		),
		renderProgress(
			"Term recall",
			report.metrics.termRecall,
			classifyHealth("termRecall", report.metrics.termRecall),
		),
		renderProgress(
			"Non-empty context",
			report.metrics.nonEmptyContextRate,
			classifyHealth("nonEmptyContextRate", report.metrics.nonEmptyContextRate),
		),
	];
}

function renderCoverageLab(report: Report): string {
	return `<section class="panel" data-eval-chart="coverage-heatmap"><div class="case-head"><div><div class="eyebrow">Coverage heatmap</div><h2 id="quality-title">Quality by capability</h2></div><select id="quality-group" aria-label="Change coverage heatmap group"><option value="byCapability">Capability</option><option value="byRiskArea">Risk area</option><option value="byProfile">Profile</option><option value="byCategory">Category</option><option value="byPriority">Priority</option><option value="byCoverageType">Coverage type</option></select></div><div id="quality-heatmap" class="heatmap">${renderHeatmap(report.quality.byCapability)}</div></section><section class="panel"><h2>Ranking worklist</h2><p class="muted">Cases below passed deterministic gates but known-good evidence was missing from top five, not first, or slow. Use these to improve retrieval order.</p><div class="case-list">${report.quality.weakestCases.map(renderWorklistCard).join("")}</div></section>`;
}

function renderWorklistCard(item: WeakCaseSummary): string {
	const health: HealthLevel = !item.passed
		? "bad"
		: item.recallAt5 < 0.5 || item.bestExpectedPathRank === undefined
			? "bad"
			: "warn";
	return `<article class="case-card" data-health="${escapeHtml(health)}"><div class="case-head"><strong>${escapeHtml(item.id)}</strong><span class="tag" data-health="${escapeHtml(health)}">${escapeHtml(item.reason)}</span></div><p class="muted">${escapeHtml(item.category)} · Recall@5 ${percent(item.recallAt5)} · MRR ${item.mrr.toFixed(2)} · rank ${item.bestExpectedPathRank ?? "missing"} · ${item.latencyMs}ms</p></article>`;
}

function heatmapHealth(value: QualityGroupSummary): HealthLevel {
	const recallHealth = classifyHealth("pathRecallAt5", value.recallAt5);
	const mrrHealth = classifyHealth("mrr", value.mrr);
	const passHealth = classifyHealth("passRate", value.passRate);
	return worstHealth([recallHealth, mrrHealth, passHealth]);
}

function renderHeatmap(group: Record<string, QualityGroupSummary>): string {
	return Object.entries(group)
		.map(([name, value]) => {
			const heat = Math.max(
				0.08,
				Math.min(0.45, value.recallAt5 * 0.35 + value.mrr * 0.1),
			);
			const health = heatmapHealth(value);
			return `<article class="heat" data-health="${escapeHtml(health)}" style="--heat:${heat}"><strong>${escapeHtml(name)}</strong><span class="muted">${value.passed}/${value.total} pass · R@5 ${percent(value.recallAt5)} · MRR ${value.mrr.toFixed(2)} · p95 ${Math.round(value.p95LatencyMs)}ms</span><div class="pillrow">${value.weakestCases.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("")}</div></article>`;
		})
		.join("");
}

function renderExplorer(report: Report): string {
	const categories = optionList(unique(report.cases.map((c) => c.category)));
	const profiles = optionList(
		unique(report.cases.map((c) => c.profile ?? "unknown")),
	);
	const risks = optionList(
		unique(report.cases.map((c) => c.riskArea ?? "unknown")),
	);
	return `<section class="panel" id="case-explorer"><div class="eyebrow">Case explorer</div><h2>Filter failed expectations, rank gaps, and source paths.</h2><div class="controls" role="search"><div class="control"><label for="case-search">Search cases, paths, query text</label><input id="case-search" type="search" placeholder="mcp, privacy, docs/evals.md, case id" /></div><div class="control"><label for="filter-category">Category</label><select id="filter-category"><option value="">All</option>${categories}</select></div><div class="control"><label for="filter-profile">Profile</label><select id="filter-profile"><option value="">All</option>${profiles}</select></div><div class="control"><label for="filter-risk">Risk</label><select id="filter-risk"><option value="">All</option>${risks}</select></div><div class="control"><label for="case-sort">Sort</label><select id="case-sort"><option value="weakest">Weakest rank</option><option value="recallAt5">Recall@5</option><option value="mrr">MRR</option><option value="latency">Latency</option><option value="ranked">Ranked hits</option><option value="id">Case ID</option></select></div><button id="clear-filters" type="button">Clear</button></div><p class="muted"><span id="visible-count">${report.cases.length}</span> of ${report.cases.length} cases visible. List is contained so report does not become one huge scroll dump.</p><div id="empty-state" class="empty">No cases match filters. Clear filters to reset.</div><div id="case-list" class="case-list">${report.cases.map(renderCaseCard).join("")}</div></section>`;
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

function renderCaseCard(testCase: CaseResult): string {
	const health = caseHealth(testCase);
	const status = !testCase.passed
		? "fail"
		: testCase.retrieval.recallAt5 < 1
			? "pass · rank headroom"
			: "pass";
	const summary = caseSummary(testCase);
	const recallHealth = classifyHealth(
		"pathRecallAt5",
		testCase.retrieval.recallAt5,
	);
	const mrrHealth = classifyHealth("mrr", testCase.retrieval.reciprocalRank);
	const latencyHealth = classifyHealth("p95LatencyMs", testCase.latencyMs);
	return `<article class="case-card" data-case-card data-health="${escapeHtml(health)}" data-id="${escapeHtml(testCase.id)}" data-category="${escapeHtml(testCase.category)}" data-profile="${escapeHtml(testCase.profile ?? "unknown")}" data-risk="${escapeHtml(testCase.riskArea ?? "unknown")}" data-recall="${testCase.retrieval.recallAt5}" data-mrr="${testCase.retrieval.reciprocalRank}" data-latency="${testCase.latencyMs}" data-ranked="${testCase.rankedCount}" data-search="${escapeHtml(caseSearchText(testCase))}"><div class="case-head"><h3 class="case-title">${escapeHtml(testCase.id)} · <span class="tag" data-health="${escapeHtml(health)}">${escapeHtml(status)}</span></h3><button type="button" class="copy-case" data-copy-id="${escapeHtml(testCase.id)}">Copy JSON</button></div>${renderMetadataPills(testCase)}<p class="case-summary">${escapeHtml(summary)}</p><div class="scoreline"><span class="tag">R@1 ${percent(testCase.retrieval.recallAt1)}</span><span class="tag" data-health="${escapeHtml(recallHealth)}">R@5 ${percent(testCase.retrieval.recallAt5)}</span><span class="tag" data-health="${escapeHtml(mrrHealth)}">MRR ${testCase.retrieval.reciprocalRank.toFixed(2)}</span><span class="tag">Rank ${testCase.retrieval.bestExpectedPathRank ?? "missing"}</span><span class="tag" data-health="${escapeHtml(latencyHealth)}">${testCase.latencyMs}ms</span><span class="tag">Diversity ${testCase.retrieval.topPathDiversity}/5</span></div><details><summary>Open evidence</summary><p><b>Query:</b> ${escapeHtml(testCase.query)}</p><div class="cols"><div><b>Expected behavior</b><pre>${escapeHtml(testCase.expectedBehavior ?? "Required paths/terms present; forbidden paths absent; no-result behavior correct when expected.")}</pre></div><div><b>Top paths</b><pre>${escapeHtml(formatList(testCase.topPaths.slice(0, 10)))}</pre></div><div><b>Missing fields</b><pre>${escapeHtml(JSON.stringify(testCase.missing, null, 2))}</pre></div><div><b>Diagnostics</b><pre>${escapeHtml(summarizeDiagnostics(testCase.diagnostics))}</pre></div></div></details></article>`;
}

function caseHealth(testCase: CaseResult): HealthLevel {
	if (!testCase.passed) return "bad";
	if (testCase.retrieval.recallAt5 < 0.5) return "bad";
	if (testCase.retrieval.recallAt5 < 1) return "warn";
	if (
		testCase.retrieval.bestExpectedPathRank !== undefined &&
		testCase.retrieval.bestExpectedPathRank > 3
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

function renderMetadataPills(testCase: CaseResult): string {
	const metadata: Array<[string, string]> = [
		["category", testCase.category],
		["profile", testCase.profile ?? "unknown"],
		["feature", testCase.feature ?? "unknown"],
		["risk", testCase.riskArea ?? "unknown"],
		["priority", testCase.priority ?? "unknown"],
	];
	return `<div class="pillrow">${metadata
		.map(
			([label, value]) =>
				`<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`,
		)
		.join("")}</div>`;
}

function renderMethodology(report: Report): string {
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Methodology</div><strong>Metric definitions and limitations</strong></div><span class="tag">expand</span></summary><h3>Eval unit</h3><p class="muted">One user-like query against <code>atlas inspect retrieval</code>. Pass means every deterministic expectation passed: required paths, terms, exclusions, diagnostics, confidence, hit bounds, and no-result behavior.</p><h3>Metrics</h3><ul><li><b>Recall@k:</b> fraction of expected path substrings found in top-k paths.</li><li><b>Expected-path Precision@k:</b> lower-bound proportion of top-k paths matching sparse expected labels; unlabeled relevant docs may exist.</li><li><b>Expected-path nDCG@k:</b> rank-sensitive binary relevance over sparse expected paths.</li><li><b>MRR:</b> reciprocal rank of first expected path, averaged across cases.</li><li><b>Rank distance:</b> per-case <code>bestExpectedPathRank - 1</code>, averaged; lower is better.</li><li><b>Top-path diversity:</b> distinct parent directory count among top-5 retrieved paths.</li><li><b>Retrieval latency:</b> engine time inside inspect retrieval. Median ${Math.round(report.metrics.medianLatencyMs)}ms; p95 ${Math.round(report.metrics.p95LatencyMs)}ms.</li><li><b>CLI round-trip:</b> spawned per-case eval command including startup and JSON IO. Median ${Math.round(report.metrics.medianCliLatencyMs)}ms; p95 ${Math.round(report.metrics.p95CliLatencyMs)}ms.</li></ul><h3>Limitations</h3><ul>${report.narrative.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("")}</ul></details>`;
}

function renderReproducibility(report: Report): string {
	const command = "bun run eval";
	const items: Array<[string, string]> = [
		["Dataset", report.runtime.datasetPath ?? report.dataset],
		["CLI", report.runtime.cli],
		["Corpus", report.runtime.corpusDbPath ?? "CLI default"],
		["Docs", String(report.runtime.docCount ?? "unknown")],
		["Runtime source", report.runtime.source],
		["Execution mode", report.runtime.executionMode ?? "spawn-cli"],
		["Repo revision", report.runtime.repoRevision ?? "unknown"],
		["Indexed revision", report.runtime.indexedRevision ?? "unknown"],
	];
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Reproducibility</div><strong><code>${escapeHtml(command)}</code></strong></div><button type="button" data-copy-text="${escapeHtml(command)}">Copy</button></summary><p class="muted">Local-first command and runtime metadata.</p><div class="heatmap">${items
		.map(
			([label, value]) =>
				`<div class="heat" style="--heat:.08"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
		)
		.join(
			"",
		)}</div><p><a href="mcp-retrieval-report.json">Machine-readable JSON report</a> · <a href="../../docs/evals.md">Interpretation guide</a></p></details>`;
}

function renderResearchNotes(report: Report): string {
	if (report.researchNotes.length === 0) {
		return "";
	}
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Research context</div><strong>Why Atlas ships its own harness</strong></div><span class="tag">expand</span></summary><ul>${report.researchNotes
		.map((note) => `<li>${escapeHtml(note)}</li>`)
		.join("")}</ul></details>`;
}

function renderStaticFallback(report: Report): string {
	return `<details class="panel fallback"><summary><div class="fallback-summary"><div><div class="eyebrow">Static appendix</div><h2>All case rows</h2></div><span class="tag">Collapsed by default</span></div></summary><p class="muted">Raw readable backup for users with JavaScript disabled. Main explorer above is preferred.</p><div class="table-wrap"><table><thead><tr><th>Status</th><th>ID</th><th>Case</th><th>Scores</th><th>Evidence</th></tr></thead><tbody>${report.cases.map(renderCaseRow).join("")}</tbody></table></div></details>`;
}

function renderCaseRow(testCase: CaseResult): string {
	return `<tr><td>${testCase.passed ? "pass" : "fail"}</td><td><code>${escapeHtml(testCase.id)}</code></td><td>${escapeHtml(caseSummary(testCase))}</td><td>R@1 ${percent(testCase.retrieval.recallAt1)}<br>R@5 ${percent(testCase.retrieval.recallAt5)}<br>MRR ${testCase.retrieval.reciprocalRank}</td><td><pre>${escapeHtml(testCase.topPaths.slice(0, 4).join("\n"))}</pre></td></tr>`;
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
		.replace(
			/[<>&]/g,
			(char) =>
				({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" })[char] ?? char,
		)
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

function formatList(values: string[]): string {
	return values.length === 0 ? "None" : values.join("\n");
}

function summarizeDiagnostics(diagnostics: unknown[]): string {
	return diagnostics.length === 0
		? "None"
		: JSON.stringify(diagnostics.slice(0, 5), null, 2);
}

function renderLineSvg(metrics: Array<[string, number, HealthLevel]>): string {
	const width = 360;
	const height = 200;
	const padding = 28;
	const xStep =
		metrics.length <= 1 ? 1 : (width - padding * 2) / (metrics.length - 1);
	const points = metrics
		.map(([, value], index) => {
			const x = padding + xStep * index;
			const y =
				padding +
				(height - padding * 2) * (1 - Math.max(0, Math.min(1, value)));
			return `${round(x)},${round(y)}`;
		})
		.join(" ");
	return `<div class="chart-frame"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recall line chart"><defs><linearGradient id="line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#35f0ff"/><stop offset="1" stop-color="#6df2d6"/></linearGradient></defs><polyline points="${points}" fill="none" stroke="url(#line)" stroke-width="3"/><g>${metrics
		.map(([label, value, health], index) => {
			const x = padding + xStep * index;
			const y =
				padding +
				(height - padding * 2) * (1 - Math.max(0, Math.min(1, value)));
			const color = colorFor(health);
			return `<circle cx="${round(x)}" cy="${round(y)}" r="5" fill="${color}" stroke="#030711" stroke-width="1.5"><title>${escapeHtml(label)} ${percent(value)} (${escapeHtml(health)})</title></circle>`;
		})
		.join("")}</g><g>${metrics
		.map(([label], index) => {
			const x = padding + xStep * index;
			return `<text x="${round(x)}" y="${height - 10}" text-anchor="middle" fill="rgba(245,248,255,.76)" font-size="11" font-weight="800">${escapeHtml(label)}</text>`;
		})
		.join("")}</g></svg></div>`;
}

function renderBucketSvg(
	buckets: RankBucket[],
	axisLabel: string,
	health: HealthLevel[],
): string {
	const width = 360;
	const height = 200;
	const padding = 28;
	const barWidth = Math.floor((width - padding * 2) / buckets.length) - 10;
	const maxCount = Math.max(1, ...buckets.map((b) => b.count));
	return `<div class="chart-frame"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bucket chart"><g>${buckets
		.map((bucket, index) => {
			const x = padding + index * (barWidth + 10);
			const barHeight = Math.round(
				((height - padding * 2 - 22) * bucket.count) / maxCount,
			);
			const y = height - padding - 22 - barHeight;
			const color = colorFor(health[index] ?? "good");
			return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="10" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="2"/><text x="${x + barWidth / 2}" y="${height - padding - 6}" text-anchor="middle" fill="rgba(245,248,255,.76)" font-size="11" font-weight="800">${escapeHtml(bucket.label)}</text><text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" fill="rgba(245,248,255,.82)" font-size="11" font-weight="800">${bucket.count}</text><title>${escapeHtml(bucket.label)}: ${bucket.count} ${escapeHtml(axisLabel)}</title>`;
		})
		.join("")}</g></svg></div>`;
}


function renderProgress(
	label: string,
	value: number,
	health?: HealthLevel,
): string {
	const width = Math.max(0, Math.min(100, Math.round(value * 100)));
	const healthAttr = health ? ` data-health="${escapeHtml(health)}"` : "";
	return `<div class="bar"><span>${escapeHtml(label)}</span><div class="track"><div class="fill"${healthAttr} style="width:${width}%"></div></div><strong>${percent(value)}</strong></div>`;
}

function colorFor(health: HealthLevel): string {
	if (health === "bad") return "#ff6b8a";
	if (health === "warn") return "#ffd166";
	return "#6df2d6";
}

function formatDeltaMagnitude(metric: string, delta: number): string {
	if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
		return `${delta > 0 ? "+" : ""}${Math.round(delta)}ms`;
	}
	const pct = Math.round(delta * 100);
	return `${pct > 0 ? "+" : ""}${pct}pp`;
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function round(value: number): number {
	return Number(value.toFixed(4));
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
