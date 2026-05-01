import { readFile } from "node:fs/promises";

import type { BaselineSummary, Report } from "./types";

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

