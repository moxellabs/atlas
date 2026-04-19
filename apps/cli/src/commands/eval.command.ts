import {
	type AtlasEvalDataset,
	type AtlasMcpAdoptionDataset,
	type AtlasMcpAdoptionToolCall,
	runAtlasEval,
	runMcpAdoptionEval,
} from "@atlas/eval";

import { readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_FAILURE, EXIT_INPUT_ERROR } from "../utils/errors";
import { loadDependenciesFromGlobal, renderSuccess } from "./shared";

const DEFAULT_EVAL_BUDGET_TOKENS = 1200;
const MCP_ADOPTION_KIND = "mcp-adoption";

/** Runs deterministic retrieval eval datasets against the local corpus. */
export async function runEvalCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const options = parseOptions(context.argv);
	const datasetPath = readStringOption(options, "dataset");
	if (datasetPath === undefined) {
		throw new CliError("eval requires --dataset <path>.", {
			code: "CLI_EVAL_DATASET_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}

	const kind = readStringOption(options, "kind");
	if (kind === MCP_ADOPTION_KIND) {
		const dataset = await readMcpAdoptionDataset(datasetPath);
		const traces = await readMcpAdoptionTrace(
			readStringOption(options, "trace"),
		);
		const report = runMcpAdoptionEval({
			dataset,
			traceCase(testCase) {
				return traces[testCase.id] ?? [];
			},
		});
		return renderSuccess(
			context,
			"eval",
			report,
			[
				`${report.dataset}: ${report.passedCases}/${report.totalCases} adoption case(s) passed.`,
				`adoptionScore=${report.adoptionScore}`,
			],
			report.failedCases > 0 ? EXIT_FAILURE : 0,
		);
	}
	if (kind !== undefined && kind !== "retrieval") {
		throw new CliError(`Unsupported eval kind: ${kind}.`, {
			code: "CLI_INVALID_EVAL_KIND",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	if (readStringOption(options, "trace") !== undefined) {
		throw new CliError(
			"eval --trace is only supported with --kind mcp-adoption.",
			{
				code: "CLI_EVAL_TRACE_UNSUPPORTED",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}

	const budgetTokens = parseBudget(readStringOption(options, "budget-tokens"));
	const dataset = await readDataset(datasetPath);
	const deps = await loadDependenciesFromGlobal(
		context,
		readStringOption(options, "config"),
	);
	try {
		const report = runAtlasEval({
			dataset,
			defaultBudgetTokens: budgetTokens,
			planContext(input) {
				return deps.retrieval.planContext(input);
			},
		});
		return renderSuccess(
			context,
			"eval",
			report,
			evalLines(report),
			report.failedCases > 0 ? EXIT_FAILURE : 0,
		);
	} finally {
		deps.close();
	}
}

async function readDataset(path: string): Promise<AtlasEvalDataset> {
	let raw: unknown;
	try {
		raw = await Bun.file(path).json();
	} catch (error) {
		throw new CliError(`Failed to read eval dataset: ${path}.`, {
			code: "CLI_EVAL_DATASET_READ_FAILED",
			exitCode: EXIT_INPUT_ERROR,
			details: error,
		});
	}
	return parseDataset(raw);
}

async function readMcpAdoptionDataset(
	path: string,
): Promise<AtlasMcpAdoptionDataset> {
	let raw: unknown;
	try {
		raw = await Bun.file(path).json();
	} catch (error) {
		throw new CliError(`Failed to read eval dataset: ${path}.`, {
			code: "CLI_EVAL_DATASET_READ_FAILED",
			exitCode: EXIT_INPUT_ERROR,
			details: error,
		});
	}
	return parseMcpAdoptionDataset(raw);
}

async function readMcpAdoptionTrace(
	path: string | undefined,
): Promise<Record<string, AtlasMcpAdoptionToolCall[]>> {
	if (path === undefined) {
		return {};
	}
	let raw: unknown;
	try {
		raw = await Bun.file(path).json();
	} catch (error) {
		throw new CliError(`Failed to read eval trace: ${path}.`, {
			code: "CLI_EVAL_TRACE_READ_FAILED",
			exitCode: EXIT_INPUT_ERROR,
			details: error,
		});
	}
	if (!isRecord(raw) || !isRecord(raw.cases)) {
		throw new CliError("MCP adoption trace must contain a cases object.", {
			code: "CLI_INVALID_EVAL_TRACE",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const traces: Record<string, AtlasMcpAdoptionToolCall[]> = {};
	for (const [caseId, calls] of Object.entries(raw.cases)) {
		if (!Array.isArray(calls)) {
			throw invalidTrace();
		}
		traces[caseId] = calls.map((call) => parseToolCall(call));
	}
	return traces;
}

function parseDataset(raw: unknown): AtlasEvalDataset {
	if (
		!isRecord(raw) ||
		typeof raw.name !== "string" ||
		!Array.isArray(raw.cases)
	) {
		throw new CliError("Eval dataset must contain a name and cases array.", {
			code: "CLI_INVALID_EVAL_DATASET",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return {
		name: raw.name,
		cases: raw.cases.map((testCase, index) => parseCase(testCase, index)),
	};
}

function parseMcpAdoptionDataset(raw: unknown): AtlasMcpAdoptionDataset {
	if (
		!isRecord(raw) ||
		typeof raw.name !== "string" ||
		!Array.isArray(raw.cases)
	) {
		throw new CliError(
			"MCP adoption dataset must contain a name and cases array.",
			{
				code: "CLI_INVALID_EVAL_DATASET",
				exitCode: EXIT_INPUT_ERROR,
			},
		);
	}
	return {
		name: raw.name,
		cases: raw.cases as AtlasMcpAdoptionDataset["cases"],
	};
}

function parseCase(
	raw: unknown,
	index: number,
): AtlasEvalDataset["cases"][number] {
	if (
		!isRecord(raw) ||
		typeof raw.id !== "string" ||
		typeof raw.query !== "string" ||
		!isRecord(raw.expected)
	) {
		throw new CliError(`Invalid eval case at index ${index}.`, {
			code: "CLI_INVALID_EVAL_CASE",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return {
		id: raw.id,
		query: raw.query,
		...(typeof raw.repoId === "string" ? { repoId: raw.repoId } : {}),
		...(typeof raw.budgetTokens === "number"
			? { budgetTokens: raw.budgetTokens }
			: {}),
		expected: {
			docIds: stringArray(raw.expected.docIds),
			sectionIds: stringArray(raw.expected.sectionIds),
			scopeIds: stringArray(raw.expected.scopeIds),
			authorities: stringArray(
				raw.expected.authorities,
			) as AtlasEvalDataset["cases"][number]["expected"]["authorities"],
		},
	};
}

function parseToolCall(raw: unknown): AtlasMcpAdoptionToolCall {
	if (
		!isRecord(raw) ||
		(raw.kind !== "read_resource" &&
			raw.kind !== "call_tool" &&
			raw.kind !== "no_call")
	) {
		throw invalidTrace();
	}
	return {
		kind: raw.kind,
		...(typeof raw.name === "string" ? { name: raw.name } : {}),
		...(typeof raw.uri === "string" ? { uri: raw.uri } : {}),
	};
}

function invalidTrace(): CliError {
	return new CliError("MCP adoption trace contains an invalid tool call.", {
		code: "CLI_INVALID_EVAL_TRACE",
		exitCode: EXIT_INPUT_ERROR,
	});
}

function parseBudget(value: string | undefined): number {
	if (value === undefined) {
		return DEFAULT_EVAL_BUDGET_TOKENS;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new CliError("eval --budget-tokens must be a positive integer.", {
			code: "CLI_INVALID_EVAL_BUDGET",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return parsed;
}

function evalLines(report: ReturnType<typeof runAtlasEval>): string[] {
	return [
		`${report.dataset}: ${report.passedCases}/${report.totalCases} case(s) passed.`,
		`docRecall=${report.metrics.docRecall} provenanceHitRate=${report.metrics.provenanceHitRate} tokenBudgetPassRate=${report.metrics.tokenBudgetPassRate}`,
	];
}

function parseOptions(
	argv: readonly string[],
): Record<string, string | boolean | string[]> {
	const options: Record<string, string | boolean | string[]> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token?.startsWith("--")) {
			continue;
		}
		const key = token.slice(2);
		const value = argv[index + 1];
		options[key] = value ?? "";
		index += 1;
	}
	return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new CliError("Eval expected fields must be string arrays.", {
			code: "CLI_INVALID_EVAL_EXPECTED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	return value;
}
