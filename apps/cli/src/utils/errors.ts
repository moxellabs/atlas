import { AtlasConfigError } from "@atlas/config";
import type {
	BuildBatchReport,
	BuildReport,
	SyncBatchReport,
	SyncReport,
} from "@atlas/indexer";
import { IndexerError } from "@atlas/indexer";
import { StoreError } from "@atlas/store";

import type { CliCommandFailure } from "../runtime/types";

/** Exit code used for generic command failures. */
export const EXIT_FAILURE = 1;
/** Exit code used for validation and config problems. */
export const EXIT_INPUT_ERROR = 2;
/** Exit code used for runtime bootstrap and dependency failures. */
export const EXIT_RUNTIME_ERROR = 3;
/** Exit code used for partial multi-repo failures. */
export const EXIT_PARTIAL_FAILURE = 4;

/** Stable CLI-normalized error. */
export class CliError extends Error {
	readonly code: string;
	readonly exitCode: number;
	readonly details?: unknown;

	constructor(
		message: string,
		options: { code: string; exitCode: number; details?: unknown },
	) {
		super(message);
		this.name = "CliError";
		this.code = options.code;
		this.exitCode = options.exitCode;
		this.details = options.details;
	}
}

/** Normalizes arbitrary failures into CLI error semantics. */
export function toCliError(error: unknown): CliError {
	if (error instanceof CliError) {
		return error;
	}
	if (error instanceof AtlasConfigError) {
		return new CliError(error.message, {
			code: error.code,
			exitCode: EXIT_INPUT_ERROR,
			details: {
				filePath: error.filePath,
				fieldPath: error.fieldPath,
			},
		});
	}
	if (error instanceof IndexerError) {
		return new CliError(error.message, {
			code: error.name,
			exitCode: EXIT_FAILURE,
			details: error.context,
		});
	}
	if (error instanceof StoreError) {
		return new CliError(error.message, {
			code: error.name,
			exitCode: EXIT_RUNTIME_ERROR,
			details: {
				operation: error.operation,
				entity: error.entity,
				sql: error.sql,
				cause: error.cause,
			},
		});
	}
	if (isZodError(error)) {
		return new CliError(formatZodError(error), {
			code: "ATLAS_CONFIG_VALIDATION_FAILED",
			exitCode: EXIT_INPUT_ERROR,
			details: error.issues,
		});
	}
	if (error instanceof Error) {
		return new CliError(error.message, {
			code: error.name || "CLI_ERROR",
			exitCode: EXIT_FAILURE,
		});
	}
	return new CliError("Unknown CLI failure.", {
		code: "UNKNOWN_ERROR",
		exitCode: EXIT_FAILURE,
		details: error,
	});
}

function isZodError(error: unknown): error is {
	issues: Array<{ path?: unknown[]; message?: string }>;
} {
	return (
		error instanceof Error &&
		error.name === "ZodError" &&
		Array.isArray((error as { issues?: unknown }).issues)
	);
}

function formatZodError(error: {
	issues: Array<{ path?: unknown[]; message?: string }>;
}): string {
	const summary = error.issues
		.slice(0, 3)
		.map((issue) => {
			const path = issue.path?.length ? issue.path.join(".") : "config";
			return `${path}: ${issue.message ?? "invalid value"}`;
		})
		.join("; ");
	return `Invalid ATLAS config: ${summary}`;
}

/** Converts a failure into the JSON envelope emitted by the CLI. */
export function toFailureResult(
	command: string,
	error: unknown,
	verbose = false,
): CliCommandFailure {
	const cliError = toCliError(error);
	const details = verbose
		? cliError.details
		: omitStackFields(cliError.details);
	return {
		ok: false,
		command,
		error: {
			code: cliError.code,
			message: cliError.message,
			...(details !== undefined ? { details } : {}),
		},
		exitCode: cliError.exitCode,
	};
}

function omitStackFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => omitStackFields(entry));
	}
	if (value !== null && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (key === "stack") continue;
			output[key] = omitStackFields(entry);
		}
		return output;
	}
	return value;
}

/** Determines whether a batch report should be treated as a partial failure. */
export function exitCodeForReport(
	report: SyncReport | BuildReport | SyncBatchReport | BuildBatchReport,
): number {
	if ("reports" in report) {
		return report.failureCount > 0 ? EXIT_PARTIAL_FAILURE : 0;
	}
	if ("status" in report) {
		return report.status === "failed" ? EXIT_FAILURE : 0;
	}
	return report.diagnostics.some(
		(diagnostic) => diagnostic.severity === "error",
	)
		? EXIT_FAILURE
		: 0;
}

/** Creates a short human-readable summary for sync/build reports. */
export function summarizeReport(
	report: SyncReport | BuildReport | SyncBatchReport | BuildBatchReport,
): string {
	if ("reports" in report) {
		return `${report.reports.length} repo(s), ${report.successCount} succeeded, ${report.failureCount} failed.`;
	}
	if ("status" in report) {
		if (report.status === "failed") {
			return `${report.repoId}: failed.`;
		}
		if (!report.sourceChanged) {
			return `${report.repoId}: source unchanged, ${report.corpusAffected ? "corpus stale" : "corpus current"}.`;
		}
		if (report.corpusAffected) {
			return `${report.repoId}: corpus stale (${report.changedPathCount} source path(s), ${report.relevantDocPathCount} doc path(s)).`;
		}
		return `${report.repoId}: source updated, corpus current (${report.changedPathCount} source path(s), 0 corpus path(s)).`;
	}
	return `${report.repoId}: ${report.strategy} (${report.docsRebuilt} rebuilt, ${report.docsDeleted} deleted).`;
}
