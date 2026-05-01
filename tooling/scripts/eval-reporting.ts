export * from "../../packages/eval/src/retrieval-harness";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { moxelBandedFieldScript } from "../../apps/server/src/openapi/moxel-theme";

// ============================================================================
// Health classification
// ============================================================================

export type HealthLevel = "good" | "warn" | "bad";

interface HealthThreshold {
	readonly good: number;
	readonly warn: number;
	readonly direction?: "lower";
}

export const HEALTH_THRESHOLDS = {
	passRate: { good: 1.0, warn: 0.95 },
	pathRecall: { good: 0.95, warn: 0.85 },
	termRecall: { good: 0.95, warn: 0.85 },
	nonEmptyContextRate: { good: 1.0, warn: 0.95 },
	pathRecallAt1: { good: 0.6, warn: 0.35 },
	pathRecallAt3: { good: 0.75, warn: 0.5 },
	pathRecallAt5: { good: 0.8, warn: 0.6 },
	expectedPathPrecisionAt5: { good: 0.3, warn: 0.15 },
	expectedPathNdcgAt5: { good: 0.5, warn: 0.25 },
	mrr: { good: 0.6, warn: 0.35 },
	p95LatencyMs: { good: 500, warn: 1000, direction: "lower" },
	averageLatencyMs: { good: 300, warn: 700, direction: "lower" },
	noResultAccuracy: { good: 1.0, warn: 0.95 },
	forbiddenPathAccuracy: { good: 1.0, warn: 0.95 },
} as const satisfies Record<string, HealthThreshold>;

export type HealthMetric = keyof typeof HEALTH_THRESHOLDS;

const SEVERITY_ORDER: Record<HealthLevel, number> = {
	good: 0,
	warn: 1,
	bad: 2,
};

export function classifyHealth(
	metric: HealthMetric,
	value: number,
): HealthLevel {
	const threshold = HEALTH_THRESHOLDS[metric] as HealthThreshold;
	if (threshold.direction === "lower") {
		if (value <= threshold.good) return "good";
		if (value <= threshold.warn) return "warn";
		return "bad";
	}
	if (value >= threshold.good) return "good";
	if (value >= threshold.warn) return "warn";
	return "bad";
}

function worstHealth(levels: HealthLevel[]): HealthLevel {
	return levels.reduce<HealthLevel>(
		(worst, level) =>
			SEVERITY_ORDER[level] > SEVERITY_ORDER[worst] ? level : worst,
		"good",
	);
}

function severityBadge(level: HealthLevel): string {
	if (level === "bad") return "BROKEN";
	if (level === "warn") return "NEEDS WORK";
	return "PASSING";
}

function formatMetricValue(metric: HealthMetric, value: number): string {
	if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
		return `${Math.round(value)}ms`;
	}
	if (metric === "mrr") {
		return value.toFixed(2);
	}
	return `${Math.round(value * 100)}%`;
}

function formatThresholdTarget(metric: HealthMetric): string {
	const threshold = HEALTH_THRESHOLDS[metric] as HealthThreshold;
	if (threshold.direction === "lower") {
		return `good ≤ ${formatMetricValue(metric, threshold.good)}, warn ≤ ${formatMetricValue(metric, threshold.warn)}`;
	}
	return `good ≥ ${formatMetricValue(metric, threshold.good)}, warn ≥ ${formatMetricValue(metric, threshold.warn)}`;
}

// ============================================================================
// Metric glossary (drives the inline (i) popovers)
// ============================================================================

export interface MetricGlossaryEntry {
	readonly label: string;
	readonly short: string;
	readonly long: string;
	readonly interpretation: string;
	readonly targets: string;
}

export const METRIC_GLOSSARY: Record<HealthMetric, MetricGlossaryEntry> = {
	passRate: {
		label: "Pass rate",
		short:
			"Fraction of cases that passed every deterministic expectation declared in the dataset.",
		long: "Each case declares required path substrings, required terms, forbidden paths, diagnostic markers, and optional no-result behavior. Pass means every gate passed. It does not say anything about rank order.",
		interpretation:
			"Drops usually mean a corpus regression (paths moved or docs deleted) or a new case with a broken expectation, not a ranker bug.",
		targets: "",
	},
	pathRecall: {
		label: "Path recall",
		short:
			"Fraction of expected path substrings found anywhere in the top retrieved paths.",
		long: "This is the coarse recall signal that tolerates ranking noise. Recall@k is the rank-aware variant you usually want.",
		interpretation:
			"If this is red, Atlas is missing known-good evidence entirely. Check corpus ingest and filters.",
		targets: "",
	},
	termRecall: {
		label: "Term recall",
		short:
			"Fraction of expected terms found in the selected/ranked context or in the retrieved source contents.",
		long: "Uses the concatenated ranked hits, selected hits, context packet, and local file contents of retrieved paths as the haystack.",
		interpretation:
			"Red usually means the docs exist but the terms have been renamed/moved, or context packing dropped them.",
		targets: "",
	},
	nonEmptyContextRate: {
		label: "Non-empty context",
		short: "Fraction of cases where Atlas returned any selected or ranked hit.",
		long: "No-result cases that explicitly expect empty results are still considered non-empty-context-correct when they abstain.",
		interpretation:
			"Red on a normal case means retrieval returned nothing. Red on a no-result case means Atlas refused to abstain when it should have.",
		targets: "",
	},
	pathRecallAt1: {
		label: "Recall@1",
		short:
			"Fraction of expected paths that appear as the single top-ranked result.",
		long: "Strictest rank quality signal. Answers: did we put the right file first?",
		interpretation:
			"Red means the ranker is not surfacing known-good evidence at position 1 even when it has the doc indexed.",
		targets: "",
	},
	pathRecallAt3: {
		label: "Recall@3",
		short: "Fraction of expected paths in the top 3 retrieved paths.",
		long: "Practical first-glance window most agents actually read.",
		interpretation:
			"Red here plus green Recall@5 means evidence is indexed but pushed past the first screenful.",
		targets: "",
	},
	pathRecallAt5: {
		label: "Recall@5",
		short: "Fraction of expected paths in the top 5 retrieved paths.",
		long: "Default reading-window metric. Expected paths are substring labels declared per case.",
		interpretation:
			"Red means the ranker is dropping known-good docs outside the reading window. Fix ranking signals, not the index.",
		targets: "",
	},
	expectedPathPrecisionAt5: {
		label: "Expected-path P@5",
		short: "Lower-bound sparse-label precision over top-5 retrieved paths.",
		long: "Only labeled expected paths are treated as relevant. Unlabeled but genuinely relevant docs make true precision higher. Do not compare across datasets with different label densities.",
		interpretation:
			"Use for trending within the same dataset. Drops suggest top-5 is dominated by off-topic paths.",
		targets: "",
	},
	expectedPathNdcgAt5: {
		label: "Expected-path nDCG@5",
		short: "Rank-sensitive binary relevance over sparse expected path labels.",
		long: "Rewards earlier expected paths more than later ones. Sparse labels mean this is a lower bound on true nDCG.",
		interpretation:
			"Drops mean known-good paths moved later in the list even if they are still inside top-5.",
		targets: "",
	},
	mrr: {
		label: "MRR",
		short: "Mean reciprocal rank of the first expected path.",
		long: "Averages 1 / rank of the first labeled hit across cases. Missing-label cases contribute 0.",
		interpretation:
			"Best single number for 'how early does Atlas put the right doc'. Red means expected evidence is consistently past rank 3.",
		targets: "",
	},
	p95LatencyMs: {
		label: "p95 latency",
		short:
			"95th-percentile wall-clock time of the local CLI retrieval call, per case.",
		long: "Measured end-to-end inside the eval harness. Includes CLI process spawn on each case; a long-lived server process would be faster.",
		interpretation:
			"Red means the slowest tail is dragging; often corpus-size sensitive. Amber on this page is fine for local dev; CI gate is looser.",
		targets: "",
	},
	averageLatencyMs: {
		label: "Avg latency",
		short: "Arithmetic mean of per-case retrieval latency.",
		long: "Pair with p95 to see whether slowness is uniform or tail-heavy.",
		interpretation:
			"Red average usually tracks cold-start overhead or an oversized corpus window.",
		targets: "",
	},
	noResultAccuracy: {
		label: "Abstain accuracy",
		short:
			"Fraction of cases where Atlas correctly abstained from returning hits.",
		long: "Only counts cases that explicitly declare noResults=true. Pass means zero selected and zero ranked hits for those cases.",
		interpretation:
			"Red means Atlas is inventing evidence on queries that should return nothing. Safety regression.",
		targets: "",
	},
	forbiddenPathAccuracy: {
		label: "Forbidden-path accuracy",
		short:
			"Fraction of cases that kept excluded paths out of the top retrieved list.",
		long: "Excluded path substrings come from the case definition. Negative/edge cases use this to guard against surfacing archived or private docs.",
		interpretation:
			"Red means retrieval leaked a path it was told to avoid. Also a safety regression.",
		targets: "",
	},
};

