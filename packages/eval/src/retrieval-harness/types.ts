import type { HealthLevel, HealthMetric } from "./health";

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
	baseline: {
		generatedAt?: string;
		repoRevision?: string;
		dataset?: string;
	};
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
	scores: {
		pathRecall: number;
		termRecall: number;
		nonEmptyContext: boolean;
	};
	retrieval: CaseResult["retrieval"];
	missing: CaseResult["missing"];
}

export interface ReportGroupEntry {
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

export type ReportGroup = Record<string, ReportGroupEntry>;

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

