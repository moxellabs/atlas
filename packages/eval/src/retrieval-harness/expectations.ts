import type { CaseResult, ExpectationInput, ExpectationResult } from "./types";

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
	const missing: CaseResult["missing"] = {
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

function recall(total: number, missing: number): number {
	return total === 0 ? 1 : round((total - missing) / total);
}

function recallAtK(expectedPaths: string[], topPaths: string[], k: number): number {
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

function round(value: number): number {
	return Number(value.toFixed(4));
}

