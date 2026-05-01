/// <reference types="bun" />

import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
	type BaselineSummary,
	baselineSummaryFromReport,
	buildReport,
	type CaseResult,
	caseMetadata,
	evaluateExpectations,
	loadBaseline,
	loadEvalDataset,
	printTerminalSummary,
	type ReportThresholdInput,
	renderHtml,
} from "../retrieval-harness";
import { inspectRuntime, omitConfigPath, resolveEvalConfig } from "./config";
import {
	asArray,
	buildTextHaystack,
	getPath,
	isRecord,
	runCliJson,
	uniqueStrings,
} from "./io";
import { createEvalProgressReporter } from "./progress";

const defaultDatasetPath = "evals/mcp-retrieval.dataset.json";
const defaultOutPath = "evals/reports/mcp-retrieval-report.json";
const defaultHtmlPath = "evals/reports/mcp-retrieval-report.html";
const defaultBaselinePath = "evals/baseline/mcp-retrieval-baseline.json";
const defaultTrendPath = "evals/reports/mcp-retrieval-trend.jsonl";

export async function runMcpRetrievalEvalMain(input: {
	argv: string[];
	env: Record<string, string | undefined>;
	cwd: string;
}): Promise<void> {
	const args = parseArgs(input.argv);
	const datasetPath = resolve(input.cwd, args.dataset ?? defaultDatasetPath);
	const outPath = resolve(input.cwd, args.out ?? defaultOutPath);
	const htmlPath = resolve(input.cwd, args.html ?? defaultHtmlPath);
	const cli = args.cli ?? "bun run cli";
	const modelProvider =
		args.modelProvider ?? input.env.ATLAS_EVAL_MODEL_PROVIDER;
	const model = args.model ?? input.env.ATLAS_EVAL_MODEL;
	const minDocs = parseInteger(
		args.minDocs ?? args["min-docs"] ?? "10",
		"min-docs",
	);
	const useGlobal = args.global === "true" || args["use-global"] === "true";
	const thresholds = parseThresholds(args);
	const baselinePath = resolve(input.cwd, args.baseline ?? defaultBaselinePath);
	const baselineDisabled =
		args["no-baseline"] === "true" || args.baseline === "none";
	const updateBaseline = args["update-baseline"] === "true";
	const trendPath =
		args["trend-log"] === "none"
			? undefined
			: resolve(input.cwd, args["trend-log"] ?? defaultTrendPath);
	const quietEval = args.quiet === "true" || args.quiet === "";

	const dataset = await loadEvalDataset(datasetPath);
	let tempConfigDir: string | undefined;

	try {
		const config = await resolveEvalConfig({
			cli,
			...(args.config === undefined ? {} : { explicitConfigPath: args.config }),
			useGlobal,
			cwd: input.cwd,
		});
		tempConfigDir = config.tempConfigDir;
		const cliPrefix = [
			...splitCommand(cli),
			...(config.configPath === undefined
				? []
				: ["--config", config.configPath]),
		];
		if (!quietEval) {
			process.stderr.write("\n");
			process.stderr.write(
				`${evalStderrDim("Inspecting corpus and repository metadata…")}\n`,
			);
		}
		const inspectedRuntime = await inspectRuntime({
			cliPrefix,
			cli,
			...(config.configPath === undefined
				? {}
				: { configPath: config.configPath }),
			source: config.source,
			...(dataset.repoId === undefined ? {} : { repoId: dataset.repoId }),
			cwd: input.cwd,
		});
		const runtime =
			config.source === "repo-local-artifact"
				? omitConfigPath(inspectedRuntime)
				: inspectedRuntime;
		if ((runtime.docCount ?? 0) < minDocs) {
			throw new Error(
				`Eval corpus too small for ${runtime.repoId ?? dataset.repoId ?? "dataset repo"}: ${runtime.docCount ?? 0} doc(s). ` +
					`Using ${runtime.configPath ?? "CLI default config"}${runtime.corpusDbPath ? ` (${runtime.corpusDbPath})` : ""}. ` +
					`Run with --config <path>, --global, or rebuild/import current .moxel/atlas artifacts. ` +
					`Use --min-docs 0 to bypass this guard.`,
			);
		}

		const progress = createEvalProgressReporter({
			quiet: quietEval,
			tty: process.stderr.isTTY === true,
		});
		progress.banner({
			datasetPath,
			caseCount: dataset.cases.length,
			outPath,
			htmlPath,
			corpusLabel:
				runtime.corpusDbPath !== undefined
					? relPathFriendly(runtime.corpusDbPath)
					: "CLI default corpus",
			docCount: runtime.docCount ?? "unknown",
		});

		const results: CaseResult[] = [];
		const casesTotal = dataset.cases.length;
		const casesStartedAt = performance.now();
		let passSoFar = 0;
		let failSoFar = 0;

		try {
			for (let caseIndex = 0; caseIndex < casesTotal; caseIndex++) {
				const testCase = dataset.cases[caseIndex]!;
				const startedAt = performance.now();
				const output = await runCliJson(
					[
						...cliPrefix,
						"inspect",
						"retrieval",
						"--query",
						testCase.query,
						"--json",
						...((testCase.repoId ?? dataset.repoId)
							? ["--repo", testCase.repoId ?? dataset.repoId ?? ""]
							: []),
					],
					input.cwd,
				);
				const latencyMs = Math.round(performance.now() - startedAt);
				const data = isRecord(output.data) ? output.data : output;
				const plan = isRecord(data.plan) ? data.plan : data;
				const rankedHits = asArray(plan.rankedHits);
				const selected = asArray(plan.selected);
				const contextPacket = isRecord(plan.contextPacket)
					? plan.contextPacket
					: {};
				const evidence = asArray(contextPacket.evidence);
				const diagnostics = asArray(plan.diagnostics);
				const allHits = [...rankedHits, ...selected, ...evidence];
				const topPaths = uniqueStrings(
					allHits
						.map((item) => getPath(item))
						.filter((path): path is string => path !== undefined),
				).slice(0, 10);
				const textHaystack = await buildTextHaystack({
					rankedHits,
					selected,
					contextPacket,
					topPaths,
					cwd: input.cwd,
				});
				const diagnosticsHaystack = JSON.stringify(diagnostics).toLowerCase();
				const confidence =
					typeof contextPacket.confidence === "string"
						? contextPacket.confidence
						: typeof plan.confidence === "string"
							? plan.confidence
							: undefined;
				const expectationResult = evaluateExpectations({
					testCase,
					topPaths,
					textHaystack,
					diagnosticsHaystack,
					selectedCount: selected.length,
					rankedCount: rankedHits.length,
					...(confidence === undefined ? {} : { confidence }),
				});
				results.push({
					id: testCase.id,
					category: testCase.category,
					query: testCase.query,
					...caseMetadata(testCase),
					passed: expectationResult.passed,
					latencyMs,
					selectedCount: selected.length,
					rankedCount: rankedHits.length,
					...(confidence === undefined ? {} : { confidence }),
					scores: expectationResult.scores,
					retrieval: expectationResult.retrieval,
					missing: expectationResult.missing,
					topPaths,
					diagnostics,
				});
				if (expectationResult.passed) {
					passSoFar++;
				} else {
					failSoFar++;
				}
				progress.tick({
					index: caseIndex + 1,
					total: casesTotal,
					caseId: testCase.id,
					passed: expectationResult.passed,
					latencyMs,
					passSoFar,
					failSoFar,
				});
			}
		} finally {
			progress.done({
				elapsedMs: Math.round(performance.now() - casesStartedAt),
				passSoFar,
				failSoFar,
				total: casesTotal,
			});
		}

		const baseline: BaselineSummary | undefined = baselineDisabled
			? undefined
			: await loadBaseline(baselinePath);
		const report = buildReport(
			dataset,
			results,
			{
				...runtime,
				datasetPath,
			},
			Object.fromEntries(
				Object.entries({ provider: modelProvider, model }).filter(
					([, value]) => value !== undefined,
				),
			) as { provider?: string; model?: string },
			thresholds,
			baseline,
		);
		await mkdir(dirname(outPath), { recursive: true });
		await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
		await mkdir(dirname(htmlPath), { recursive: true });
		await writeFile(htmlPath, renderHtml(report));
		console.log(`Wrote ${outPath}`);
		console.log(`Wrote ${htmlPath}`);
		if (trendPath) {
			try {
				await mkdir(dirname(trendPath), { recursive: true });
				const trendEntry = {
					generatedAt: report.generatedAt,
					dataset: report.dataset,
					repoRevision: report.runtime.repoRevision,
					severity: report.narrative.severity,
					metrics: report.metrics,
				};
				await appendFile(trendPath, `${JSON.stringify(trendEntry)}\n`);
			} catch (error) {
				console.error(
					`Warning: failed to append trend log ${trendPath}: ${String(error)}`,
				);
			}
		}
		if (updateBaseline) {
			const summary = baselineSummaryFromReport(report);
			await mkdir(dirname(baselinePath), { recursive: true });
			await writeFile(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
			console.log(`Wrote baseline ${baselinePath}`);
		}
		printTerminalSummary(report);
		if (report.thresholds !== undefined && !report.thresholds.passed) {
			throw new Error(
				`Eval threshold gate(s) failed: ${report.thresholds.results
					.filter((result) => !result.passed)
					.map((result) => {
						const comparator = result.direction === "lower" ? ">" : "<";
						const latency =
							result.metric === "p95LatencyMs" ||
							result.metric === "averageLatencyMs";
						const actualText = latency
							? `${Math.round(result.actual)}ms`
							: percent(result.actual);
						const limitText = latency
							? `${Math.round(result.limit)}ms`
							: percent(result.limit);
						return `${result.label} ${actualText} ${comparator} ${limitText}`;
					})
					.join(", ")}`,
			);
		}
	} finally {
		if (tempConfigDir !== undefined) {
			await rm(tempConfigDir, { recursive: true, force: true });
		}
	}
}

function parseArgs(values: string[]): Record<string, string | undefined> {
	const parsed: Record<string, string | undefined> = {};
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value?.startsWith("--")) {
			const next = values[index + 1];
			if (next === undefined || next.startsWith("--")) {
				parsed[value.slice(2)] = "true";
				continue;
			}
			parsed[value.slice(2)] = next;
			index += 1;
		}
	}
	return parsed;
}

