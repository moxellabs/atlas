import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { moxelBandedFieldScript } from "../../apps/server/src/openapi/moxel-theme";

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
}

export interface ReportThresholdResult {
	metric: keyof Report["metrics"];
	label: string;
	actual: number;
	minimum: number;
	passed: boolean;
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
		verdict: string;
		keyFindings: string[];
		caveats: string[];
		attentionAreas: string[];
		metricNotes: string[];
	};
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
): Report {
	const passedCases = cases.filter((result) => result.passed).length;
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
			cases.map((result) => expectedPathPrecisionAtK(result, 1)),
		),
		expectedPathPrecisionAt3: average(
			cases.map((result) => expectedPathPrecisionAtK(result, 3)),
		),
		expectedPathPrecisionAt5: average(
			cases.map((result) => expectedPathPrecisionAtK(result, 5)),
		),
		expectedPathNdcgAt3: average(
			cases.map((result) => expectedPathNdcgAtK(result, 3)),
		),
		expectedPathNdcgAt5: average(
			cases.map((result) => expectedPathNdcgAtK(result, 5)),
		),
		mrr: average(cases.map((result) => result.retrieval.reciprocalRank)),
		noResultAccuracy: rate(cases, (result) => result.retrieval.noResultCorrect),
		forbiddenPathAccuracy: rate(
			cases,
			(result) => result.retrieval.forbiddenPathCorrect,
		),
	};
	const thresholdResults = evaluateThresholds(metrics, thresholds);
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
		narrative: buildNarrative(metrics, cases),
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
		...(thresholdResults.length === 0
			? {}
			: {
					thresholds: {
						passed: thresholdResults.every((result) => result.passed),
						results: thresholdResults,
					},
				}),
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
	console.log(`Corpus: ${report.runtime.corpusDbPath ?? "CLI default"}`);
	console.log(`Docs: ${report.runtime.docCount ?? "unknown"}`);
	console.log(`Passed: ${report.passedCases}/${report.totalCases}`);
	console.log(`Pass rate: ${percent(report.metrics.passRate)}`);
	console.log(`Path recall: ${percent(report.metrics.pathRecall)}`);
	console.log(`Term recall: ${percent(report.metrics.termRecall)}`);
	console.log(
		`Non-empty context: ${percent(report.metrics.nonEmptyContextRate)}`,
	);
	console.log(`Path Recall@5: ${percent(report.metrics.pathRecallAt5)}`);
	console.log(`MRR: ${report.metrics.mrr}`);
	console.log(`Average ranked hits: ${report.metrics.averageRankedHits}`);
	console.log(`Median latency: ${report.metrics.medianLatencyMs}ms`);
	console.log(`P95 latency: ${report.metrics.p95LatencyMs}ms`);
	if (report.thresholds !== undefined) {
		console.log(
			`Thresholds: ${report.thresholds.passed ? "passed" : "failed"}`,
		);
		for (const threshold of report.thresholds.results) {
			console.log(
				`- ${threshold.label}: ${percent(threshold.actual)} >= ${percent(threshold.minimum)} ${threshold.passed ? "✓" : "✗"}`,
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
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MOXEL ATLAS EVALS — ${escapeHtml(report.dataset)}</title>
<style>${renderReportCss()}</style>
</head>
<body class="moxel-eval-body">
<canvas id="banded-field" aria-hidden="true"></canvas>
<div class="noise" aria-hidden="true"></div>
<main class="report-shell" data-report-shell="moxel-atlas-eval-report-theme">
${renderLabHeader(report)}
${renderHero(report)}
${renderHeadlineCards(report)}
${renderInterpretation(report)}
${renderCharts(report)}
${renderCoverageLab(report)}
${renderExplorer(report)}
${renderMethodology(report)}
${renderReproducibility(report)}
${renderStaticFallback(report)}
</main>
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
	--warn:#ffd166;
	--bad:#ff6b8a;
	--shadow:0 22px 54px rgba(2,8,26,.62);
}
*,*::before,*::after{box-sizing:border-box}
html,body{min-height:100%;margin:0;background:var(--bg-900);color:var(--text)}
body{overflow-x:hidden;font:15px/1.55 "Space Grotesk",Inter,system-ui,sans-serif}
canvas#banded-field{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none;background:transparent;opacity:.46}
.noise{position:fixed;inset:-15%;z-index:1;pointer-events:none;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");mix-blend-mode:screen;animation:grain 8s steps(60) infinite;opacity:.24}
@keyframes grain{to{transform:translate3d(-6%,-4%,0)}}
.moxel-eval-body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at 18% 12%,rgba(90,204,255,.10),transparent 55%),radial-gradient(circle at 74% 78%,rgba(115,244,214,.08),transparent 62%)}
.report-shell{position:relative;z-index:2;width:min(1180px,calc(100vw - 2rem));margin:0 auto;padding:5.4rem 0 3rem}
.topbar{position:fixed;top:0;left:0;right:0;z-index:5;display:grid;grid-template-columns:auto 1fr auto;gap:1rem;align-items:center;min-height:4.15rem;padding:.85rem clamp(1rem,2vw,2rem);border-bottom:1px solid var(--line);background:rgba(3,7,17,.84);backdrop-filter:blur(18px);text-transform:uppercase;letter-spacing:.16em}
.wordmark{font-weight:900;letter-spacing:.12em}.topmeta{color:var(--muted);font-size:.68rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.status-dot{justify-self:end;border:1px solid var(--line-strong);border-radius:999px;padding:.35rem .7rem;background:rgba(53,240,255,.06);color:var(--mint);font-size:.72rem}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}.muted{color:var(--muted)}
.hero,.panel,.card,.case-card{border:1px solid var(--line);border-radius:1.2rem;background:var(--panel);box-shadow:var(--shadow);backdrop-filter:blur(14px) saturate(112%)}
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:1.25rem;align-items:stretch;padding:clamp(1.25rem,3vw,2.2rem);overflow:hidden;background:linear-gradient(135deg,rgba(3,7,17,.78),rgba(6,15,28,.38));min-height:0}
.hero-copy{display:flex;flex-direction:column;justify-content:center}.eyebrow{color:var(--mint);font-size:.72rem;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.hero h1{max-width:760px;margin:.4rem 0 .9rem;font-size:clamp(2.1rem,5vw,4.6rem);line-height:.96;letter-spacing:-.055em}.lede{max-width:850px;color:rgba(245,248,255,.9);font-size:clamp(1rem,1.6vw,1.18rem)}.hero-visual{display:grid;gap:.8rem;align-content:stretch}.hero-chart{min-height:100%;border:1px solid var(--line);border-radius:1rem;background:rgba(0,3,10,.34);padding:1rem}.hero-chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}.tiny-note{font-size:.78rem;color:var(--muted)}
.cards,.chart-grid,.quality-grid,.controls{display:grid;gap:.9rem}.cards{grid-template-columns:repeat(5,1fr);margin:1rem 0}.card{padding:.9rem}.card span,.label{display:block;color:var(--muted);font-size:.7rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.card strong{display:block;margin:.25rem 0;font-size:clamp(1.45rem,2.5vw,2.2rem);line-height:1}.panel{margin-top:1rem;padding:1rem}.panel h2{margin:.1rem 0 .8rem;font-size:1.22rem}.callout{border-color:rgba(255,209,102,.34);background:linear-gradient(135deg,rgba(255,209,102,.10),rgba(53,240,255,.05))}.callout ul{margin:.6rem 0 .2rem}
.chart-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-panel svg,.hero-chart svg{width:100%;height:auto;display:block}.chart-caption{margin:.65rem 0 0;color:var(--muted);font-size:.85rem}.chart-legend{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.7rem}.bars{display:grid;gap:.55rem}.bar{display:grid;grid-template-columns:150px 1fr 64px;gap:.65rem;align-items:center}.track{height:.55rem;border:1px solid var(--line);border-radius:999px;background:rgba(0,3,10,.48);overflow:hidden}.fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--cyan),var(--mint));box-shadow:0 0 18px rgba(53,240,255,.34)}
.heatmap{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.7rem}.heat{border:1px solid var(--line);border-radius:.95rem;padding:.75rem;background:linear-gradient(135deg,rgba(53,240,255,var(--heat)),rgba(109,242,214,.05))}.heat strong{display:block}.pillrow{display:flex;flex-wrap:wrap;gap:.38rem}.pill{display:inline-flex;gap:.25rem;border:1px solid var(--line);border-radius:999px;padding:.18rem .5rem;background:rgba(53,240,255,.055);color:rgba(245,248,255,.86);font-size:.76rem}.tag{border:1px solid var(--line);border-radius:.65rem;padding:.22rem .42rem;color:var(--muted);font-size:.76rem}
.controls{grid-template-columns:1.7fr repeat(3,1fr) .9fr auto;align-items:end}.control label{display:block;margin-bottom:.3rem;color:var(--muted);font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em}input,select,button{width:100%;border:1px solid var(--line);border-radius:.82rem;background:rgba(0,3,10,.55);color:var(--text);padding:.65rem .75rem;font:inherit}button{cursor:pointer}button:hover,button:focus{border-color:var(--line-strong);box-shadow:0 0 0 3px rgba(53,240,255,.1)}
.case-list{display:grid;gap:.65rem;margin-top:1rem;max-height:72vh;overflow:auto;padding-right:.35rem;scrollbar-color:rgba(53,240,255,.35) rgba(3,7,17,.35)}.case-card{padding:.8rem}.case-head{display:grid;grid-template-columns:1fr auto;gap:.75rem;align-items:start}.case-title{margin:0;font-size:.96rem}.case-summary{margin:.55rem 0;color:rgba(245,248,255,.86)}.scoreline{display:flex;flex-wrap:wrap;gap:.45rem;margin:.55rem 0}details{margin-top:.55rem}summary{cursor:pointer;color:var(--cyan)}pre,code{font-family:SFMono-Regular,Cascadia Code,Roboto Mono,ui-monospace,monospace}pre{overflow:auto;max-height:180px;border:1px solid var(--line);border-radius:.75rem;padding:.65rem;background:rgba(0,3,10,.52);white-space:pre-wrap}.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}
.table-wrap{max-height:62vh;overflow:auto;border:1px solid var(--line);border-radius:.85rem}table{width:100%;border-collapse:collapse;min-width:860px}th,td{border-bottom:1px solid var(--line);padding:.58rem;text-align:left;vertical-align:top}th{position:sticky;top:0;background:rgba(3,7,17,.94);color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.1em}.fallback summary{list-style:none;cursor:pointer}.fallback summary::-webkit-details-marker{display:none}.fallback-summary{display:flex;justify-content:space-between;gap:1rem;align-items:center}.fallback:not([open]){padding:1rem}.empty{display:none;color:var(--warn);padding:1rem}
@media(max-width:980px){.hero,.cards,.chart-grid,.quality-grid,.controls,.cols{grid-template-columns:1fr}.bar{grid-template-columns:1fr}.topbar{grid-template-columns:1fr}.status-dot{justify-self:start}.report-shell{width:min(100% - 1rem,1180px)}}
@media(prefers-reduced-motion:reduce){*,.noise{animation:none!important;transition:none!important}}
`;
}
function renderLabHeader(report: Report): string {
	return `<header class="topbar"><div class="wordmark">MOXEL ATLAS EVALS</div><div class="topmeta">${escapeHtml(report.dataset)} · ${escapeHtml(report.generatedAt)} · ${escapeHtml(report.runtime.repoRevision ?? "local revision")}</div><div class="status-dot">${report.thresholds?.passed === false ? "GATED FAIL" : "PASSING RUN"}</div></header>`;
}

function renderHero(report: Report): string {
	return `<section class="hero"><div class="hero-copy"><div class="eyebrow">Atlas retrieval eval · deterministic benchmark</div><h1>Atlas finds the required docs. Ranking still has measurable headroom.</h1><p class="lede">${escapeHtml(report.narrative.verdict)}</p><p class="muted">${escapeHtml(report.description ?? "Deterministic retrieval evaluation")} Measures retrieved source evidence for Atlas docs workflows. Does not score generated answers.</p></div><aside class="hero-visual" aria-label="Headline retrieval charts"><div class="hero-chart" data-eval-chart="headline-dial"><div class="hero-chart-grid">${renderDonutSvg("Pass", report.metrics.passRate, `${report.passedCases}/${report.totalCases}`)}${renderDonutSvg("Recall@5", report.metrics.pathRecallAt5, percent(report.metrics.pathRecallAt5))}</div><p class="tiny-note">Pass gate verifies deterministic expectations. Recall@k shows whether expected source paths appear early.</p></div>${renderPathRankSparkline(report)}</aside></section>`;
}

function renderHeadlineCards(report: Report): string {
	return `<section class="cards" aria-label="Headline metrics">${[
		scoreCard(
			"Cases passing",
			`${report.passedCases}/${report.totalCases}`,
			percent(report.metrics.passRate),
		),
		scoreCard(
			"Recall@5",
			percent(report.metrics.pathRecallAt5),
			"expected paths",
		),
		scoreCard("MRR", String(report.metrics.mrr), "first expected path"),
		scoreCard("P95 latency", `${report.metrics.p95LatencyMs}ms`, "local CLI"),
		scoreCard(
			"Abstain/safety",
			`${percent(report.metrics.noResultAccuracy)} / ${percent(report.metrics.forbiddenPathAccuracy)}`,
			"no-result / forbidden",
		),
	].join("")}</section>`;
}

function scoreCard(label: string, value: string, description: string): string {
	return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small class="muted">${escapeHtml(description)}</small></article>`;
}

