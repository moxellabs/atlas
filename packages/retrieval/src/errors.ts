/** Structured context attached to retrieval package errors. */
export interface RetrievalErrorContext {
  /** Operation that failed. */
  operation: string;
  /** Entity or subsystem involved in the failure. */
  entity?: string | undefined;
  /** Original thrown value, when available. */
  cause?: unknown;
}

/** Base class for retrieval failures that indicate broken caller state or dependencies. */
export class RetrievalError extends Error {
  readonly context: RetrievalErrorContext;

  constructor(message: string, context: RetrievalErrorContext) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    if (context.cause !== undefined) {
      this.cause = context.cause;
    }
  }
}

/** Raised when retrieval options are invalid or internally inconsistent. */
export class RetrievalConfigurationError extends RetrievalError {}

/** Raised when a required store, tokenizer, or search dependency is missing or unusable. */
export class RetrievalDependencyError extends RetrievalError {}

/** Raised when context planning reaches an impossible state after validation. */
export class RetrievalPlanningError extends RetrievalError {}
