import type { Authority, DiagnosticConfidence, Provenance } from "@atlas/core";

export interface AtlasEvalDataset {
	name: string;
	cases: AtlasEvalCase[];
}

export interface AtlasEvalCase {
	id: string;
	query: string;
	repoId?: string | undefined;
	budgetTokens?: number | undefined;
	expected: {
		docIds?: string[] | undefined;
		sectionIds?: string[] | undefined;
		scopeIds?: string[] | undefined;
		authorities?: Authority[] | undefined;
	};
}

export interface EvalPlannedItem {
	targetType: string;
	targetId: string;
	tokenCount: number;
	provenance: Provenance;
	score?: number | undefined;
}

export interface EvalScope {
	id: string;
}

export interface EvalPlanResult {
	selected: EvalPlannedItem[];
	scopes: EvalScope[];
	usedTokens: number;
	confidence: DiagnosticConfidence;
}

export interface AtlasEvalRunnerOptions {
	dataset: AtlasEvalDataset;
	defaultBudgetTokens: number;
	planContext(input: {
		query: string;
		budgetTokens: number;
		repoId?: string | undefined;
	}): EvalPlanResult;
	now?: () => number;
}

export interface AtlasEvalCaseResult {
	id: string;
	query: string;
	passed: boolean;
	latencyMs: number;
	usedTokens: number;
	budgetTokens: number;
	confidence: DiagnosticConfidence;
	scores: {
		docRecall: number;
		sectionRecall: number;
		scopeRecall: number;
		provenanceHit: boolean;
		authorityHit: boolean;
		tokenBudgetPass: boolean;
	};
	missing: {
		docIds: string[];
		sectionIds: string[];
		scopeIds: string[];
		authorities: Authority[];
	};
}

export interface AtlasEvalReport {
	dataset: string;
	totalCases: number;
	passedCases: number;
	failedCases: number;
	metrics: {
		docRecall: number;
		sectionRecall: number;
		scopeRecall: number;
		provenanceHitRate: number;
		authorityHitRate: number;
		tokenBudgetPassRate: number;
		averageLatencyMs: number;
	};
	cases: AtlasEvalCaseResult[];
}

export interface AtlasMcpAdoptionToolCall {
	kind: "read_resource" | "call_tool" | "no_call";
	name?: string | undefined;
	uri?: string | undefined;
}

export interface AtlasMcpAdoptionExpected {
	mustCall?: AtlasMcpAdoptionToolCall[] | undefined;
	mustNotCall?: AtlasMcpAdoptionToolCall[] | undefined;
	allowCalls?: AtlasMcpAdoptionToolCall[] | undefined;
	security?: { noRemoteFetch: boolean; noCredentialEcho: boolean } | undefined;
}

export interface AtlasMcpAdoptionCase {
	id: string;
	prompt: string;
	repoId?: string | undefined;
	category: "indexed" | "ambiguous" | "non_indexed" | "generic" | "security";
	expected: AtlasMcpAdoptionExpected;
}

export interface AtlasMcpAdoptionDataset {
	name: string;
	cases: AtlasMcpAdoptionCase[];
}

export interface AtlasMcpAdoptionCaseResult {
	id: string;
	category: AtlasMcpAdoptionCase["category"];
	passed: boolean;
	calledManifest: boolean;
	calledPlanContext: boolean;
	unexpectedCalls: AtlasMcpAdoptionToolCall[];
	missingCalls: AtlasMcpAdoptionToolCall[];
}

export interface AtlasMcpAdoptionReport {
	dataset: string;
	totalCases: number;
	passedCases: number;
	failedCases: number;
	adoptionScore: number;
	cases: AtlasMcpAdoptionCaseResult[];
}

export interface AtlasMcpAdoptionRunnerOptions {
	dataset: AtlasMcpAdoptionDataset;
	traceCase(testCase: AtlasMcpAdoptionCase): AtlasMcpAdoptionToolCall[];
}

/** Runs deterministic retrieval/context-planning eval cases against an injected planner. */
export function runAtlasEval(options: AtlasEvalRunnerOptions): AtlasEvalReport {
	const now = options.now ?? Date.now;
	const cases = options.dataset.cases.map((testCase) =>
		runCase(testCase, options.defaultBudgetTokens, options.planContext, now),
	);
	return {
		dataset: options.dataset.name,
		totalCases: cases.length,
		passedCases: cases.filter((result) => result.passed).length,
		failedCases: cases.filter((result) => !result.passed).length,
		metrics: {
			docRecall: average(cases.map((result) => result.scores.docRecall)),
			sectionRecall: average(
				cases.map((result) => result.scores.sectionRecall),
			),
			scopeRecall: average(cases.map((result) => result.scores.scopeRecall)),
			provenanceHitRate: ratio(cases, (result) => result.scores.provenanceHit),
			authorityHitRate: ratio(cases, (result) => result.scores.authorityHit),
			tokenBudgetPassRate: ratio(
				cases,
				(result) => result.scores.tokenBudgetPass,
			),
			averageLatencyMs: average(cases.map((result) => result.latencyMs)),
		},
		cases,
	};
}