for (const metric of Object.keys(METRIC_GLOSSARY) as HealthMetric[]) {
	(METRIC_GLOSSARY[metric] as { targets: string }).targets =
		formatThresholdTarget(metric);
}

export interface EvalDataset {
	name: string;
	description?: string;
	repoId?: string;
	includes?: string[];
	cases: EvalCase[];
}

export interface EvalCaseMetadata {
	profile?: string;
	feature?: string;
	scenario?: string;
	priority?: string;
	capability?: string;
	claim?: string;
	whyItMatters?: string;
	expectedBehavior?: string;
	coverageType?: string;
	riskArea?: string;
}

export interface EvalCase extends EvalCaseMetadata {
	id: string;
	category: string;
	query: string;
	repoId?: string;
	expected: EvalExpected;
}

export interface EvalExpected {
	pathIncludes?: string[];
	pathExcludes?: string[];
	terms?: string[];
	tools?: string[];
	noResults?: boolean;
	minRankedHits?: number;
	maxRankedHits?: number;
	confidence?: string;
	diagnosticsInclude?: string[];
}

export interface CaseResult extends EvalCaseMetadata {
	id: string;
	category: string;
	query: string;
	passed: boolean;
	latencyMs: number;
	selectedCount: number;
	rankedCount: number;
	confidence?: string;
	scores: {
		pathRecall: number;
		termRecall: number;
		nonEmptyContext: boolean;
	};
	retrieval: {
		expectedPathRanks: number[];
		bestExpectedPathRank?: number;
		recallAt1: number;
		recallAt3: number;
		recallAt5: number;
		reciprocalRank: number;
		precisionAt1: number;
		precisionAt3: number;
		precisionAt5: number;
		ndcgAt3: number;
		ndcgAt5: number;
		rankDistance?: number;
		topPathDiversity: number;
		noResultCorrect: boolean;
		forbiddenPathCorrect: boolean;
	};
	missing: {
		pathIncludes: string[];
		pathExcludes: string[];
		terms: string[];
		diagnosticsInclude: string[];
		rankedHits: string[];
		confidence: string[];
		noResults: string[];
	};
	topPaths: string[];
	diagnostics: unknown[];
}

export interface RuntimeInfo {
	cli: string;
	configPath?: string;
	corpusDbPath?: string;
	datasetPath?: string;
	repoId?: string;
	repoRevision?: string;
	indexedRevision?: string;
	docCount?: number;
	source: "repo-local-artifact" | "explicit-config" | "cli-default";
	executionMode?: "direct" | "spawn-cli";
}

export interface ReportThresholdInput {
	minPassRate?: number;
	minPathRecall?: number;
	minTermRecall?: number;
	minNonEmptyContextRate?: number;
	minRecallAt1?: number;
	minRecallAt3?: number;
	minRecallAt5?: number;
	minMrr?: number;
	minNoResultAccuracy?: number;
	minForbiddenPathAccuracy?: number;
	maxP95LatencyMs?: number;
	maxAverageLatencyMs?: number;
	maxMetricRegression?: number;
}

export interface ReportThresholdResult {
	metric: keyof Report["metrics"];
	label: string;
	actual: number;
	limit: number;
	direction: "higher" | "lower";
	passed: boolean;
}

export interface BaselineSummary {
	metrics: Partial<Report["metrics"]>;
	generatedAt?: string;
	repoRevision?: string;
	dataset?: string;
}

export interface MetricDeltaEntry {
	metric: HealthMetric;
	label: string;
	current: number;
	baseline: number;
	delta: number;
	direction: "higher" | "lower";
	severity: HealthLevel;
}

export interface RegressionEntry {
	metric: HealthMetric;
	label: string;
	delta: number;
	tolerance: number;
	direction: "higher" | "lower";
}

export interface ReportDeltas {
	baseline: { generatedAt?: string; repoRevision?: string; dataset?: string };
	entries: MetricDeltaEntry[];
	regressions: RegressionEntry[];
}

export interface NarrativeFinding {
	metric: HealthMetric;
	label: string;
	value: string;
	severity: HealthLevel;
	message: string;
}

