/** Structured context attached to server-layer errors. */
export interface ServerErrorContext {
	/** Operation that failed. */
	operation: string;
	/** Entity or subsystem involved in the failure. */
	entity?: string | undefined;
	/** Optional structured details safe to return to local API clients. */
	details?: unknown;
	/** Original thrown value, when available. */
	cause?: unknown;
}

/** Base class for predictable ATLAS server errors. */
export class AtlasServerError extends Error {
	readonly code: string;
	readonly status: number;
	readonly context: ServerErrorContext;

	constructor(
		message: string,
		options: { code: string; status: number; context: ServerErrorContext },
	) {
		super(message);
		this.name = new.target.name;
		this.code = options.code;
		this.status = options.status;
		this.context = options.context;
		if (options.context.cause !== undefined) {
			this.cause = options.context.cause;
		}
	}
}

/** Raised for invalid request payloads or query parameters. */
export class ServerValidationError extends AtlasServerError {
	constructor(message: string, context: ServerErrorContext) {
		super(message, { code: "validation_failed", status: 400, context });
	}
}

/** Raised when a requested resource does not exist. */
export class ServerNotFoundError extends AtlasServerError {
	constructor(message: string, context: ServerErrorContext) {
		super(message, { code: "not_found", status: 404, context });
	}
}

/** Raised when a local-only operation is requested from an unsafe bind address. */
export class ServerForbiddenError extends AtlasServerError {
	constructor(message: string, context: ServerErrorContext) {
		super(message, { code: "forbidden", status: 403, context });
	}
}

/** Raised when server dependencies cannot be constructed or reached. */
export class ServerDependencyError extends AtlasServerError {
	constructor(message: string, context: ServerErrorContext) {
		super(message, { code: "dependency_error", status: 500, context });
	}
}
