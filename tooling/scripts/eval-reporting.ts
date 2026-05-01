import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
		mrr: number;
		noResultAccuracy: number;
		forbiddenPathAccuracy: number;
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
	const failed = report.cases.filter((testCase) => !testCase.passed);
	const thresholdStatus = report.thresholds?.passed ?? true;
	const links = [
		`<a href="../../docs/evals.md">docs/evals.md</a>`,
		...(report.runtime.datasetPath === undefined
			? []
			: [`<code>${escapeHtml(report.runtime.datasetPath)}</code>`]),
	];
	const runtimeItems: Array<[string, string]> = [
		["Dataset", report.dataset],
		["Generated", report.generatedAt],
		["Runtime source", report.runtime.source],
		["Execution mode", report.runtime.executionMode ?? "spawn-cli"],
		["CLI", report.runtime.cli],
		["Corpus", report.runtime.corpusDbPath ?? "CLI default"],
		["Docs", String(report.runtime.docCount ?? "unknown")],
	];
	if (report.runtime.repoId !== undefined) {
		runtimeItems.push(["Repo", report.runtime.repoId]);
	}
	if (report.runtime.repoRevision !== undefined) {
		runtimeItems.push(["Repo revision", report.runtime.repoRevision]);
	}
	if (report.runtime.indexedRevision !== undefined) {
		runtimeItems.push(["Indexed revision", report.runtime.indexedRevision]);
	}

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atlas Retrieval & MCP Evaluation Report</title>
<style>
:root{color-scheme:light dark;--bg:#f6f8fa;--panel:#fff;--panel2:#f6f8fa;--line:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#0969da;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700;--shadow:0 12px 34px #1f232812}@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--panel:#161b22;--panel2:#0d1117;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#2f81f7;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--shadow:0 18px 55px #0008}}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent 280px),var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:1280px;margin:0 auto;padding:32px 18px 56px}h1{font-size:40px;line-height:1.05;margin:8px 0 12px}h2{font-size:22px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}.hero,.panel,.card,.case{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.hero{padding:30px;margin-bottom:16px}.eyebrow{color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px}.lede{font-size:17px;max-width:980px}.muted{color:var(--muted)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.status{font-weight:800}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.card{padding:16px}.card span{color:var(--muted);display:block}.card strong{display:block;font-size:28px;margin:3px 0}.card small{color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{padding:18px;margin-top:16px;overflow:hidden}.meta,.chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:16px}.meta div,.chip{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px}.meta b,.chip b{display:block;font-size:12px;color:var(--muted);font-weight:700}.bars{display:grid;gap:10px}.bar{display:grid;grid-template-columns:180px 1fr 62px;gap:10px;align-items:center}.track{height:10px;background:var(--panel2);border:1px solid var(--line);border-radius:999px;overflow:hidden}.fill{height:100%;background:var(--ok)}.fill.fail{background:var(--bad)}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid var(--line);padding:9px;text-align:left;vertical-align:top}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}pre{white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:220px;overflow:auto}.pills{display:flex;flex-wrap:wrap;gap:6px}.pill{display:inline-flex;border:1px solid var(--line);background:var(--panel2);border-radius:999px;padding:2px 8px;font-size:12px}.case{padding:15px;margin-top:12px}.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.claim{border-left:4px solid var(--accent);padding-left:10px}.note{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px}@media(max-width:900px){.cards,.grid,.cols{grid-template-columns:1fr}.bar{grid-template-columns:1fr}.hero{padding:20px}h1{font-size:31px}}
</style>
</head>
<body><main>
<section class="hero">
  <div class="eyebrow">Atlas Retrieval & MCP Evaluation Report</div>
  <h1>${escapeHtml(report.dataset)}</h1>
  <p class="lede">This run evaluates whether Atlas retrieves the right project evidence for developer-agent workflows: repository onboarding, MCP context planning, CLI workflow discovery, profile-aware behavior, runtime artifacts, diagnostics, negative queries, and security/privacy boundaries.</p>
  <p class="muted">${escapeHtml(report.description ?? "Deterministic retrieval evaluation")} The suite is deterministic and local-first: it does not call an LLM judge by default. Thresholds are <span class="status ${thresholdStatus ? "ok" : "bad"}">${thresholdStatus ? "passing" : "failing"}</span>. References: ${links.join(" · ")}</p>
</section>

<section class="cards">
  ${scoreCard("Cases passing", `${report.passedCases}/${report.totalCases}`, `${percent(report.metrics.passRate)} pass rate`, report.metrics.passRate === 1 ? "ok" : "bad")}
  ${scoreCard("Path Recall@5", percent(report.metrics.pathRecallAt5), "expected sources in practical context window", "")}
  ${scoreCard("MRR", String(report.metrics.mrr), "rank quality for first expected source", "")}
  ${scoreCard("P95 latency", `${report.metrics.p95LatencyMs}ms`, "wall-clock CLI query time", "")}
</section>

<section class="panel"><h2>What is being evaluated?</h2>${renderEvalUnit(report)}</section>
<section class="panel"><h2>Capability claims and evidence</h2>${renderCapabilityClaims(report)}</section>
<section class="grid">
  <div class="panel"><h2>Main retrieval metrics</h2><div class="bars">${metricBars(report).join("\n")}</div></div>
  <div class="panel"><h2>Threshold gates</h2>${renderThresholds(report)}</div>
</section>
<section class="panel"><h2>Coverage matrix</h2>${renderCoverage(report)}</section>
${renderGroupSection("Capability", report.byFeature)}
${renderGroupSection("Scenario", report.byScenario)}
<section class="panel"><h2>Representative passing cases</h2>${renderRepresentativeCases(report)}</section>
<section class="panel"><h2>Hardest passing cases</h2>${renderHardestCases(report)}</section>
<section class="panel"><h2>Failures and regressions (${failed.length})</h2>${renderFailures(failed)}</section>
<section class="panel"><h2>Methodology and metric definitions</h2>${renderMethodology(report)}</section>
<section class="panel"><h2>Limitations and next evals</h2>${renderLimitations()}</section>
<section class="panel"><h2>Reproducibility</h2><div class="meta">${runtimeItems.map(([label, value]) => `<div><b>${escapeHtml(label)}</b>${escapeHtml(value)}</div>`).join("\n")}</div></section>
<section class="panel"><h2>All cases</h2><table><thead><tr><th>Status</th><th>ID</th><th>Claim</th><th>Scores</th><th>Evidence</th></tr></thead><tbody>${report.cases.map(renderCaseRow).join("\n")}</tbody></table></section>
</main></body></html>`;
}

function scoreCard(
	label: string,
	value: string,
	description: string,
	className: string,
): string {
	return `<div class="card"><span>${escapeHtml(label)}</span><strong class="${className}">${escapeHtml(value)}</strong><small>${escapeHtml(description)}</small></div>`;
}

function renderEvalUnit(report: Report): string {
	return `<p>One eval case is a user-like query run against <code>atlas inspect retrieval</code>. A case passes only when Atlas retrieval satisfies deterministic expectations: required source paths, expected terms in retrieved evidence, absence of forbidden paths, expected no-result behavior, diagnostics, confidence, and hit-count bounds.</p><p class="muted">This report measures retrieval grounding and workflow coverage. It does not yet claim generated-answer faithfulness or live agent task-completion quality.</p><div class="chips"><div class="chip"><b>Total cases</b>${report.totalCases}</div><div class="chip"><b>Corpus docs</b>${report.runtime.docCount ?? "unknown"}</div><div class="chip"><b>No-result accuracy</b>${percent(report.metrics.noResultAccuracy)}</div><div class="chip"><b>Forbidden-path accuracy</b>${percent(report.metrics.forbiddenPathAccuracy)}</div></div>`;
}

function metricBars(report: Report): string[] {
	return [
		["Pass rate", report.metrics.passRate],
		["Path Recall@1", report.metrics.pathRecallAt1],
		["Path Recall@3", report.metrics.pathRecallAt3],
		["Path Recall@5", report.metrics.pathRecallAt5],
		["MRR", report.metrics.mrr],
		["Term recall", report.metrics.termRecall],
		["Non-empty context", report.metrics.nonEmptyContextRate],
		["No-result accuracy", report.metrics.noResultAccuracy],
		["Forbidden-path accuracy", report.metrics.forbiddenPathAccuracy],
	].map(([label, value]) => renderProgress(String(label), Number(value)));
}

function renderProgress(label: string, value: number, failed = false): string {
	return `<div class="bar"><span>${escapeHtml(label)}</span><div class="track"><div class="fill ${failed ? "fail" : ""}" style="width:${Math.max(0, Math.min(100, Math.round(value * 100)))}%"></div></div><strong>${percent(value)}</strong></div>`;
}

function renderThresholds(report: Report): string {
	if (report.thresholds === undefined) {
		return `<p class="muted">No threshold gates supplied. Local evals report scores without failing on gates by default.</p>`;
	}
	return `<div class="bars">${report.thresholds.results
		.map((threshold) =>
			renderProgress(
				`${threshold.passed ? "✓" : "✗"} ${threshold.label} ≥ ${percent(threshold.minimum)}`,
				threshold.actual,
				!threshold.passed,
			),
		)
		.join("\n")}</div>`;
}

function renderCapabilityClaims(report: Report): string {
	const rows = Object.entries(report.byFeature)
		.sort(([, left], [, right]) => right.total - left.total)
		.map(([feature, value]) => {
			const sample = report.cases.find(
				(testCase) => (testCase.feature ?? "unknown") === feature,
			);
			const claim = sample?.claim ?? defaultClaim(feature);
			return `<tr><td class="claim"><b>${escapeHtml(feature)}</b><br><span class="muted">${escapeHtml(claim)}</span></td><td>${value.passed}/${value.total}</td><td>${percent(value.recallAt5)}</td><td>${value.mrr}</td><td>${percent(value.termRecall)}</td><td>${escapeHtml(sample?.whyItMatters ?? "Covers a product workflow that should remain retrievable from the Atlas corpus.")}</td></tr>`;
		})
		.join("\n");
	return `<table><thead><tr><th>Capability claim</th><th>Cases</th><th>Recall@5</th><th>MRR</th><th>Term recall</th><th>Why it matters</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCoverage(report: Report): string {
	return `<div class="grid"><div>${renderCountTable("Capabilities", report.coverage.capabilities)}</div><div>${renderCountTable("Priority", report.coverage.priorities)}</div><div>${renderCountTable("Risk areas", report.coverage.riskAreas)}</div><div>${renderCountTable("Coverage types", report.coverage.coverageTypes)}</div></div>`;
}

function renderCountTable(
	title: string,
	counts: Record<string, number>,
): string {
	return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>Name</th><th>Cases</th></tr></thead><tbody>${Object.entries(
		counts,
	)
		.map(
			([name, count]) =>
				`<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`,
		)
		.join("\n")}</tbody></table>`;
}

function renderGroupSection(title: string, group: ReportGroup): string {
	return `<section class="panel"><h2>${escapeHtml(title)} breakdown</h2><table><thead><tr><th>${escapeHtml(title)}</th><th>Passed</th><th>Pass rate</th><th>Recall@5</th><th>MRR</th><th>Term recall</th><th>Avg latency</th></tr></thead><tbody>${Object.entries(
		group,
	)
		.map(
			([name, value]) =>
				`<tr><td>${escapeHtml(name)}</td><td>${value.passed}/${value.total}</td><td>${percent(value.passRate)}</td><td>${percent(value.recallAt5)}</td><td>${value.mrr}</td><td>${percent(value.termRecall)}</td><td>${value.averageLatencyMs}ms</td></tr>`,
		)
		.join("\n")}</tbody></table></section>`;
}

function renderRepresentativeCases(report: Report): string {
	const seen = new Set<string>();
	const cases = report.cases.filter((testCase) => {
		const key = testCase.feature ?? testCase.category;
		if (!testCase.passed || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return `<div class="details">${cases.slice(0, 8).map(renderCaseCard).join("\n")}</div>`;
}

function renderHardestCases(report: Report): string {
	const cases = report.cases
		.filter((testCase) => testCase.passed)
		.sort(
			(left, right) =>
				(right.retrieval.bestExpectedPathRank ?? 0) -
					(left.retrieval.bestExpectedPathRank ?? 0) ||
				left.retrieval.reciprocalRank - right.retrieval.reciprocalRank ||
				right.latencyMs - left.latencyMs,
		)
		.slice(0, 6);
	return `<div class="details">${cases.map(renderCaseCard).join("\n")}</div>`;
}

function renderFailures(failed: CaseResult[]): string {
	if (failed.length === 0) {
		return `<p class="muted">No failed cases in this run. Inspect hardest passing cases and limitations below for remaining risk.</p>`;
	}
	return `<div class="details">${failed.map(renderFailure).join("\n")}</div>`;
}

function renderCaseCard(testCase: CaseResult): string {
	return `<article class="case"><h3>${escapeHtml(testCase.id)}</h3>${renderMetadataPills(testCase)}<p><b>Claim:</b> ${escapeHtml(testCase.claim ?? defaultClaim(testCase.feature ?? testCase.category))}</p><p><b>User query:</b> ${escapeHtml(testCase.query)}</p><p><b>Why it matters:</b> ${escapeHtml(testCase.whyItMatters ?? "This represents a workflow where Atlas should retrieve grounded project evidence for a developer or agent.")}</p><div class="cols"><div><b>Expected behavior</b><pre>${escapeHtml(testCase.expectedBehavior ?? "Retrieve the expected source paths and terms without violating negative expectations.")}</pre></div><div><b>Top retrieved paths</b><pre>${escapeHtml(formatList(testCase.topPaths.slice(0, 8)))}</pre></div></div><p class="muted">Verdict ${testCase.passed ? "pass" : "fail"}; Recall@5 ${percent(testCase.retrieval.recallAt5)}, MRR ${testCase.retrieval.reciprocalRank}, best expected rank ${testCase.retrieval.bestExpectedPathRank ?? "none"}, term recall ${percent(testCase.scores.termRecall)}, latency ${testCase.latencyMs}ms.</p></article>`;
}

function renderFailure(testCase: CaseResult): string {
	const missingOther = [
		...testCase.missing.pathExcludes.map(
			(value) => `Excluded path present: ${value}`,
		),
		...testCase.missing.diagnosticsInclude.map(
			(value) => `Missing diagnostic: ${value}`,
		),
		...testCase.missing.rankedHits,
		...testCase.missing.confidence,
		...testCase.missing.noResults,
	];
	return `<article class="case"><h3>${escapeHtml(testCase.id)}</h3>${renderMetadataPills(testCase)}<p><b>Query:</b> ${escapeHtml(testCase.query)}</p><div class="cols"><div><b>Missing paths</b><pre>${escapeHtml(formatList(testCase.missing.pathIncludes))}</pre></div><div><b>Missing terms</b><pre>${escapeHtml(formatList(testCase.missing.terms))}</pre></div><div><b>Other expectation gaps</b><pre>${escapeHtml(formatList(missingOther))}</pre></div><div><b>Top paths</b><pre>${escapeHtml(formatList(testCase.topPaths.slice(0, 10)))}</pre></div></div><p class="muted">Scores: path ${percent(testCase.scores.pathRecall)}, Recall@5 ${percent(testCase.retrieval.recallAt5)}, MRR ${testCase.retrieval.reciprocalRank}, terms ${percent(testCase.scores.termRecall)}, non-empty context ${testCase.scores.nonEmptyContext ? "yes" : "no"}; selected ${testCase.selectedCount}, ranked ${testCase.rankedCount}, latency ${testCase.latencyMs}ms.</p><b>Diagnostics summary</b><pre>${escapeHtml(summarizeDiagnostics(testCase.diagnostics))}</pre></article>`;
}

function renderCaseRow(testCase: CaseResult): string {
	return `<tr><td>${testCase.passed ? "✅ pass" : "❌ fail"}</td><td><code>${escapeHtml(testCase.id)}</code>${renderMetadataPills(testCase)}</td><td><b>${escapeHtml(testCase.claim ?? defaultClaim(testCase.feature ?? testCase.category))}</b><br><span class="muted">${escapeHtml(testCase.whyItMatters ?? "Workflow coverage case")}</span></td><td>R@1 ${percent(testCase.retrieval.recallAt1)}<br>R@5 ${percent(testCase.retrieval.recallAt5)}<br>MRR ${testCase.retrieval.reciprocalRank}<br>terms ${percent(testCase.scores.termRecall)}</td><td>best rank ${testCase.retrieval.bestExpectedPathRank ?? "none"}<br>ranked ${testCase.rankedCount}<br>${testCase.latencyMs}ms<br><pre>${escapeHtml(testCase.topPaths.slice(0, 4).join("\n"))}</pre></td></tr>`;
}

function renderMethodology(report: Report): string {
	return `<ul><li><b>Pass:</b> every deterministic expectation on the case is satisfied.</li><li><b>Path Recall@k:</b> fraction of expected source-path substrings appearing in the top-k retrieved paths.</li><li><b>MRR:</b> mean reciprocal rank of the first expected source path. Higher means expected evidence appears earlier.</li><li><b>Term recall:</b> fraction of expected terms found in selected/ranked context payloads plus local source text for retrieved paths.</li><li><b>No-result accuracy:</b> no-result cases correctly return no selected or ranked evidence.</li><li><b>Forbidden-path accuracy:</b> cases with excluded paths do not retrieve those paths.</li><li><b>Latency:</b> wall-clock time for the local CLI query path. Median ${report.metrics.medianLatencyMs}ms; p95 ${report.metrics.p95LatencyMs}ms.</li></ul>`;
}

function renderLimitations(): string {
	return `<ul><li>Does not yet evaluate generated answer correctness, faithfulness, or hallucination.</li><li>Does not yet execute live MCP tool-call traces or multi-turn agent tasks.</li><li>Does not yet compare Atlas against lexical-only, prior-release, or competitor baselines.</li><li>Does not yet stress-test large multi-repository corpora or adversarial prompt injection inside retrieved docs.</li><li><code>expected.tools</code> are scenario annotations today, not executed tool-call assertions.</li></ul>`;
}

function renderMetadataPills(testCase: CaseResult): string {
	const metadata: Array<[string, string]> = [
		["category", testCase.category],
		["profile", testCase.profile ?? "unknown"],
		["feature", testCase.feature ?? "unknown"],
		["scenario", testCase.scenario ?? "unknown"],
	];
	if (testCase.priority !== undefined) {
		metadata.push(["priority", testCase.priority]);
	}
	if (testCase.riskArea !== undefined) {
		metadata.push(["risk", testCase.riskArea]);
	}
	return `<div class="pills">${metadata.map(([label, value]) => `<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}</div>`;
}

function defaultClaim(name: string): string {
	return `Atlas retrieves grounded project evidence for ${name} workflows.`;
}

function formatList(values: string[]): string {
	return values.length === 0 ? "None" : values.join("\n");
}

function summarizeDiagnostics(diagnostics: unknown[]): string {
	if (diagnostics.length === 0) {
		return "None";
	}
	return JSON.stringify(diagnostics.slice(0, 5), null, 2);
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