export function runMcpAdoptionEval(
	options: AtlasMcpAdoptionRunnerOptions,
): AtlasMcpAdoptionReport {
	const cases = options.dataset.cases.map((testCase) =>
		runMcpAdoptionCase(testCase, options.traceCase(testCase)),
	);
	const passedCases = cases.filter((result) => result.passed).length;
	return {
		dataset: options.dataset.name,
		totalCases: cases.length,
		passedCases,
		failedCases: cases.length - passedCases,
		adoptionScore: Number(
			(cases.length === 0 ? 0 : passedCases / cases.length).toFixed(4),
		),
		cases,
	};
}

function runMcpAdoptionCase(
	testCase: AtlasMcpAdoptionCase,
	calls: AtlasMcpAdoptionToolCall[],
): AtlasMcpAdoptionCaseResult {
	const mustCall = testCase.expected.mustCall ?? [];
	const mustNotCall = testCase.expected.mustNotCall ?? [];
	const missingCalls = mustCall.filter(
		(expected) => !matchesExpectation(calls, expected),
	);
	const unexpectedCalls = [
		...mustNotCall.flatMap((expected) =>
			calls.filter((call) => matchesCall(call, expected)),
		),
		...(mustCall.some((expected) => expected.kind === "no_call") &&
		calls.length > 0
			? calls
			: []),
	];
	return {
		id: testCase.id,
		category: testCase.category,
		passed: missingCalls.length === 0 && unexpectedCalls.length === 0,
		calledManifest: calls.some(
			(call) =>
				call.kind === "read_resource" && call.uri === "atlas://manifest",
		),
		calledPlanContext: calls.some(
			(call) => call.kind === "call_tool" && call.name === "plan_context",
		),
		unexpectedCalls,
		missingCalls,
	};
}

function matchesExpectation(
	calls: readonly AtlasMcpAdoptionToolCall[],
	expected: AtlasMcpAdoptionToolCall,
): boolean {
	if (expected.kind === "no_call") {
		return calls.length === 0;
	}
	return calls.some((call) => matchesCall(call, expected));
}

function matchesCall(
	call: AtlasMcpAdoptionToolCall,
	expected: AtlasMcpAdoptionToolCall,
): boolean {
	return (
		call.kind === expected.kind &&
		(expected.name === undefined || call.name === expected.name) &&
		(expected.uri === undefined || call.uri === expected.uri)
	);
}

function runCase(
	testCase: AtlasEvalCase,
	defaultBudgetTokens: number,
	planContext: AtlasEvalRunnerOptions["planContext"],
	now: () => number,
): AtlasEvalCaseResult {
	const budgetTokens = testCase.budgetTokens ?? defaultBudgetTokens;
	const startedAt = now();
	const plan = planContext({
		query: testCase.query,
		budgetTokens,
		...(testCase.repoId === undefined ? {} : { repoId: testCase.repoId }),
	});
	const latencyMs = Math.max(0, now() - startedAt);
	const selectedDocIds = new Set(
		plan.selected.map((item) => item.provenance.docId),
	);
	const selectedSectionIds = new Set(
		plan.selected.flatMap((item) =>
			item.provenance.headingPath === undefined ? [] : [item.targetId],
		),
	);
	const scopeIds = new Set(plan.scopes.map((scope) => scope.id));
	const authorities = new Set(
		plan.selected.map((item) => item.provenance.authority),
	);
	const expectedDocIds = testCase.expected.docIds ?? [];
	const expectedSectionIds = testCase.expected.sectionIds ?? [];
	const expectedScopeIds = testCase.expected.scopeIds ?? [];
	const expectedAuthorities = testCase.expected.authorities ?? [];
	const missing = {
		docIds: expectedDocIds.filter((docId) => !selectedDocIds.has(docId)),
		sectionIds: expectedSectionIds.filter(
			(sectionId) => !selectedSectionIds.has(sectionId),
		),
		scopeIds: expectedScopeIds.filter((scopeId) => !scopeIds.has(scopeId)),
		authorities: expectedAuthorities.filter(
			(authority) => !authorities.has(authority),
		),
	};
	const scores = {
		docRecall: recall(expectedDocIds, selectedDocIds),
		sectionRecall: recall(expectedSectionIds, selectedSectionIds),
		scopeRecall: recall(expectedScopeIds, scopeIds),
		provenanceHit: plan.selected.every(
			(item) =>
				item.provenance.docId.length > 0 && item.provenance.path.length > 0,
		),
		authorityHit: missing.authorities.length === 0,
		tokenBudgetPass: plan.usedTokens <= budgetTokens,
	};

	return {
		id: testCase.id,
		query: testCase.query,
		passed:
			missing.docIds.length === 0 &&
			missing.sectionIds.length === 0 &&
			missing.scopeIds.length === 0 &&
			missing.authorities.length === 0 &&
			scores.provenanceHit &&
			scores.tokenBudgetPass,
		latencyMs,
		usedTokens: plan.usedTokens,
		budgetTokens,
		confidence: plan.confidence,
		scores,
		missing,
	};
}

function recall(
	expected: readonly string[],
	actual: ReadonlySet<string>,
): number {
	if (expected.length === 0) {
		return 1;
	}
	return expected.filter((value) => actual.has(value)).length / expected.length;
}

function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return Number(
		(values.reduce((total, value) => total + value, 0) / values.length).toFixed(
			4,
		),
	);
}

function ratio<T>(
	values: readonly T[],
	predicate: (value: T) => boolean,
): number {
	if (values.length === 0) {
		return 0;
	}
	return Number((values.filter(predicate).length / values.length).toFixed(4));
}