function renderInterpretation(report: Report): string {
	return `<section class="panel callout"><div class="eyebrow">Interpretation</div><h2>Perfect pass rate can coexist with rank-quality headroom.</h2><ul>${report.narrative.keyFindings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul><p class="muted">${report.narrative.caveats.map(escapeHtml).join(" ")}</p></section>`;
}

function renderCharts(report: Report): string {
	return `<section class="chart-grid"><article class="panel chart-panel" data-eval-chart="recall-funnel"><h2>Recall and sparse-label rank quality</h2>${renderRecallSvg(report)}<p class="chart-caption">Recall@k asks: did known-good paths appear by rank k? Expected-path precision/nDCG are sparse-label lower bounds, not full relevance judgments.</p><div class="bars">${[
		["Recall@1", report.metrics.pathRecallAt1],
		["Recall@3", report.metrics.pathRecallAt3],
		["Recall@5", report.metrics.pathRecallAt5],
		["Expected-path P@5", report.metrics.expectedPathPrecisionAt5],
		["Expected-path nDCG@5", report.metrics.expectedPathNdcgAt5],
	]
		.map(([label, value]) => renderProgress(String(label), Number(value)))
		.join(
			"",
		)}</div></article><article class="panel chart-panel" data-eval-chart="rank-buckets"><h2>First expected path rank</h2>${renderBucketSvg(report.quality.rankBuckets, "cases")}<p class="chart-caption">Lower ranks are better. Missing/no-label bucket includes abstain cases or cases without a first expected path.</p></article><article class="panel chart-panel" data-eval-chart="latency-buckets"><h2>Latency distribution</h2>${renderBucketSvg(report.quality.latencyBuckets, "cases")}<p class="chart-caption">Local CLI wall-clock runtime per eval case. P95: ${report.metrics.p95LatencyMs}ms.</p></article><article class="panel chart-panel" data-eval-chart="metric-radar"><h2>Metric constellation</h2>${renderRadarSvg(
		[
			["Pass", report.metrics.passRate],
			["Terms", report.metrics.termRecall],
			["R@5", report.metrics.pathRecallAt5],
			["MRR", report.metrics.mrr],
			["No result", report.metrics.noResultAccuracy],
			["Forbidden", report.metrics.forbiddenPathAccuracy],
		],
	)}<div class="chart-legend">${metricBars(report).join("")}</div></article></section>`;
}

