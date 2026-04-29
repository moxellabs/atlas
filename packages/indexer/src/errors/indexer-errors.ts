import type { IndexerDiagnosticCause } from "../types/indexer.types";

/** Structured context attached to indexer failures. */
export interface IndexerErrorContext {
	/** Operation that failed. */
	operation: string;
	/** Processing stage that failed. */
	stage?: string | undefined;
	/** Entity or subsystem involved in the failure. */
	entity?: string | undefined;
	/** Repository associated with the failure when known. */
	repoId?: string | undefined;
	/** Original thrown value, when available. */
	cause?: unknown;
}

/** Base class for indexer package failures. */
export class IndexerError extends Error {
	readonly context: IndexerErrorContext;

	constructor(message: string, context: IndexerErrorContext) {
		super(message);
		this.name = new.target.name;
		this.context = context;
		if (context.cause !== undefined) {
			this.cause = context.cause;
		}
	}
}

/** Raised when sync orchestration fails. */
export class IndexerSyncError extends IndexerError {}

/** Raised when build orchestration fails. */
export class IndexerBuildError extends IndexerError {}

/** Raised when incremental planning fails. */
export class IndexerIncrementalBuildError extends IndexerError {}

/** Raised when build results cannot be persisted. */
export class IndexerPersistenceError extends IndexerError {}

/** Raised when required indexer configuration is missing or invalid. */
export class IndexerConfigurationError extends IndexerError {}

const SECRET_KEY_PATTERN =
	/(token|secret|password|passwd|credential|authorization|api[-_]?key|access[-_]?key)/i;
const MAX_CAUSE_DEPTH = 8;

/** Serializes unknown thrown values into a stable, redacted diagnostic cause chain. */
export function serializeIndexerDiagnosticCause(
	value: unknown,
	options: { includeStack?: boolean | undefined } = {},
	depth = 0,
): IndexerDiagnosticCause {
	if (depth >= MAX_CAUSE_DEPTH) {
		return { name: "CauseDepthExceeded", message: "Cause chain truncated." };
	}
	if (value instanceof Error) {
		const code = readStringField(value, "code");
		const context = readContext(value);
		const nested =
			"cause" in value ? (value as { cause?: unknown }).cause : undefined;
		return {
			name: value.name || "Error",
			message: redactString(value.message),
			...(code === undefined ? {} : { code }),
			...(options.includeStack && value.stack !== undefined
				? { stack: redactString(value.stack) }
				: {}),
			...(context === undefined ? {} : { context }),
			...(nested === undefined
				? {}
				: {
						cause: serializeIndexerDiagnosticCause(nested, options, depth + 1),
					}),
		};
	}
	return {
		name: typeof value === "string" ? "ThrownString" : "ThrownValue",
		message:
			typeof value === "string" ? redactString(value) : safeStringify(value),
	};
}

function readContext(value: Error): Record<string, unknown> | undefined {
	const raw = (value as { context?: unknown }).context;
	if (raw === undefined || raw === null || typeof raw !== "object") {
		return undefined;
	}
	return redactValue(raw) as Record<string, unknown>;
}

function readStringField(value: Error, field: string): string | undefined {
	const raw = (value as unknown as Record<string, unknown>)[field];
	return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function redactValue(value: unknown, key = ""): unknown {
	if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
	if (typeof value === "string") return redactString(value);
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
	if (typeof value === "object" && value !== null) {
		const output: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value)) {
			if (entryKey === "cause") continue;
			output[entryKey] = redactValue(entryValue, entryKey);
		}
		return output;
	}
	return String(value);
}

function redactString(value: string): string {
	return value
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
		.replace(/([?&](?:token|key|secret|password)=)[^\s&]+/gi, "$1[REDACTED]")
		.replace(
			/((?:token|secret|password|api[-_]?key)\s*[:=]\s*)[^\s,}]+/gi,
			"$1[REDACTED]",
		);
}

function safeStringify(value: unknown): string {
	try {
		return redactString(JSON.stringify(redactValue(value)) ?? String(value));
	} catch {
		return String(value);
	}
}
