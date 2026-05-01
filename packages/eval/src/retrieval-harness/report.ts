import {
	classifyHealth,
	formatMetricValue,
	HEALTH_THRESHOLDS,
	type HealthLevel,
	type HealthMetric,
	worstHealth,
} from "./health";
import { METRIC_GLOSSARY } from "./metric-glossary";
import type {
	BaselineSummary,
	CaseResult,
	MetricDeltaEntry,
	NarrativeFinding,
	QualityGroupSummary,
	RankBucket,
	RegressionEntry,
	Report,
	ReportDeltas,
	ReportThresholdInput,
	ReportThresholdResult,
	RuntimeInfo,
	WeakCaseSummary,
} from "./types";

interface HealthThreshold {
	readonly good: number;
	readonly warn: number;
	readonly direction?: "lower";
}

type ReportGroup = Record<
	string,
	{
		total: number;
		passed: number;
		passRate: number;
		pathRecall: number;
		termRecall: number;
		nonEmptyContextRate: number;
		averageLatencyMs: number;
		recallAt5: number;
		mrr: number;
	}
>;

export function buildReport(
	dataset: {
		name: string;
		description?: string;
		repoId?: string;
		cases?: unknown[];
	},
	cases: CaseResult[],
	runtime: RuntimeInfo,
	judge: { provider?: string; model?: string },
	thresholds: ReportThresholdInput = {},
	baseline?: BaselineSummary,
): Report {
	const passedCases = cases.filter((result) => result.passed).length;
	const rankDistances = cases
		.map((result) => result.retrieval.rankDistance)
		.filter((value): value is number => value !== undefined);
	const metrics = {
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
		modelJudge: {
			enabled: judge.provider !== undefined && judge.model !== undefined,
			...(judge.provider === undefined ? {} : { provider: judge.provider }),
			...(judge.model === undefined ? {} : { model: judge.model }),
			note: "Optional placeholder for later answer-quality grading with a cheap model such as grok-code-fast-1 via OpenRouter/xAI. Retrieval metrics run without API keys.",
		},
		researchNotes: [
			"MCPBench is the closest open-source MCP-specific benchmark, but it targets web search/database/GAIA task completion rather than local documentation retrieval, so Atlas reuses the MCP adoption idea rather than vendoring it.",
			"Promptfoo is a strong option for model/provider comparison and hosted-looking reports; this harness keeps deterministic retrieval metrics local and can export JSON for promptfoo later.",
			"Ragas and DeepEval provide RAG metrics, but add Python dependencies and LLM judges; Atlas starts with cheap deterministic path/term/latency metrics and leaves judge-model wiring optional.",
		],
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

function rankBuckets(cases: CaseResult[]): RankBucket[] {
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

function latencyBuckets(cases: CaseResult[]): RankBucket[] {
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

function weakestCases(cases: CaseResult[], limit = 10): WeakCaseSummary[] {
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

function byQualityGroup(
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

function buildNarrative(
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
	const target =
		direction === "lower"
			? `${formatMetricValue(metric, threshold.good)} / ${formatMetricValue(metric, threshold.warn)} warn`
			: `${formatMetricValue(metric, threshold.good)} / ${formatMetricValue(metric, threshold.warn)} warn`;
	return `${METRIC_GLOSSARY[metric].label} is ${formatMetricValue(metric, value)}, ${verdict}. Targets: ${target}.`;
}

function metricValue(metric: HealthMetric, metrics: Report["metrics"]): number {
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
	if (rank) {
		segments.push(`Rank: ${rank}`);
	}
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
	if (safety) {
		segments.push(`Safety: ${safety}`);
	}
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

function computeDeltas(
	metrics: Report["metrics"],
	baseline: BaselineSummary | undefined,
	tolerance: number | undefined,
): ReportDeltas | undefined {
	if (baseline === undefined) {
		return undefined;
	}
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

function evaluateRegressions(
	deltas: ReportDeltas,
	tolerance: number | undefined,
): ReportThresholdResult[] {
	if (tolerance === undefined) {
		return [];
	}
	return deltas.regressions.map((regression) => ({
		metric: regression.metric as keyof Report["metrics"],
		label: `${regression.label} regression`,
		actual: regression.delta,
		limit: regression.direction === "higher" ? -tolerance : tolerance,
		direction: regression.direction === "higher" ? "higher" : "lower",
		passed: false,
	}));
}

function byGroup(
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

function normalizeGroupKey(value: string | undefined): string {
	const trimmed = value?.trim();
	return trimmed === undefined || trimmed.length === 0 ? "unknown" : trimmed;
}

function evaluateThresholds(
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
	if (minimum === undefined) {
		return undefined;
	}
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
	if (maximum === undefined) {
		return undefined;
	}
	return {
		metric,
		label,
		actual,
		limit: maximum,
		direction: "lower",
		passed: actual <= maximum,
	};
}

function countBy(
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

function average(values: number[]): number {
	return values.length === 0
		? 0
		: round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * quantile) - 1),
	);
	return sorted[index] ?? 0;
}

function rate(
	results: CaseResult[],
	predicate: (result: CaseResult) => boolean,
): number {
	return results.length === 0
		? 0
		: round(results.filter(predicate).length / results.length);
}

function round(value: number): number {
	return Number(value.toFixed(4));
}