function renderDonutSvg(label: string, value: number, center: string): string {
	const radius = 44;
	const circumference = 2 * Math.PI * radius;
	const dash = Math.max(0, Math.min(1, value)) * circumference;
	return `<svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(label)} ${escapeHtml(center)}"><circle cx="60" cy="60" r="44" fill="none" stroke="rgba(70,215,255,.16)" stroke-width="12"/><circle cx="60" cy="60" r="44" fill="none" stroke="url(#donutGradient)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${round(dash)} ${round(circumference)}" transform="rotate(-90 60 60)"/><defs><linearGradient id="donutGradient" x1="0" x2="1"><stop stop-color="#35f0ff"/><stop offset="1" stop-color="#6df2d6"/></linearGradient></defs><text x="60" y="57" text-anchor="middle" fill="#f5f8ff" font-size="18" font-weight="800">${escapeHtml(center)}</text><text x="60" y="78" text-anchor="middle" fill="rgba(195,210,240,.78)" font-size="10" font-weight="700" letter-spacing="1.2">${escapeHtml(label.toUpperCase())}</text></svg>`;
}

function renderPathRankSparkline(report: Report): string {
	const points: Array<[string, number]> = [
		["R@1", report.metrics.pathRecallAt1],
		["R@3", report.metrics.pathRecallAt3],
		["R@5", report.metrics.pathRecallAt5],
		["MRR", report.metrics.mrr],
	];
	return `<div class="hero-chart" data-eval-chart="headline-sparkline"><div class="eyebrow">Rank headroom</div>${renderLineSvg(points)}<p class="tiny-note">Known-good evidence is present, but often not rank 1. That is next optimization target.</p></div>`;
}

