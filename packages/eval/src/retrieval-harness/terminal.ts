import { severityBadge } from "./health";
import type { Report } from "./types";

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
		console.log(`${finding.label}: ${finding.value} [${finding.severity}]`);
	}
	console.log(`Average ranked hits: ${report.metrics.averageRankedHits}`);
	console.log(`Median retrieval latency: ${report.metrics.medianLatencyMs}ms`);
	console.log(`Median CLI round-trip: ${report.metrics.medianCliLatencyMs}ms`);
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

function formatDeltaMagnitude(metric: string, delta: number): string {
	if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
		return `${delta > 0 ? "+" : ""}${Math.round(delta)}ms`;
	}
	const pct = Math.round(delta * 100);
	return `${pct > 0 ? "+" : ""}${pct}pp`;
}

function formatThresholdComparison(result: {
	metric: string;
	actual: number;
	limit: number;
	direction: "higher" | "lower";
}): string {
	const metric = result.metric;
	const isLatency = metric === "p95LatencyMs" || metric === "averageLatencyMs";
	const formatLocal = (value: number): string =>
		isLatency ? `${Math.round(value)}ms` : percent(value);
	const comparator = result.direction === "lower" ? "<=" : ">=";
	return `${formatLocal(result.actual)} ${comparator} ${formatLocal(result.limit)}`;
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}