export interface AttentionArea {
	severity: HealthLevel;
	message: string;
	metric?: HealthMetric;
	caseId?: string;
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

export interface RankBucket {
	bucket: string;
	label: string;
	count: number;
	rate: number;
}

export interface QualityGroupSummary {
	total: number;
	passed: number;
	passRate: number;
	recallAt5: number;
	mrr: number;
	averageLatencyMs: number;
	p95LatencyMs: number;
	weakestCases: string[];
}

export interface WeakCaseSummary {
	id: string;
	category: string;
	feature?: string;
	riskArea?: string;
	passed: boolean;
	recallAt5: number;
	mrr: number;
	bestExpectedPathRank?: number;
	latencyMs: number;
	reason: string;
}

export interface ExpectationInput {
	testCase: EvalCase;
	topPaths: string[];
	textHaystack: string;
	diagnosticsHaystack: string;
	selectedCount: number;
	rankedCount: number;
	confidence?: string;
}

export interface ExpectationResult {
	passed: boolean;
	scores: CaseResult["scores"];
	retrieval: CaseResult["retrieval"];
	missing: CaseResult["missing"];
}

export function evaluateExpectations(
	input: ExpectationInput,
): ExpectationResult {
	const expected = input.testCase.expected;
	const pathIncludes = expected.pathIncludes ?? [];
	const pathExcludes = expected.pathExcludes ?? [];
	const terms = expected.terms ?? [];
	const diagnosticsInclude = expected.diagnosticsInclude ?? [];
	const expectedPathRanks = pathIncludes
		.map((pathPart) =>
			input.topPaths.findIndex((path) => path.includes(pathPart)),
		)
		.filter((index) => index >= 0)
		.map((index) => index + 1);
	const bestExpectedPathRank =
		expectedPathRanks.length === 0 ? undefined : Math.min(...expectedPathRanks);
	const missingPathIncludes = pathIncludes.filter(
		(pathPart) => !input.topPaths.some((path) => path.includes(pathPart)),
	);
	const matchedPathExcludes = pathExcludes.filter((pathPart) =>
		input.topPaths.some((path) => path.includes(pathPart)),
	);
	const missingTerms = terms.filter(
		(term) => !input.textHaystack.includes(term.toLowerCase()),
	);
	const missingDiagnostics = diagnosticsInclude.filter(
		(term) => !input.diagnosticsHaystack.includes(term.toLowerCase()),
	);
	const missingRankedHits: string[] = [];
	if (
		expected.minRankedHits !== undefined &&
		input.rankedCount < expected.minRankedHits
	) {
		missingRankedHits.push(`rankedCount >= ${expected.minRankedHits}`);
	}
	if (
		expected.maxRankedHits !== undefined &&
		input.rankedCount > expected.maxRankedHits
	) {
		missingRankedHits.push(`rankedCount <= ${expected.maxRankedHits}`);
	}
	const missingConfidence =
		expected.confidence !== undefined &&
		input.confidence !== expected.confidence
			? [`confidence=${expected.confidence}`]
			: [];
	const hasResults = input.selectedCount > 0 || input.rankedCount > 0;
	const missingNoResults =
		expected.noResults === true && hasResults
			? ["no selected or ranked hits"]
			: [];
	const nonEmptyContext = hasResults;
	const nonEmptyExpectationPassed =
		expected.noResults === true ? !hasResults : nonEmptyContext;
	const missing = {
		pathIncludes: missingPathIncludes,
		pathExcludes: matchedPathExcludes,
		terms: missingTerms,
		diagnosticsInclude: missingDiagnostics,
		rankedHits: missingRankedHits,
		confidence: missingConfidence,
		noResults: missingNoResults,
	};
	const expectedPathCount = pathIncludes.length;
	const precisionAt1 = sparsePrecisionAtK(expectedPathRanks, 1);
	const precisionAt3 = sparsePrecisionAtK(expectedPathRanks, 3);
	const precisionAt5 = sparsePrecisionAtK(expectedPathRanks, 5);
	const ndcgAt3 = sparseNdcgAtK(expectedPathRanks, expectedPathCount, 3);
	const ndcgAt5 = sparseNdcgAtK(expectedPathRanks, expectedPathCount, 5);
	const rankDistance =
		bestExpectedPathRank === undefined ? undefined : bestExpectedPathRank - 1;
	const topPathDiversity = countDistinctParents(input.topPaths.slice(0, 5));
	return {
		passed:
			missingPathIncludes.length === 0 &&
			matchedPathExcludes.length === 0 &&
			missingTerms.length === 0 &&
			missingDiagnostics.length === 0 &&
			missingRankedHits.length === 0 &&
			missingConfidence.length === 0 &&
			missingNoResults.length === 0 &&
			nonEmptyExpectationPassed,
		scores: {
			pathRecall: recall(pathIncludes.length, missingPathIncludes.length),
			termRecall: recall(terms.length, missingTerms.length),
			nonEmptyContext,
		},
		retrieval: {
			expectedPathRanks,
			...(bestExpectedPathRank === undefined ? {} : { bestExpectedPathRank }),
			recallAt1: recallAtK(pathIncludes, input.topPaths, 1),
			recallAt3: recallAtK(pathIncludes, input.topPaths, 3),
			recallAt5: recallAtK(pathIncludes, input.topPaths, 5),
			reciprocalRank:
				bestExpectedPathRank === undefined
					? 0
					: round(1 / bestExpectedPathRank),
			precisionAt1,
			precisionAt3,
			precisionAt5,
			ndcgAt3,
			ndcgAt5,
			...(rankDistance === undefined ? {} : { rankDistance }),
			topPathDiversity,
			noResultCorrect: expected.noResults === true ? !hasResults : true,
			forbiddenPathCorrect: matchedPathExcludes.length === 0,
		},
		missing,
	};
}

export interface Report {
	dataset: string;
	description?: string;
	generatedAt: string;
	repoId?: string;
	runtime: RuntimeInfo;
	modelJudge: {
		enabled: boolean;
		provider?: string;
		model?: string;
		note: string;
	};
	researchNotes: string[];
	totalCases: number;
	passedCases: number;
	failedCases: number;
	metrics: {
		passRate: number;
		pathRecall: number;
		termRecall: number;
		nonEmptyContextRate: number;
		averageLatencyMs: number;
		medianLatencyMs: number;
		p95LatencyMs: number;
		averageRankedHits: number;
		pathRecallAt1: number;
		pathRecallAt3: number;
		pathRecallAt5: number;
		expectedPathPrecisionAt1: number;
		expectedPathPrecisionAt3: number;
		expectedPathPrecisionAt5: number;
		expectedPathNdcgAt3: number;
		expectedPathNdcgAt5: number;
		mrr: number;
		noResultAccuracy: number;
		forbiddenPathAccuracy: number;
		averageRankDistance: number;
		averageTopPathDiversity: number;
	};
	quality: {
		rankBuckets: RankBucket[];
		latencyBuckets: RankBucket[];
		weakestCases: WeakCaseSummary[];
		byCapability: Record<string, QualityGroupSummary>;
		byRiskArea: Record<string, QualityGroupSummary>;
		byProfile: Record<string, QualityGroupSummary>;
		byFeature: Record<string, QualityGroupSummary>;
		byCategory: Record<string, QualityGroupSummary>;
		byPriority: Record<string, QualityGroupSummary>;
		byCoverageType: Record<string, QualityGroupSummary>;
	};
	narrative: {
		severity: HealthLevel;
		headline: string;
		verdict: string;
		keyFindings: NarrativeFinding[];
		caveats: string[];
		attentionAreas: AttentionArea[];
		metricNotes: string[];
	};
	deltas?: ReportDeltas;
	coverage: {
		capabilities: Record<string, number>;
		priorities: Record<string, number>;
		riskAreas: Record<string, number>;
		coverageTypes: Record<string, number>;
	};
	thresholds?: {
		passed: boolean;
		results: ReportThresholdResult[];
	};
	byCategory: ReportGroup;
	byProfile: ReportGroup;
	byFeature: ReportGroup;
	byScenario: ReportGroup;
	cases: CaseResult[];
}

export async function loadEvalDataset(
	datasetPath: string,
): Promise<EvalDataset> {
	return loadEvalDatasetFile(resolve(datasetPath), []);
}

async function loadEvalDatasetFile(
	datasetPath: string,
	seen: string[],
): Promise<EvalDataset> {
	if (seen.includes(datasetPath)) {
		throw new Error(
			`Eval dataset include cycle: ${[...seen, datasetPath].join(" -> ")}`,
		);
	}
	const parsed = JSON.parse(await readFile(datasetPath, "utf8")) as EvalDataset;
	const includes = parsed.includes ?? [];
	const includeCases = await Promise.all(
		includes.map(async (includePath) => {
			const child = await loadEvalDatasetFile(
				resolve(dirname(datasetPath), includePath),
				[...seen, datasetPath],
			);
			return child.cases.map((testCase) => ({
				...(child.repoId === undefined || testCase.repoId !== undefined
					? {}
					: { repoId: child.repoId }),
				...testCase,
			}));
		}),
	);
	const cases = [...includeCases.flat(), ...(parsed.cases ?? [])];
	assertUniqueCaseIds(cases, datasetPath);
	return {
		name: parsed.name,
		...(parsed.description === undefined
			? {}
			: { description: parsed.description }),
		...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
		...(includes.length === 0 ? {} : { includes }),
		cases,
	};
}

function assertUniqueCaseIds(cases: EvalCase[], datasetPath: string): void {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const testCase of cases) {
		if (seen.has(testCase.id)) {
			duplicates.add(testCase.id);
		}
		seen.add(testCase.id);
	}
	if (duplicates.size > 0) {
		throw new Error(
			`Duplicate eval case id(s) in ${datasetPath}: ${[...duplicates].join(", ")}`,
		);
	}
}

export function caseMetadata(testCase: EvalCase): EvalCaseMetadata {
	return Object.fromEntries(
		Object.entries({
			profile: testCase.profile,
			feature: testCase.feature,
			scenario: testCase.scenario,
			priority: testCase.priority,
			capability: testCase.capability,
			claim: testCase.claim,
			whyItMatters: testCase.whyItMatters,
			expectedBehavior: testCase.expectedBehavior,
			coverageType: testCase.coverageType,
			riskArea: testCase.riskArea,
		}).filter(([, value]) => value !== undefined),
	) as EvalCaseMetadata;
}