function renderRecallSvg(report: Report): string {
	return renderLineSvg([
		["R@1", report.metrics.pathRecallAt1],
		["R@3", report.metrics.pathRecallAt3],
		["R@5", report.metrics.pathRecallAt5],
		["P@5", report.metrics.expectedPathPrecisionAt5],
		["nDCG@5", report.metrics.expectedPathNdcgAt5],
	]);
}

function renderLineSvg(points: Array<[string, number]>): string {
	const width = 720;
	const height = 260;
	const padX = 52;
	const padY = 34;
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
	return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Retrieval quality line chart"><defs><linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#35f0ff" stop-opacity=".24"/><stop offset="1" stop-color="#6df2d6" stop-opacity=".02"/></linearGradient><linearGradient id="lineStroke" x1="0" x2="1"><stop stop-color="#35f0ff"/><stop offset="1" stop-color="#6df2d6"/></linearGradient></defs><rect x="1" y="1" width="718" height="258" rx="20" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.18)"/>${[0, 0.25, 0.5, 0.75, 1].map((tick) => `<line x1="${padX}" x2="${width - padX}" y1="${round(padY + (1 - tick) * usableH)}" y2="${round(padY + (1 - tick) * usableH)}" stroke="rgba(70,215,255,.12)"/><text x="14" y="${round(padY + (1 - tick) * usableH + 4)}" fill="rgba(195,210,240,.64)" font-size="11">${Math.round(tick * 100)}%</text>`).join("")}<path d="${area}" fill="url(#lineFill)"/><path d="${path}" fill="none" stroke="url(#lineStroke)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${coords.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="6" fill="#6df2d6" stroke="#030711" stroke-width="3"/><text x="${x}" y="${height - 12}" text-anchor="middle" fill="rgba(245,248,255,.82)" font-size="12" font-weight="700">${escapeHtml(points[index]?.[0] ?? "")}</text><text x="${x}" y="${Math.max(18, y - 12)}" text-anchor="middle" fill="#f5f8ff" font-size="13" font-weight="800">${percent(points[index]?.[1] ?? 0)}</text>`).join("")}</svg>`;
}

