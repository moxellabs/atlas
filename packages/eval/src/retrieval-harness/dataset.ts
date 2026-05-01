import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { EvalCase, EvalDataset, EvalCaseMetadata } from "./types";

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