function parseThresholds(
	args: Record<string, string | undefined>,
): ReportThresholdInput {
	return Object.fromEntries(
		Object.entries({
			minPassRate: parseOptionalRate(args["min-pass-rate"], "min-pass-rate"),
			minPathRecall: parseOptionalRate(
				args["min-path-recall"],
				"min-path-recall",
			),
			minTermRecall: parseOptionalRate(
				args["min-term-recall"],
				"min-term-recall",
			),
			minNonEmptyContextRate: parseOptionalRate(
				args["min-non-empty-context-rate"],
				"min-non-empty-context-rate",
			),
			minRecallAt1: parseOptionalRate(
				args["min-recall-at-1"],
				"min-recall-at-1",
			),
			minRecallAt3: parseOptionalRate(
				args["min-recall-at-3"],
				"min-recall-at-3",
			),
			minRecallAt5: parseOptionalRate(
				args["min-recall-at-5"],
				"min-recall-at-5",
			),
			minMrr: parseOptionalRate(args["min-mrr"], "min-mrr"),
			minNoResultAccuracy: parseOptionalRate(
				args["min-no-result-accuracy"],
				"min-no-result-accuracy",
			),
			minForbiddenPathAccuracy: parseOptionalRate(
				args["min-forbidden-path-accuracy"],
				"min-forbidden-path-accuracy",
			),
			maxP95LatencyMs: parseOptionalPositive(
				args["max-p95-latency-ms"],
				"max-p95-latency-ms",
			),
			maxAverageLatencyMs: parseOptionalPositive(
				args["max-average-latency-ms"],
				"max-average-latency-ms",
			),
			maxMetricRegression: parseOptionalRate(
				args["max-metric-regression"],
				"max-metric-regression",
			),
		}).filter(([, value]) => value !== undefined),
	) as ReportThresholdInput;
}

function parseOptionalRate(
	value: string | undefined,
	label: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
		throw new Error(`--${label} must be a number between 0 and 1`);
	}
	return parsed;
}

function parseOptionalPositive(
	value: string | undefined,
	label: string,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`--${label} must be a non-negative number`);
	}
	return parsed;
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function splitCommand(command: string): string[] {
	return command.split(/\s+/).filter((part) => part.length > 0);
}

function parseInteger(value: string, name: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`--${name} must be a non-negative integer.`);
	}
	return parsed;
}

function relPathFriendly(absolute: string): string {
	const r = relative(inputCwd(), absolute);
	if (r === "") {
		return ".";
	}
	return r.startsWith("..") || absolute === r ? absolute : r;
}

function inputCwd(): string {
	return process.cwd();
}

function evalStderrDim(text: string): string {
	if (
		process.stderr.isTTY !== true ||
		process.env.NO_COLOR !== undefined ||
		process.env.FORCE_COLOR === "0" ||
		process.env.TERM === "dumb"
	) {
		return text;
	}
	return `\x1b[2m${text}\x1b[0m`;
}