function renderBucketSvg(buckets: RankBucket[], unit: string): string {
	const width = 720;
	const rowH = 38;
	const height = Math.max(170, 42 + buckets.length * rowH);
	const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
	const labelW = 128;
	const barW = width - labelW - 88;
	return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bucket bar chart"><rect x="1" y="1" width="718" height="${height - 2}" rx="20" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.18)"/>${buckets
		.map((bucket, index) => {
			const y = 28 + index * rowH;
			const w = Math.max(4, (bucket.count / maxCount) * barW);
			return `<text x="22" y="${y + 15}" fill="rgba(245,248,255,.82)" font-size="13" font-weight="700">${escapeHtml(bucket.label)}</text><rect x="${labelW}" y="${y}" width="${barW}" height="18" rx="9" fill="rgba(70,215,255,.12)"/><rect x="${labelW}" y="${y}" width="${round(w)}" height="18" rx="9" fill="url(#bucketGradient)"/><text x="${labelW + barW + 16}" y="${y + 14}" fill="#f5f8ff" font-size="13" font-weight="800">${bucket.count}</text>`;
		})
		.join(
			"",
		)}<defs><linearGradient id="bucketGradient" x1="0" x2="1"><stop stop-color="#35f0ff"/><stop offset="1" stop-color="#6df2d6"/></linearGradient></defs><text x="22" y="${height - 12}" fill="rgba(195,210,240,.68)" font-size="12">Count of ${escapeHtml(unit)} per bucket</text></svg>`;
}

function renderRadarSvg(metrics: Array<[string, number]>): string {
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
	return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Metric radar chart"><defs><linearGradient id="radarFill" x1="0" x2="1"><stop stop-color="#35f0ff" stop-opacity=".34"/><stop offset="1" stop-color="#6df2d6" stop-opacity=".24"/></linearGradient></defs><rect x="1" y="1" width="318" height="318" rx="22" fill="rgba(0,3,10,.22)" stroke="rgba(70,215,255,.18)"/>${[0.25, 0.5, 0.75, 1].map((level) => `<polygon points="${metrics.map((_, index) => point(index, level).join(",")).join(" ")}" fill="none" stroke="rgba(70,215,255,.13)"/>`).join("")}${outer.map(([x, y]) => `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(70,215,255,.12)"/>`).join("")}<polygon points="${poly}" fill="url(#radarFill)" stroke="#6df2d6" stroke-width="3"/>${metrics
		.map(([label, value], index) => {
			const [x, y] = point(index, 1.14);
			return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="rgba(245,248,255,.82)" font-size="11" font-weight="800">${escapeHtml(label)}</text><title>${escapeHtml(label)} ${percent(value)}</title>`;
		})
		.join("")}</svg>`;
}

function renderProgress(label: string, value: number): string {
	const width = Math.max(0, Math.min(100, Math.round(value * 100)));
	return `<div class="bar"><span>${escapeHtml(label)}</span><div class="track"><div class="fill" style="width:${width}%"></div></div><strong>${percent(value)}</strong></div>`;
}

function metricBars(report: Report): string[] {
	return [
		["Pass rate", report.metrics.passRate],
		["Term recall", report.metrics.termRecall],
		["No-result accuracy", report.metrics.noResultAccuracy],
		["Forbidden-path accuracy", report.metrics.forbiddenPathAccuracy],
		["Non-empty context", report.metrics.nonEmptyContextRate],
	].map(([label, value]) => renderProgress(String(label), Number(value)));
}

function renderCoverageLab(report: Report): string {
	return `<section class="panel" data-eval-chart="coverage-heatmap"><div class="case-head"><div><div class="eyebrow">Coverage heatmap</div><h2 id="quality-title">Quality by capability</h2></div><select id="quality-group" aria-label="Change coverage heatmap group"><option value="byCapability">Capability</option><option value="byRiskArea">Risk area</option><option value="byProfile">Profile</option><option value="byCategory">Category</option><option value="byPriority">Priority</option><option value="byCoverageType">Coverage type</option></select></div><div id="quality-heatmap" class="heatmap">${renderHeatmap(report.quality.byCapability)}</div></section><section class="panel"><h2>Ranking worklist</h2><p class="muted">Cases below passed deterministic gates but known-good evidence was missing from top five, not first, or slow. Use these to improve retrieval order.</p><div class="case-list">${report.quality.weakestCases.map((item) => `<article class="case-card"><div class="case-head"><strong>${escapeHtml(item.id)}</strong><span class="tag">${escapeHtml(item.reason)}</span></div><p class="muted">${escapeHtml(item.category)} · Recall@5 ${percent(item.recallAt5)} · MRR ${item.mrr} · rank ${item.bestExpectedPathRank ?? "missing"} · ${item.latencyMs}ms</p></article>`).join("")}</div></section>`;
}

function renderHeatmap(group: Record<string, QualityGroupSummary>): string {
	return Object.entries(group)
		.map(([name, value]) => {
			const heat = Math.max(
				0.05,
				Math.min(0.45, value.recallAt5 * 0.35 + value.mrr * 0.1),
			);
			return `<article class="heat" style="--heat:${heat}"><strong>${escapeHtml(name)}</strong><span class="muted">${value.passed}/${value.total} pass · R@5 ${percent(value.recallAt5)} · MRR ${value.mrr} · p95 ${value.p95LatencyMs}ms</span><div class="pillrow">${value.weakestCases.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("")}</div></article>`;
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
	const status =
		testCase.passed && testCase.retrieval.recallAt5 < 1
			? "pass · rank headroom"
			: testCase.passed
				? "pass"
				: "fail";
	const summary = caseSummary(testCase);
	return `<article class="case-card" data-case-card data-id="${escapeHtml(testCase.id)}" data-category="${escapeHtml(testCase.category)}" data-profile="${escapeHtml(testCase.profile ?? "unknown")}" data-risk="${escapeHtml(testCase.riskArea ?? "unknown")}" data-recall="${testCase.retrieval.recallAt5}" data-mrr="${testCase.retrieval.reciprocalRank}" data-latency="${testCase.latencyMs}" data-ranked="${testCase.rankedCount}" data-search="${escapeHtml(caseSearchText(testCase))}"><div class="case-head"><h3 class="case-title">${escapeHtml(testCase.id)} · ${escapeHtml(status)}</h3><button type="button" class="copy-case" data-copy-id="${escapeHtml(testCase.id)}">Copy JSON</button></div>${renderMetadataPills(testCase)}<p class="case-summary">${escapeHtml(summary)}</p><div class="scoreline"><span class="tag">R@1 ${percent(testCase.retrieval.recallAt1)}</span><span class="tag">R@5 ${percent(testCase.retrieval.recallAt5)}</span><span class="tag">MRR ${testCase.retrieval.reciprocalRank}</span><span class="tag">Rank ${testCase.retrieval.bestExpectedPathRank ?? "missing"}</span><span class="tag">${testCase.latencyMs}ms</span></div><details><summary>Open evidence</summary><p><b>Query:</b> ${escapeHtml(testCase.query)}</p><div class="cols"><div><b>Expected behavior</b><pre>${escapeHtml(testCase.expectedBehavior ?? "Required paths/terms present; forbidden paths absent; no-result behavior correct when expected.")}</pre></div><div><b>Top paths</b><pre>${escapeHtml(formatList(testCase.topPaths.slice(0, 10)))}</pre></div><div><b>Missing fields</b><pre>${escapeHtml(JSON.stringify(testCase.missing, null, 2))}</pre></div><div><b>Diagnostics</b><pre>${escapeHtml(summarizeDiagnostics(testCase.diagnostics))}</pre></div></div></details></article>`;
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
	return `<section class="panel"><h2>Methodology factsheet</h2><ul><li><b>Eval unit:</b> one user-like query against <code>atlas inspect retrieval</code>.</li><li><b>Pass:</b> every deterministic expectation passes: required paths, terms, exclusions, diagnostics, confidence, hit bounds, and no-result behavior.</li><li><b>Recall@k:</b> fraction of expected path substrings found in top-k paths.</li><li><b>Expected-path Precision@k:</b> lower-bound proportion of top-k paths matching sparse expected labels; unlabeled relevant docs may exist.</li><li><b>Expected-path nDCG@k:</b> rank-sensitive binary relevance over sparse expected paths.</li><li><b>MRR:</b> reciprocal rank of first expected path, averaged across cases.</li><li><b>Latency:</b> local wall-clock CLI query time. Median ${report.metrics.medianLatencyMs}ms; p95 ${report.metrics.p95LatencyMs}ms.</li></ul><h3>Limitations</h3><ul>${report.narrative.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("")}</ul></section>`;
}

function renderReproducibility(report: Report): string {
	const command = "bun run eval:full";
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
	return `<section class="panel"><div class="case-head"><div><h2>Reproducibility</h2><p class="muted">Local-first command and runtime metadata.</p></div><button type="button" data-copy-text="${escapeHtml(command)}">Copy command</button></div><pre>${escapeHtml(command)}</pre><div class="heatmap">${items.map(([label, value]) => `<div class="heat" style="--heat:.08"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div><p><a href="mcp-retrieval-report.json">Machine-readable JSON report</a> · <a href="../../docs/evals.md">Interpretation guide</a></p></section>`;
}

function renderStaticFallback(report: Report): string {
	return `<details class="panel fallback"><summary><div class="fallback-summary"><div><div class="eyebrow">Static appendix</div><h2>All case rows</h2></div><span class="tag">Collapsed by default</span></div></summary><p class="muted">Raw readable backup for users with JavaScript disabled. Main explorer above is preferred.</p><div class="table-wrap"><table><thead><tr><th>Status</th><th>ID</th><th>Case</th><th>Scores</th><th>Evidence</th></tr></thead><tbody>${report.cases.map(renderCaseRow).join("")}</tbody></table></div></details>`;
}

function renderCaseRow(testCase: CaseResult): string {
	return `<tr><td>${testCase.passed ? "pass" : "fail"}</td><td><code>${escapeHtml(testCase.id)}</code></td><td>${escapeHtml(caseSummary(testCase))}</td><td>R@1 ${percent(testCase.retrieval.recallAt1)}<br>R@5 ${percent(testCase.retrieval.recallAt5)}<br>MRR ${testCase.retrieval.reciprocalRank}</td><td><pre>${escapeHtml(testCase.topPaths.slice(0, 4).join("\n"))}</pre></td></tr>`;
}

function renderExplorerScript(): string {
	return `(function(){const data=JSON.parse(document.getElementById('atlas-eval-report-data').textContent);const cards=[...document.querySelectorAll('[data-case-card]')];const search=document.getElementById('case-search');const cat=document.getElementById('filter-category');const profile=document.getElementById('filter-profile');const risk=document.getElementById('filter-risk');const sort=document.getElementById('case-sort');const list=document.getElementById('case-list');const count=document.getElementById('visible-count');const empty=document.getElementById('empty-state');function apply(){const q=search.value.trim().toLowerCase();let visible=cards.filter(c=>(!q||c.dataset.search.includes(q))&&(!cat.value||c.dataset.category===cat.value)&&(!profile.value||c.dataset.profile===profile.value)&&(!risk.value||c.dataset.risk===risk.value));visible.sort((a,b)=>{const key=sort.value;if(key==='id')return a.dataset.id.localeCompare(b.dataset.id);if(key==='latency')return Number(b.dataset.latency)-Number(a.dataset.latency);if(key==='ranked')return Number(b.dataset.ranked)-Number(a.dataset.ranked);if(key==='recallAt5')return Number(a.dataset.recall)-Number(b.dataset.recall);if(key==='mrr')return Number(a.dataset.mrr)-Number(b.dataset.mrr);return Number(a.dataset.recall)-Number(b.dataset.recall)||Number(a.dataset.mrr)-Number(b.dataset.mrr)||Number(b.dataset.latency)-Number(a.dataset.latency)||a.dataset.id.localeCompare(b.dataset.id)});cards.forEach(c=>c.hidden=true);visible.forEach(c=>{c.hidden=false;list.appendChild(c)});count.textContent=String(visible.length);empty.style.display=visible.length?'none':'block'}[search,cat,profile,risk,sort].forEach(el=>el&&el.addEventListener('input',apply));document.getElementById('clear-filters').addEventListener('click',()=>{search.value='';cat.value='';profile.value='';risk.value='';sort.value='weakest';apply()});document.addEventListener('click',async e=>{const btn=e.target.closest('button');if(!btn)return;let text=btn.dataset.copyText;if(btn.dataset.copyId){text=JSON.stringify(data.cases.find(c=>c.id===btn.dataset.copyId),null,2)}if(!text)return;try{await navigator.clipboard.writeText(text);btn.textContent='Copied'}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();btn.textContent='Copied'}});const group=document.getElementById('quality-group');const heat=document.getElementById('quality-heatmap');const title=document.getElementById('quality-title');function heatHtml(groups){return Object.entries(groups).map(([name,v])=>'<article class="heat" style="--heat:'+Math.max(.05,Math.min(.45,v.recallAt5*.35+v.mrr*.1))+'"><strong>'+esc(name)+'</strong><span class="muted">'+v.passed+'/'+v.total+' pass · R@5 '+pct(v.recallAt5)+' · MRR '+v.mrr+' · p95 '+v.p95LatencyMs+'ms</span><div class="pillrow">'+v.weakestCases.map(id=>'<span class="pill">'+esc(id)+'</span>').join('')+'</div></article>').join('')}function esc(s){return String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}function pct(n){return Math.round(n*100)+'%'}group.addEventListener('change',()=>{heat.innerHTML=heatHtml(data.quality[group.value]);title.textContent='Quality by '+group.options[group.selectedIndex].text.toLowerCase()});apply();})();`;
}

function reportClientData(report: Report): unknown {
	return {
		quality: report.quality,
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

function expectedPathCount(result: CaseResult): number {
	return (
		result.retrieval.expectedPathRanks.length +
		result.missing.pathIncludes.length
	);
}

/** Lower-bound expected-path precision over sparse path labels, not true relevance precision. */
function expectedPathPrecisionAtK(result: CaseResult, k: number): number {
	if (expectedPathCount(result) === 0 || k <= 0) {
		return 0;
	}
	const hits = result.retrieval.expectedPathRanks.filter(
		(rank) => rank <= k,
	).length;
	return round(hits / k);
}

function expectedPathNdcgAtK(result: CaseResult, k: number): number {
	const expectedCount = expectedPathCount(result);
	if (expectedCount === 0 || k <= 0) {
		return 0;
	}
	const dcg = result.retrieval.expectedPathRanks
		.filter((rank) => rank <= k)
		.reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
	const idealCount = Math.min(expectedCount, k);
	const idcg = Array.from(
		{ length: idealCount },
		(_, index) => 1 / Math.log2(index + 2),
	).reduce((sum, value) => sum + value, 0);
	return idcg === 0 ? 0 : round(dcg / idcg);
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
	if (result.retrieval.recallAt5 < 1) return "expected path outside top five";
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

function buildNarrative(
	metrics: Report["metrics"],
	cases: CaseResult[],
): Report["narrative"] {
	const total = cases.length;
	const passed = cases.filter((result) => result.passed).length;
	const perfect = total > 0 && passed === total;
	return {
		verdict: `${passed}/${total} deterministic retrieval expectations pass. Recall@5 is ${percent(metrics.pathRecallAt5)}, MRR is ${metrics.mrr}, and p95 latency is ${metrics.p95LatencyMs}ms.`,
		keyFindings: [
			perfect
				? `All ${total} deterministic cases passed; ranking metrics still show headroom.`
				: `${passed}/${total} deterministic cases passed; failures need regression triage first.`,
			`First-window quality: Recall@1 ${percent(metrics.pathRecallAt1)}, Recall@3 ${percent(metrics.pathRecallAt3)}, Recall@5 ${percent(metrics.pathRecallAt5)}.`,
			`Sparse-label rank metrics: expected-path Precision@5 ${percent(metrics.expectedPathPrecisionAt5)}, expected-path nDCG@5 ${percent(metrics.expectedPathNdcgAt5)}.`,
			`Boundary behavior: no-result accuracy ${percent(metrics.noResultAccuracy)}, forbidden-path accuracy ${percent(metrics.forbiddenPathAccuracy)}.`,
		],
		caveats: [
			"This report measures retrieval evidence quality, not generated-answer faithfulness or hallucination rate.",
			"Expected-path precision and nDCG are lower-bound sparse-label metrics; unlabeled relevant documents can make true relevance higher.",
			"Perfect pass rate means deterministic gates passed, not that ranking is saturated or optimal.",
		],
		attentionAreas: weakestCases(cases, 5).map(
			(result) => `${result.id}: ${result.reason}`,
		),
		metricNotes: [
			"Recall@k measures whether expected source paths appear in practical reading windows.",
			"MRR rewards earlier first expected evidence and exposes ranking headroom even when cases pass.",
			"Latency buckets summarize local CLI query responsiveness.",
		],
	};
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
		thresholdResult(
			"passRate",
			"Pass rate",
			metrics.passRate,
			thresholds.minPassRate,
		),
		thresholdResult(
			"pathRecall",
			"Path recall",
			metrics.pathRecall,
			thresholds.minPathRecall,
		),
		thresholdResult(
			"termRecall",
			"Term recall",
			metrics.termRecall,
			thresholds.minTermRecall,
		),
		thresholdResult(
			"nonEmptyContextRate",
			"Non-empty context",
			metrics.nonEmptyContextRate,
			thresholds.minNonEmptyContextRate,
		),
	].filter((result): result is ReportThresholdResult => result !== undefined);
}

function thresholdResult(
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
		minimum,
		passed: actual >= minimum,
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