export function buildReport(
	dataset: EvalDataset,
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
	const deltas = computeDeltas(metrics, baseline, thresholds.maxMetricRegression);
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
						passed: combinedThresholdResults.every(
							(result) => result.passed,
						),
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

export function printTerminalSummary(report: Report): void {
	console.log("");
	console.log("Retrieval eval");
	console.log("==============");
	console.log(`Verdict: ${severityBadge(report.narrative.severity)}`);
	console.log(`Headline: ${report.narrative.headline}`);
	console.log(`Corpus: ${report.runtime.corpusDbPath ?? "CLI default"}`);
	console.log(`Docs: ${report.runtime.docCount ?? "unknown"}`);
	console.log(`Passed: ${report.passedCases}/${report.totalCases}`);
	for (const finding of report.narrative.keyFindings) {
		console.log(
			`${finding.label}: ${finding.value} [${finding.severity}]`,
		);
	}
	console.log(`Average ranked hits: ${report.metrics.averageRankedHits}`);
	console.log(`Median latency: ${report.metrics.medianLatencyMs}ms`);
	if (report.deltas !== undefined && report.deltas.entries.length > 0) {
		console.log("");
		console.log("Baseline deltas:");
		for (const entry of report.deltas.entries) {
			console.log(
				`- ${entry.label}: ${formatDeltaMagnitude(entry.metric, entry.delta)} (${entry.severity})`,
			);
		}
	}
	if (report.thresholds !== undefined) {
		console.log("");
		console.log(
			`Thresholds: ${report.thresholds.passed ? "passed" : "failed"}`,
		);
		for (const threshold of report.thresholds.results) {
			console.log(
				`- ${threshold.label}: ${formatThresholdComparison(threshold)} ${threshold.passed ? "✓" : "✗"}`,
			);
		}
	}

	const failed = report.cases.filter((testCase) => !testCase.passed);
	if (failed.length === 0) {
		console.log("");
		console.log("All cases passed.");
		return;
	}

	console.log("");
	console.log("Failures");
	console.log("--------");
	for (const testCase of failed) {
		console.log(
			`- ${testCase.id}: selected=${testCase.selectedCount}, ranked=${testCase.rankedCount}, path=${percent(testCase.scores.pathRecall)}, terms=${percent(testCase.scores.termRecall)}`,
		);
		if (testCase.missing.pathIncludes.length > 0) {
			console.log(
				`  missing paths: ${testCase.missing.pathIncludes.join(", ")}`,
			);
		}
		if (testCase.missing.terms.length > 0) {
			console.log(`  missing terms: ${testCase.missing.terms.join(", ")}`);
		}
		const missingOther = [
			...testCase.missing.pathExcludes.map(
				(value) => `excluded path present: ${value}`,
			),
			...testCase.missing.diagnosticsInclude.map(
				(value) => `missing diagnostic: ${value}`,
			),
			...testCase.missing.rankedHits,
			...testCase.missing.confidence,
			...testCase.missing.noResults,
		];
		if (missingOther.length > 0) {
			console.log(`  expectation gaps: ${missingOther.join(", ")}`);
		}
		if (testCase.topPaths.length > 0) {
			console.log(`  top paths: ${testCase.topPaths.slice(0, 5).join(", ")}`);
		}
	}
}

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
${renderAtAGlance(report)}
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

function renderReportCss(): string {
	return `/* moxel-atlas-eval-report-theme */
:root{
	color-scheme:dark;
	font-family:"Space Grotesk",Inter,system-ui,sans-serif;
	--bg-900:#030711;
	--bg-800:#060b1a;
	--panel:rgba(4,9,18,.46);
	--panel-strong:rgba(3,7,17,.68);
	--line:rgba(70,215,255,.24);
	--line-strong:rgba(70,215,255,.5);
	--text:#f5f8ff;
	--muted:rgba(195,210,240,.72);
	--cyan:#35f0ff;
	--mint:#6df2d6;
	--good:#6df2d6;
	--good-strong:#35f0ff;
	--warn:#ffd166;
	--warn-strong:#ffb347;
	--bad:#ff6b8a;
	--bad-strong:#ff3366;
	--shadow:0 22px 54px rgba(2,8,26,.62);
}
*,*::before,*::after{box-sizing:border-box}
html,body{min-height:100%;margin:0;background:var(--bg-900);color:var(--text)}
body{overflow-x:hidden;font:15px/1.55 "Space Grotesk",Inter,system-ui,sans-serif}
canvas#banded-field{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none;background:transparent;opacity:.34}
.noise{position:fixed;inset:-15%;z-index:1;pointer-events:none;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");mix-blend-mode:screen;animation:grain 8s steps(60) infinite;opacity:.18}
@keyframes grain{to{transform:translate3d(-6%,-4%,0)}}
.moxel-eval-body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at 18% 12%,rgba(90,204,255,.08),transparent 55%),radial-gradient(circle at 74% 78%,rgba(115,244,214,.06),transparent 62%)}
.report-shell{position:relative;z-index:2;width:min(1180px,100% - 1.5rem);margin:0 auto;padding:5rem 0 2.5rem}
@media(min-width:641px){.report-shell{width:min(1180px,100% - 2.5rem);padding:5.6rem 0 3rem}}
.topbar{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;flex-wrap:wrap;gap:.6rem .9rem;align-items:center;min-height:3.8rem;padding:.65rem clamp(.85rem,2vw,2rem);border-bottom:1px solid var(--line);background:rgba(3,7,17,.9);backdrop-filter:blur(18px);text-transform:uppercase;letter-spacing:.14em}
.wordmark{font-weight:900;letter-spacing:.12em;font-size:.78rem}
.topmeta{flex:1 1 0;min-width:0;color:var(--muted);font-size:.66rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-pill{flex:0 0 auto;border:1px solid var(--line-strong);border-radius:999px;padding:.32rem .7rem;font-size:.7rem;font-weight:900;letter-spacing:.12em;display:inline-flex;align-items:center;gap:.4rem}
.status-pill::before{content:"";display:inline-block;width:.5rem;height:.5rem;border-radius:999px;background:currentColor;box-shadow:0 0 8px currentColor}
.status-pill[data-health="good"]{border-color:var(--good);background:rgba(109,242,214,.08);color:var(--good)}
.status-pill[data-health="warn"]{border-color:var(--warn);background:rgba(255,209,102,.10);color:var(--warn)}
.status-pill[data-health="bad"]{border-color:var(--bad);background:rgba(255,107,138,.12);color:var(--bad)}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}.muted{color:var(--muted)}
.panel,.card,.case-card,.kpi,.verdict{border:1px solid var(--line);border-radius:1.1rem;background:var(--panel);box-shadow:var(--shadow);backdrop-filter:blur(14px) saturate(112%)}
.verdict{padding:clamp(.95rem,2.2vw,1.4rem);margin-top:.9rem;display:grid;gap:.5rem;border-left:3px solid var(--line-strong)}
.verdict[data-health="good"]{border-left-color:var(--good-strong)}
.verdict[data-health="warn"]{border-left-color:var(--warn-strong)}
.verdict[data-health="bad"]{border-left-color:var(--bad-strong)}
.verdict .eyebrow{color:var(--muted)}
.verdict h1{margin:.1rem 0;font-size:clamp(1.35rem,3.2vw,2rem);line-height:1.15;letter-spacing:-.02em;font-weight:800}
.verdict .lede{margin:0;color:rgba(245,248,255,.88);font-size:clamp(.92rem,1.4vw,1.05rem);line-height:1.5}
.eyebrow{color:var(--mint);font-size:.68rem;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
.kpi-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.7rem;margin-top:.8rem}
.kpi{padding:.8rem .9rem;display:flex;flex-direction:column;gap:.2rem;border-left:3px solid transparent;position:relative}
.kpi .kpi-label{display:flex;align-items:center;gap:.35rem;color:var(--muted);font-size:.65rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.kpi .kpi-value{font-size:clamp(1.3rem,2.4vw,1.7rem);line-height:1.05;font-weight:800;letter-spacing:-.01em}
.kpi .kpi-desc{color:var(--muted);font-size:.74rem}
.kpi .kpi-delta{display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;margin-top:.1rem}
.kpi[data-health="good"]{border-left-color:var(--good)}
.kpi[data-health="warn"]{border-left-color:var(--warn)}
.kpi[data-health="bad"]{border-left-color:var(--bad)}
.kpi[data-health="good"] .kpi-value{color:var(--good)}
.kpi[data-health="warn"] .kpi-value{color:var(--warn)}
.kpi[data-health="bad"] .kpi-value{color:var(--bad)}
.kpi-delta[data-trend="up-good"],.kpi-delta[data-trend="down-good"]{color:var(--good)}
.kpi-delta[data-trend="up-bad"],.kpi-delta[data-trend="down-bad"]{color:var(--bad)}
.kpi-delta[data-trend="flat"]{color:var(--muted)}
.info-btn{width:1.1rem;height:1.1rem;min-width:1.1rem;padding:0;border-radius:999px;border:1px solid var(--line);background:rgba(0,3,10,.55);color:var(--muted);font-size:.65rem;font-weight:900;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.info-btn:hover,.info-btn:focus{color:var(--cyan);border-color:var(--line-strong);outline:none;box-shadow:0 0 0 2px rgba(53,240,255,.2)}
.info-popover{position:absolute;z-index:30;width:min(320px,calc(100vw - 1.5rem));padding:.9rem 1rem;border:1px solid var(--line-strong);border-radius:.9rem;background:rgba(3,7,17,.96);box-shadow:var(--shadow);color:var(--text);font-size:.82rem;line-height:1.45}
.info-popover[hidden]{display:none}
.info-popover h3{margin:0 0 .3rem;font-size:.95rem;font-weight:800}
.info-popover p{margin:.25rem 0}
.info-popover .info-targets{color:var(--muted);font-size:.75rem;margin-top:.4rem;padding-top:.4rem;border-top:1px dashed var(--line)}
.info-popover .info-close{position:absolute;top:.35rem;right:.5rem;border:none;background:transparent;color:var(--muted);font-size:.9rem;cursor:pointer;padding:.15rem .35rem}
.chart-grid,.quality-grid,.controls{display:grid;gap:.9rem}
.chart-grid{grid-template-columns:repeat(auto-fit,minmax(360px,1fr));margin-top:1rem}
.panel{margin-top:1rem;padding:.95rem;border-left:3px solid transparent}
.panel[data-health="good"]{border-left-color:var(--good)}
.panel[data-health="warn"]{border-left-color:var(--warn)}
.panel[data-health="bad"]{border-left-color:var(--bad)}
.panel h2{margin:.1rem 0 .7rem;font-size:1.18rem;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.panel h3{font-size:1rem;margin:.8rem 0 .4rem}
.callout{border-color:rgba(255,209,102,.34);background:linear-gradient(135deg,rgba(255,209,102,.10),rgba(53,240,255,.05))}
.callout[data-health="good"]{border-color:rgba(109,242,214,.30);background:linear-gradient(135deg,rgba(109,242,214,.10),rgba(53,240,255,.04))}
.callout[data-health="bad"]{border-color:rgba(255,107,138,.34);background:linear-gradient(135deg,rgba(255,107,138,.12),rgba(53,240,255,.04))}
.findings-list{margin:.4rem 0 .1rem;padding:0;list-style:none;display:grid;gap:.45rem}
.finding{display:grid;grid-template-columns:auto 1fr auto;gap:.5rem;align-items:baseline;padding:.5rem .7rem;border:1px solid var(--line);border-radius:.7rem;background:rgba(0,3,10,.28)}
.finding[data-health="good"]{border-color:rgba(109,242,214,.3)}
.finding[data-health="warn"]{border-color:rgba(255,209,102,.34)}
.finding[data-health="bad"]{border-color:rgba(255,107,138,.36)}
.finding-label{font-weight:800}
.finding-value{font-variant-numeric:tabular-nums;font-weight:800}
.finding-value[data-health="good"]{color:var(--good)}
.finding-value[data-health="warn"]{color:var(--warn)}
.finding-value[data-health="bad"]{color:var(--bad)}
.finding-msg{grid-column:1/-1;color:var(--muted);font-size:.82rem}
.chart-panel svg{width:100%;height:auto;display:block}
.chart-caption{margin:.6rem 0 0;color:var(--muted);font-size:.82rem}
.chart-legend{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.7rem}
.bars{display:grid;gap:.55rem}
.bar{display:grid;grid-template-columns:minmax(120px,150px) 1fr 62px;gap:.65rem;align-items:center}
.track{height:.55rem;border:1px solid var(--line);border-radius:999px;background:rgba(0,3,10,.48);overflow:hidden}
.fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--cyan),var(--mint));box-shadow:0 0 18px rgba(53,240,255,.34)}
.fill[data-health="good"]{background:linear-gradient(90deg,var(--good-strong),var(--good));box-shadow:0 0 18px rgba(109,242,214,.35)}
.fill[data-health="warn"]{background:linear-gradient(90deg,var(--warn-strong),var(--warn));box-shadow:0 0 18px rgba(255,209,102,.34)}
.fill[data-health="bad"]{background:linear-gradient(90deg,var(--bad-strong),var(--bad));box-shadow:0 0 18px rgba(255,107,138,.34)}
.heatmap{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem}
.heat{border:1px solid var(--line);border-radius:.9rem;padding:.75rem;background:linear-gradient(135deg,rgba(53,240,255,var(--heat)),rgba(109,242,214,.05))}
.heat[data-health="good"]{border-color:rgba(109,242,214,.34);background:linear-gradient(135deg,rgba(109,242,214,var(--heat)),rgba(3,7,17,.3))}
.heat[data-health="warn"]{border-color:rgba(255,209,102,.34);background:linear-gradient(135deg,rgba(255,209,102,var(--heat)),rgba(3,7,17,.3))}
.heat[data-health="bad"]{border-color:rgba(255,107,138,.34);background:linear-gradient(135deg,rgba(255,107,138,var(--heat)),rgba(3,7,17,.3))}
.heat strong{display:block}
.pillrow{display:flex;flex-wrap:wrap;gap:.35rem}
.pill{display:inline-flex;gap:.25rem;border:1px solid var(--line);border-radius:999px;padding:.18rem .5rem;background:rgba(53,240,255,.05);color:rgba(245,248,255,.86);font-size:.72rem}
.tag{border:1px solid var(--line);border-radius:.55rem;padding:.18rem .42rem;color:var(--muted);font-size:.72rem;display:inline-flex;align-items:center;gap:.25rem}
.tag[data-health="good"]{border-color:rgba(109,242,214,.35);color:var(--good)}
.tag[data-health="warn"]{border-color:rgba(255,209,102,.35);color:var(--warn)}
.tag[data-health="bad"]{border-color:rgba(255,107,138,.4);color:var(--bad)}
.controls{grid-template-columns:1fr;align-items:end}
@media(min-width:641px){.controls{grid-template-columns:1.6fr repeat(3,1fr) .9fr auto}}
.control label{display:block;margin-bottom:.3rem;color:var(--muted);font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em}
input,select,button{width:100%;border:1px solid var(--line);border-radius:.75rem;background:rgba(0,3,10,.55);color:var(--text);padding:.55rem .7rem;font:inherit}
button{cursor:pointer}
button:hover,button:focus{border-color:var(--line-strong);box-shadow:0 0 0 3px rgba(53,240,255,.1)}
.case-list{display:grid;gap:.6rem;margin-top:1rem;max-height:72vh;overflow:auto;padding-right:.35rem;scrollbar-color:rgba(53,240,255,.35) rgba(3,7,17,.35)}
.case-card{padding:.8rem}
.case-head{display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:start}
.case-title{margin:0;font-size:.94rem}
.case-summary{margin:.5rem 0;color:rgba(245,248,255,.86);font-size:.88rem}
.scoreline{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}
.section-details>summary{list-style:none;cursor:pointer;padding:.25rem 0;display:flex;align-items:center;gap:.6rem;justify-content:space-between;flex-wrap:wrap}
.section-details>summary::-webkit-details-marker{display:none}
.section-details>summary::after{content:"+";font-weight:800;color:var(--cyan);border:1px solid var(--line);border-radius:999px;padding:.05rem .5rem}
.section-details[open]>summary::after{content:"−"}
details.section-details{margin-top:.55rem}
summary{cursor:pointer;color:var(--cyan)}
pre,code{font-family:SFMono-Regular,Cascadia Code,Roboto Mono,ui-monospace,monospace}
pre{overflow:auto;max-height:180px;border:1px solid var(--line);border-radius:.7rem;padding:.6rem;background:rgba(0,3,10,.52);white-space:pre-wrap;font-size:.78rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem}
.attention-list{display:grid;gap:.4rem;margin:.5rem 0 0;padding:0;list-style:none}
.attention-list li{padding:.4rem .6rem;border:1px solid var(--line);border-radius:.65rem;background:rgba(0,3,10,.3);font-size:.82rem;display:flex;gap:.4rem;align-items:baseline}
.attention-list li[data-health="warn"]{border-color:rgba(255,209,102,.34)}
.attention-list li[data-health="bad"]{border-color:rgba(255,107,138,.36)}
.table-wrap{max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:.8rem}
table{width:100%;border-collapse:collapse;min-width:720px}
th,td{border-bottom:1px solid var(--line);padding:.5rem;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:rgba(3,7,17,.94);color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}
.fallback summary{list-style:none;cursor:pointer}
.fallback summary::-webkit-details-marker{display:none}
.fallback-summary{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
.fallback:not([open]){padding:1rem}
.empty{display:none;color:var(--warn);padding:1rem}
@media(max-width:640px){
	.report-shell{padding-top:4.6rem}
	.chart-grid{grid-template-columns:1fr}
	.kpi-strip{grid-template-columns:repeat(2,1fr)}
	.bar{grid-template-columns:minmax(110px,1fr) 2fr 46px;gap:.4rem}
	.panel h2{font-size:1.06rem}
	.topbar{letter-spacing:.08em}
	.topmeta{flex-basis:100%;order:3}
}
@media(prefers-reduced-motion:reduce){*,.noise{animation:none!important;transition:none!important}}
`;
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
		.filter(
			(finding): finding is NarrativeFinding => finding !== undefined,
		);
	const deltaFor = (metric: HealthMetric): MetricDeltaEntry | undefined =>
		report.deltas?.entries.find((entry) => entry.metric === metric);
	return `<section class="kpi-strip" aria-label="Headline metrics">${shown
		.map((finding) =>
			renderKpiCard(finding, deltaFor(finding.metric)),
		)
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

function renderAtAGlance(report: Report): string {
	const radarMetrics: Array<[string, number, HealthLevel]> = [
		[
			"Pass",
			report.metrics.passRate,
			classifyHealth("passRate", report.metrics.passRate),
		],
		[
			"R@5",
			report.metrics.pathRecallAt5,
			classifyHealth("pathRecallAt5", report.metrics.pathRecallAt5),
		],
		[
			"MRR",
			report.metrics.mrr,
			classifyHealth("mrr", report.metrics.mrr),
		],
		[
			"Abstain",
			report.metrics.noResultAccuracy,
			classifyHealth("noResultAccuracy", report.metrics.noResultAccuracy),
		],
		[
			"Forbidden",
			report.metrics.forbiddenPathAccuracy,
			classifyHealth(
				"forbiddenPathAccuracy",
				report.metrics.forbiddenPathAccuracy,
			),
		],
		[
			"Terms",
			report.metrics.termRecall,
			classifyHealth("termRecall", report.metrics.termRecall),
		],
	];
	return `<section class="panel" data-eval-chart="at-a-glance" data-health="${escapeHtml(report.narrative.severity)}"><div class="case-head"><div><div class="eyebrow">At a glance</div><h2>Metric constellation${renderInfoButton("mrr")}</h2></div></div>${renderRadarSvg(radarMetrics)}<p class="chart-caption">Each axis is a metric scaled to 0–1. Fill color tracks the worst axis; outer ring is target.</p></section>`;
}

function renderInterpretation(report: Report): string {
	const severity = report.narrative.severity;
	return `<section class="panel callout" data-health="${escapeHtml(severity)}"><div class="eyebrow">Interpretation</div><h2>${escapeHtml(report.narrative.headline)}</h2><ul class="findings-list">${report.narrative.keyFindings
		.map(
			(finding) =>
				`<li class="finding" data-health="${escapeHtml(finding.severity)}"><span class="finding-label">${escapeHtml(finding.label)}${renderInfoButton(finding.metric)}</span><span class="finding-value" data-health="${escapeHtml(finding.severity)}">${escapeHtml(finding.value)}</span><span class="tag" data-health="${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span><span class="finding-msg">${escapeHtml(finding.message)}</span></li>`,
		)
		.join(
			"",
		)}</ul>${report.narrative.attentionAreas.length === 0 ? "" : `<h3>Attention areas</h3><ul class="attention-list">${report.narrative.attentionAreas.map((area) => `<li data-health="${escapeHtml(area.severity)}">${escapeHtml(area.message)}</li>`).join("")}</ul>`}<p class="muted">${report.narrative.caveats.map(escapeHtml).join(" ")}</p></section>`;
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
		)}</div></article><article class="panel chart-panel" data-eval-chart="rank-buckets" data-health="${escapeHtml(rankBucketSeverity)}"><h2>First expected path rank${renderInfoButton("mrr")}</h2>${renderBucketSvg(report.quality.rankBuckets, "cases", rankBucketsHealth)}<p class="chart-caption">Lower ranks are better. Missing/no-label bucket includes abstain cases or cases without a first expected path.</p></article><article class="panel chart-panel" data-eval-chart="latency-buckets" data-health="${escapeHtml(latencyBucketSeverity)}"><h2>Latency distribution${renderInfoButton("p95LatencyMs")}</h2>${renderBucketSvg(report.quality.latencyBuckets, "cases", latencyBucketsHealth)}<p class="chart-caption">Local CLI wall-clock runtime per eval case. p95: ${Math.round(report.metrics.p95LatencyMs)}ms (${escapeHtml(latencyHealth)}), median: ${Math.round(report.metrics.medianLatencyMs)}ms.</p></article><article class="panel chart-panel" data-eval-chart="safety-bars" data-health="${escapeHtml(worstHealth([
		classifyHealth("noResultAccuracy", report.metrics.noResultAccuracy),
		classifyHealth(
			"forbiddenPathAccuracy",
			report.metrics.forbiddenPathAccuracy,
		),
		classifyHealth("termRecall", report.metrics.termRecall),
		classifyHealth("nonEmptyContextRate", report.metrics.nonEmptyContextRate),
	]))}"><h2>Safety and context${renderInfoButton("forbiddenPathAccuracy")}</h2><p class="chart-caption">Abstain and forbidden-path accuracy track whether Atlas refuses to leak. Term recall and non-empty context track whether it found anything useful at all.</p><div class="bars">${safetyBars(
		report,
	).join("")}</div></article></section>`;
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

function worstBucketSeverity(bucketHealths: HealthLevel[]): HealthLevel {
	const represented = bucketHealths.filter(
		(_, index) => index !== undefined,
	);
	return represented.length === 0 ? "good" : worstHealth(represented);
}

function safetyBars(report: Report): string[] {
	const rows: Array<[string, number, HealthMetric]> = [
		["Abstain accuracy", report.metrics.noResultAccuracy, "noResultAccuracy"],
		[
			"Forbidden-path accuracy",
			report.metrics.forbiddenPathAccuracy,
			"forbiddenPathAccuracy",
		],
		["Term recall", report.metrics.termRecall, "termRecall"],
		[
			"Non-empty context",
			report.metrics.nonEmptyContextRate,
			"nonEmptyContextRate",
		],
	];
	return rows.map(([label, value, metric]) =>
		renderProgress(label, value, classifyHealth(metric, value)),
	);
}

function renderLineSvg(points: Array<[string, number, HealthLevel]>): string {
	const width = 720;
	const height = 240;
	const padX = 48;
	const padY = 30;
	const usableW = width - padX * 2;
	const usableH = height - padY * 2;
	const coords = points.map(([, value], index) => {
		const x =
			padX +
			(points.length === 1 ? 0 : (index / (points.length - 1)) * usableW);
		const y = padY + (1 - Math.max(0, Math.min(1, value))) * usableH;
		return [round(x), round(y)] as const;
	});
	const path = coords
		.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`)
		.join(" ");
	const lastX = coords[coords.length - 1]?.[0] ?? padX;
	const area = `${path} L${lastX},${height - padY} L${padX},${height - padY} Z`;
	const overallHealth = worstHealth(points.map(([, , health]) => health));
	const stroke = colorFor(overallHealth);
	return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Retrieval quality line chart"><defs><linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${stroke}" stop-opacity=".28"/><stop offset="1" stop-color="${stroke}" stop-opacity=".02"/></linearGradient></defs><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="18" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.15)"/>${[0, 0.25, 0.5, 0.75, 1].map((tick) => `<line x1="${padX}" x2="${width - padX}" y1="${round(padY + (1 - tick) * usableH)}" y2="${round(padY + (1 - tick) * usableH)}" stroke="rgba(70,215,255,.1)"/><text x="12" y="${round(padY + (1 - tick) * usableH + 4)}" fill="rgba(195,210,240,.6)" font-size="11">${Math.round(tick * 100)}%</text>`).join("")}<path d="${area}" fill="url(#lineFill)"/><path d="${path}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${coords
		.map(([x, y], index) => {
			const [label, value, health] = points[index] ?? ["", 0, "good"];
			const dotColor = colorFor(health);
			return `<circle cx="${x}" cy="${y}" r="5" fill="${dotColor}" stroke="#030711" stroke-width="2"/><text x="${x}" y="${height - 10}" text-anchor="middle" fill="rgba(245,248,255,.82)" font-size="11" font-weight="700">${escapeHtml(label)}</text><text x="${x}" y="${Math.max(16, y - 10)}" text-anchor="middle" fill="#f5f8ff" font-size="12" font-weight="800">${percent(value)}</text>`;
		})
		.join("")}</svg>`;
}

function renderBucketSvg(
	buckets: RankBucket[],
	unit: string,
	healthLevels: HealthLevel[] = [],
): string {
	const width = 720;
	const rowH = 34;
	const height = Math.max(160, 40 + buckets.length * rowH);
	const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
	const labelW = 128;
	const barW = width - labelW - 88;
	return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bucket bar chart"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="18" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.15)"/>${buckets
		.map((bucket, index) => {
			const y = 24 + index * rowH;
			const w = Math.max(4, (bucket.count / maxCount) * barW);
			const health = healthLevels[index] ?? "good";
			const color = colorFor(health);
			return `<text x="20" y="${y + 14}" fill="rgba(245,248,255,.82)" font-size="12" font-weight="700">${escapeHtml(bucket.label)}</text><rect x="${labelW}" y="${y}" width="${barW}" height="16" rx="8" fill="rgba(70,215,255,.1)"/><rect x="${labelW}" y="${y}" width="${round(w)}" height="16" rx="8" fill="${color}" opacity=".88"/><text x="${labelW + barW + 12}" y="${y + 12}" fill="#f5f8ff" font-size="12" font-weight="800">${bucket.count}</text>`;
		})
		.join(
			"",
		)}<text x="20" y="${height - 10}" fill="rgba(195,210,240,.68)" font-size="11">Count of ${escapeHtml(unit)} per bucket</text></svg>`;
}

function renderRadarSvg(
	metrics: Array<[string, number, HealthLevel?]>,
): string {
	const size = 320;
	const center = size / 2;
	const radius = 108;
	const angleFor = (index: number) =>
		(Math.PI * 2 * index) / metrics.length - Math.PI / 2;
	const point = (index: number, value: number) => {
		const angle = angleFor(index);
		const r = radius * Math.max(0, Math.min(1, value));
		return [
			round(center + Math.cos(angle) * r),
			round(center + Math.sin(angle) * r),
		] as const;
	};
	const outer = metrics.map((_, index) => point(index, 1));
	const poly = metrics
		.map(([, value], index) => point(index, value).join(","))
		.join(" ");
	const overall = worstHealth(
		metrics.map(([, , health]) => health ?? "good"),
	);
	const fillColor = colorFor(overall);
	return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Metric radar chart"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="20" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.15)"/>${[0.25, 0.5, 0.75, 1].map((level) => `<polygon points="${metrics.map((_, index) => point(index, level).join(",")).join(" ")}" fill="none" stroke="rgba(70,215,255,.13)"/>`).join("")}${outer.map(([x, y]) => `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(70,215,255,.1)"/>`).join("")}<polygon points="${poly}" fill="${fillColor}" fill-opacity=".28" stroke="${fillColor}" stroke-width="2.5"/>${metrics
		.map(([label, value, health], index) => {
			const [x, y] = point(index, 1.14);
			const axisColor = colorFor(health ?? "good");
			const [dotX, dotY] = point(index, value);
			return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="rgba(245,248,255,.82)" font-size="11" font-weight="800">${escapeHtml(label)}</text><circle cx="${dotX}" cy="${dotY}" r="4" fill="${axisColor}" stroke="#030711" stroke-width="1.5"/><title>${escapeHtml(label)} ${percent(value)} (${escapeHtml(health ?? "good")})</title>`;
		})
		.join("")}</svg>`;
}

function renderProgress(
	label: string,
	value: number,
	health?: HealthLevel,
): string {
	const width = Math.max(0, Math.min(100, Math.round(value * 100)));
	const healthAttr = health
		? ` data-health="${escapeHtml(health)}"`
		: "";
	return `<div class="bar"><span>${escapeHtml(label)}</span><div class="track"><div class="fill"${healthAttr} style="width:${width}%"></div></div><strong>${percent(value)}</strong></div>`;
}

function colorFor(health: HealthLevel): string {
	if (health === "bad") return "#ff6b8a";
	if (health === "warn") return "#ffd166";
	return "#6df2d6";
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
	const mrrHealth = classifyHealth(
		"mrr",
		testCase.retrieval.reciprocalRank,
	);
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
	return `<div class="pillrow">${metadata.map(([label, value]) => `<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}</div>`;
}

function renderMethodology(report: Report): string {
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Methodology</div><strong>Metric definitions and limitations</strong></div><span class="tag">expand</span></summary><h3>Eval unit</h3><p class="muted">One user-like query against <code>atlas inspect retrieval</code>. Pass means every deterministic expectation passed: required paths, terms, exclusions, diagnostics, confidence, hit bounds, and no-result behavior.</p><h3>Metrics</h3><ul><li><b>Recall@k:</b> fraction of expected path substrings found in top-k paths.</li><li><b>Expected-path Precision@k:</b> lower-bound proportion of top-k paths matching sparse expected labels; unlabeled relevant docs may exist.</li><li><b>Expected-path nDCG@k:</b> rank-sensitive binary relevance over sparse expected paths.</li><li><b>MRR:</b> reciprocal rank of first expected path, averaged across cases.</li><li><b>Rank distance:</b> per-case <code>bestExpectedPathRank - 1</code>, averaged; lower is better.</li><li><b>Top-path diversity:</b> distinct parent directory count among top-5 retrieved paths.</li><li><b>Latency:</b> local wall-clock CLI query time. Median ${Math.round(report.metrics.medianLatencyMs)}ms; p95 ${Math.round(report.metrics.p95LatencyMs)}ms.</li></ul><h3>Limitations</h3><ul>${report.narrative.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("")}</ul></details>`;
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
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Reproducibility</div><strong><code>${escapeHtml(command)}</code></strong></div><button type="button" data-copy-text="${escapeHtml(command)}">Copy</button></summary><p class="muted">Local-first command and runtime metadata.</p><div class="heatmap">${items.map(([label, value]) => `<div class="heat" style="--heat:.08"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><p><a href="mcp-retrieval-report.json">Machine-readable JSON report</a> · <a href="../../docs/evals.md">Interpretation guide</a></p></details>`;
}

function renderResearchNotes(report: Report): string {
	if (report.researchNotes.length === 0) {
		return "";
	}
	return `<details class="panel section-details"><summary><div><div class="eyebrow">Research context</div><strong>Why Atlas ships its own harness</strong></div><span class="tag">expand</span></summary><ul>${report.researchNotes
		.map((note) => `<li>${escapeHtml(note)}</li>`)
		.join(
			"",
		)}</ul></details>`;
}

function renderStaticFallback(report: Report): string {
	return `<details class="panel fallback"><summary><div class="fallback-summary"><div><div class="eyebrow">Static appendix</div><h2>All case rows</h2></div><span class="tag">Collapsed by default</span></div></summary><p class="muted">Raw readable backup for users with JavaScript disabled. Main explorer above is preferred.</p><div class="table-wrap"><table><thead><tr><th>Status</th><th>ID</th><th>Case</th><th>Scores</th><th>Evidence</th></tr></thead><tbody>${report.cases.map(renderCaseRow).join("")}</tbody></table></div></details>`;
}

function renderCaseRow(testCase: CaseResult): string {
	return `<tr><td>${testCase.passed ? "pass" : "fail"}</td><td><code>${escapeHtml(testCase.id)}</code></td><td>${escapeHtml(caseSummary(testCase))}</td><td>R@1 ${percent(testCase.retrieval.recallAt1)}<br>R@5 ${percent(testCase.retrieval.recallAt5)}<br>MRR ${testCase.retrieval.reciprocalRank}</td><td><pre>${escapeHtml(testCase.topPaths.slice(0, 4).join("\n"))}</pre></td></tr>`;
}

function renderExplorerScript(): string {
	return `(function(){
const data=JSON.parse(document.getElementById('atlas-eval-report-data').textContent);
const cards=[...document.querySelectorAll('[data-case-card]')];
const search=document.getElementById('case-search');
const cat=document.getElementById('filter-category');
const profile=document.getElementById('filter-profile');
const risk=document.getElementById('filter-risk');
const sort=document.getElementById('case-sort');
const list=document.getElementById('case-list');
const count=document.getElementById('visible-count');
const empty=document.getElementById('empty-state');
function esc(s){return String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function pct(n){return Math.round(n*100)+'%'}
function apply(){
  const q=search.value.trim().toLowerCase();
  let visible=cards.filter(c=>(!q||c.dataset.search.includes(q))&&(!cat.value||c.dataset.category===cat.value)&&(!profile.value||c.dataset.profile===profile.value)&&(!risk.value||c.dataset.risk===risk.value));
  visible.sort((a,b)=>{const key=sort.value;if(key==='id')return a.dataset.id.localeCompare(b.dataset.id);if(key==='latency')return Number(b.dataset.latency)-Number(a.dataset.latency);if(key==='ranked')return Number(b.dataset.ranked)-Number(a.dataset.ranked);if(key==='recallAt5')return Number(a.dataset.recall)-Number(b.dataset.recall);if(key==='mrr')return Number(a.dataset.mrr)-Number(b.dataset.mrr);return Number(a.dataset.recall)-Number(b.dataset.recall)||Number(a.dataset.mrr)-Number(b.dataset.mrr)||Number(b.dataset.latency)-Number(a.dataset.latency)||a.dataset.id.localeCompare(b.dataset.id)});
  cards.forEach(c=>c.hidden=true);
  visible.forEach(c=>{c.hidden=false;list.appendChild(c)});
  count.textContent=String(visible.length);
  empty.style.display=visible.length?'none':'block';
}
[search,cat,profile,risk,sort].forEach(el=>el&&el.addEventListener('input',apply));
const clear=document.getElementById('clear-filters');
if(clear)clear.addEventListener('click',()=>{search.value='';cat.value='';profile.value='';risk.value='';sort.value='weakest';apply()});
const popover=document.getElementById('info-popover');
function hidePopover(){if(popover){popover.hidden=true;popover.innerHTML='';popover.removeAttribute('data-open-for')}}
function showPopover(btn){
  const metric=btn.getAttribute('data-info-metric');
  if(!metric||!popover)return;
  const entry=(data.glossary||{})[metric];
  if(!entry)return;
  const rect=btn.getBoundingClientRect();
  popover.innerHTML='<button type="button" class="info-close" aria-label="Close">×</button><h3>'+esc(entry.label)+'</h3><p>'+esc(entry.short)+'</p><p class="muted">'+esc(entry.long)+'</p><p><strong>Interpretation:</strong> '+esc(entry.interpretation)+'</p><p class="info-targets">Targets: '+esc(entry.targets)+'</p>';
  popover.hidden=false;
  const popoverWidth=Math.min(320,window.innerWidth-24);
  popover.style.width=popoverWidth+'px';
  const scrollX=window.scrollX||window.pageXOffset||0;
  const scrollY=window.scrollY||window.pageYOffset||0;
  let left=rect.left+scrollX;
  if(left+popoverWidth>window.innerWidth-12+scrollX)left=window.innerWidth-popoverWidth-12+scrollX;
  if(left<12+scrollX)left=12+scrollX;
  popover.style.left=left+'px';
  popover.style.top=(rect.bottom+scrollY+6)+'px';
  popover.setAttribute('data-open-for',metric);
}
document.addEventListener('click',async e=>{
  const info=e.target.closest('.info-btn');
  if(info){
    e.preventDefault();
    if(popover&&popover.getAttribute('data-open-for')===info.getAttribute('data-info-metric')){hidePopover();return}
    showPopover(info);
    return;
  }
  if(popover&&e.target.closest('.info-close')){hidePopover();return}
  if(popover&&!popover.hidden&&!e.target.closest('.info-popover')&&!e.target.closest('.info-btn'))hidePopover();
  const btn=e.target.closest('button');
  if(!btn)return;
  let text=btn.dataset.copyText;
  if(btn.dataset.copyId){text=JSON.stringify(data.cases.find(c=>c.id===btn.dataset.copyId),null,2)}
  if(!text)return;
  try{await navigator.clipboard.writeText(text);btn.textContent='Copied'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();btn.textContent='Copied'}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&popover&&!popover.hidden)hidePopover()});
const group=document.getElementById('quality-group');
const heat=document.getElementById('quality-heatmap');
const title=document.getElementById('quality-title');
function heatHtml(groups){return Object.entries(groups).map(([name,v])=>{
  const passH=v.passRate>=1?'good':v.passRate>=.95?'warn':'bad';
  const rH=v.recallAt5>=.8?'good':v.recallAt5>=.6?'warn':'bad';
  const mH=v.mrr>=.6?'good':v.mrr>=.35?'warn':'bad';
  const order={good:0,warn:1,bad:2};
  const worst=[passH,rH,mH].reduce((a,b)=>order[b]>order[a]?b:a,'good');
  const heatLevel=Math.max(.08,Math.min(.45,v.recallAt5*.35+v.mrr*.1));
  return '<article class="heat" data-health="'+worst+'" style="--heat:'+heatLevel+'"><strong>'+esc(name)+'</strong><span class="muted">'+v.passed+'/'+v.total+' pass · R@5 '+pct(v.recallAt5)+' · MRR '+v.mrr.toFixed(2)+' · p95 '+Math.round(v.p95LatencyMs)+'ms</span><div class="pillrow">'+v.weakestCases.map(id=>'<span class="pill">'+esc(id)+'</span>').join('')+'</div></article>';
}).join('')}
if(group)group.addEventListener('change',()=>{heat.innerHTML=heatHtml(data.quality[group.value]);title.textContent='Quality by '+group.options[group.selectedIndex].text.toLowerCase()});
apply();
})();`;
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
		if (
			result.retrieval.topPathDiversity <= 1 &&
			result.topPaths.length >= 2
		)
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
	const attentionAreas: AttentionArea[] = weakestCases(cases, 5).map(
		(result) => ({
			severity: attentionSeverity(result),
			message: `${result.id}: ${result.reason}`,
			caseId: result.id,
		}),
	);
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

function metricValue(
	metric: HealthMetric,
	metrics: Report["metrics"],
): number {
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
		(
			["noResultAccuracy", "forbiddenPathAccuracy"] as HealthMetric[]
		).includes(finding.metric),
	);
	const latencyFinding = findings.find(
		(finding) => finding.metric === "p95LatencyMs",
	);
	const rankBad = rankFindings.some((finding) => finding.severity === "bad");
	const rankWarn = rankFindings.some(
		(finding) => finding.severity !== "good",
	);
	const safetyBad = safetyFindings.some((finding) => finding.severity === "bad");
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
		segments.push(
			`Pass gate: ${passFinding.value} (${passFinding.severity})`,
		);
	}
	const rank = findings
		.filter((finding) =>
			(
				["pathRecallAt5", "mrr", "pathRecallAt1"] as HealthMetric[]
			).includes(finding.metric),
		)
		.map(
			(finding) =>
				`${finding.label} ${finding.value} (${finding.severity})`,
		)
		.join(", ");
	if (rank) {
		segments.push(`Rank: ${rank}`);
	}
	const latency = findings.find(
		(finding) => finding.metric === "p95LatencyMs",
	);
	if (latency) {
		segments.push(`Latency: ${latency.label} ${latency.value} (${latency.severity})`);
	}
	const safety = findings
		.filter((finding) =>
			(
				[
					"noResultAccuracy",
					"forbiddenPathAccuracy",
				] as HealthMetric[]
			).includes(finding.metric),
		)
		.map(
			(finding) =>
				`${finding.label} ${finding.value} (${finding.severity})`,
		)
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

function formatThresholdComparison(result: ReportThresholdResult): string {
	const metric = result.metric as HealthMetric;
	const isLatency =
		metric === "p95LatencyMs" || metric === "averageLatencyMs";
	const formatLocal = (value: number): string =>
		isLatency ? `${Math.round(value)}ms` : percent(value);
	const comparator = result.direction === "lower" ? "<=" : ">=";
	return `${formatLocal(result.actual)} ${comparator} ${formatLocal(result.limit)}`;
}

// ============================================================================
// Baseline diff and regression detection
// ============================================================================

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

export async function loadBaseline(
	path: string,
): Promise<BaselineSummary | undefined> {
	try {
		const content = await readFile(path, "utf8");
		const parsed = JSON.parse(content) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"metrics" in parsed
		) {
			return parsed as BaselineSummary;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

export function baselineSummaryFromReport(report: Report): BaselineSummary {
	return {
		dataset: report.dataset,
		generatedAt: report.generatedAt,
		...(report.runtime.repoRevision === undefined
			? {}
			: { repoRevision: report.runtime.repoRevision }),
		metrics: { ...report.metrics },
	};
}

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
		const baselineValue = (baseline.metrics as Record<string, number | undefined>)[
			metric
		];
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

function average(values: number[]): number {
	return values.length === 0
		? 0
		: round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function recall(total: number, missing: number): number {
	return total === 0 ? 1 : round((total - missing) / total);
}

function recallAtK(
	expectedPaths: string[],
	topPaths: string[],
	k: number,
): number {
	if (expectedPaths.length === 0) {
		return 1;
	}
	const topK = topPaths.slice(0, k);
	const found = expectedPaths.filter((pathPart) =>
		topK.some((path) => path.includes(pathPart)),
	).length;
	return round(found / expectedPaths.length);
}

function sparsePrecisionAtK(expectedPathRanks: number[], k: number): number {
	if (k <= 0) {
		return 0;
	}
	const hits = expectedPathRanks.filter((rank) => rank <= k).length;
	return round(hits / k);
}

function sparseNdcgAtK(
	expectedPathRanks: number[],
	expectedCount: number,
	k: number,
): number {
	if (expectedCount === 0 || k <= 0) {
		return 0;
	}
	const dcg = expectedPathRanks
		.filter((rank) => rank <= k)
		.reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
	const idealCount = Math.min(expectedCount, k);
	const idcg = Array.from(
		{ length: idealCount },
		(_, index) => 1 / Math.log2(index + 2),
	).reduce((sum, value) => sum + value, 0);
	return idcg === 0 ? 0 : round(dcg / idcg);
}

function countDistinctParents(paths: string[]): number {
	if (paths.length === 0) {
		return 0;
	}
	const parents = new Set<string>();
	for (const path of paths) {
		const lastSlash = path.lastIndexOf("/");
		parents.add(lastSlash === -1 ? "" : path.slice(0, lastSlash));
	}
	return parents.size;
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

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
